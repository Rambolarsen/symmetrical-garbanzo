using Maestroid.Api.Agents;
using Maestroid.Core.Data;
using Maestroid.Core.Orchestrator;
using Maestroid.Core.Providers;
using Maestroid.Api.Endpoints;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using System.Diagnostics;
using System.Runtime.InteropServices;

// Support PORT env var (used by preview tools and Aspire service discovery)
if (Environment.GetEnvironmentVariable("PORT") is { } port)
    Environment.SetEnvironmentVariable("ASPNETCORE_URLS", $"http://localhost:{port}");

var builder = WebApplication.CreateBuilder(args);

// Disable DI build-time validation — providers are registered conditionally based on env keys
builder.Host.UseDefaultServiceProvider(o => { o.ValidateOnBuild = false; o.ValidateScopes = false; });

builder.Services.AddServiceDiscovery();
builder.Services.AddHttpClient().AddServiceDiscovery();

// ---------------------------------------------------------------------------
// Database — switchable between SQLite (dev) and PostgreSQL (production)
// ---------------------------------------------------------------------------

var dbProvider     = builder.Configuration["DATABASE_PROVIDER"] ?? "sqlite";
var connectionString = dbProvider == "postgres"
    ? builder.Configuration["DATABASE_URL"]
    : "Data Source=masteroid.db";

builder.Services.AddDbContext<MasteroidDbContext>(options =>
{
    if (dbProvider == "postgres")
        options.UseNpgsql(connectionString);
    else
        options.UseSqlite(connectionString);
});

// ---------------------------------------------------------------------------
// Agent providers (all via IChatClient)
// ---------------------------------------------------------------------------

builder.Services.AddAgentProviders(builder.Configuration);

// ---------------------------------------------------------------------------
// Provider registry — capability-aware routing with fallback
// ---------------------------------------------------------------------------

builder.Services.AddSingleton<IOllamaClientFactory>(sp =>
{
    // Snapshot current Ollama configs from DB at startup for the singleton factory.
    // Configs are reloaded on the next app restart or on catalog invalidation.
    using var scope = sp.CreateScope();
    var db      = scope.ServiceProvider.GetRequiredService<MasteroidDbContext>();
    var configs = db.ProviderConfigs
        .Where(c => c.Provider == "ollama" && c.Enabled)
        .ToList();
    return new OllamaClientFactory(configs);
});

builder.Services.AddSingleton<IProviderRegistry, ProviderRegistry>();

// ---------------------------------------------------------------------------
// Orchestration services
// ---------------------------------------------------------------------------

builder.Services.AddScoped<PrePlanningService>();
builder.Services.AddScoped<PlanningService>();
builder.Services.AddScoped<TaskChatService>();
builder.Services.AddScoped<VerificationService>();
builder.Services.AddHttpClient<RepoContextService>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(30);
});

// ---------------------------------------------------------------------------
// Claude Code sidecar client
// Aspire service discovery resolves "claude-code-sidecar" → actual URL
// ---------------------------------------------------------------------------

var sidecarUrl =
    builder.Configuration["CLAUDE_CODE_SIDECAR_URL"] ??
    builder.Configuration["services__claude-code-sidecar__http__0"] ??
    "http://localhost:3000";

builder.Services
    .AddHttpClient<ClaudeCodeSidecarClient>(client =>
    {
        client.BaseAddress = new Uri(sidecarUrl);
        client.Timeout = TimeSpan.FromMinutes(10);
    });

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

builder.Services.AddOpenApi();

var app = builder.Build();

// Apply DB migrations on startup
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<MasteroidDbContext>();
    db.Database.Migrate();
}

app.MapOpenApi();

// Health endpoints (Aspire convention)
app.MapGet("/health", () => Results.Ok("Healthy")).ExcludeFromDescription();
app.MapGet("/alive", () => Results.Ok("Alive")).ExcludeFromDescription();

// Model selection — get and update fast/balanced tier assignments
app.MapGet("/models", (ModelSelectionService sel) =>
    Results.Ok(new { fast = sel.Fast, balanced = sel.Balanced, available = sel.Available }))
    .ExcludeFromDescription();

app.MapPut("/models", (ModelUpdateRequest req, ModelSelectionService sel) =>
{
    if (req.Fast is not null)
    {
        if (!sel.Available.Contains(req.Fast))
            return Results.BadRequest($"Model '{req.Fast}' is not registered. Available: {string.Join(", ", sel.Available)}");
        sel.Fast = req.Fast;
    }
    if (req.Balanced is not null)
    {
        if (!sel.Available.Contains(req.Balanced))
            return Results.BadRequest($"Model '{req.Balanced}' is not registered. Available: {string.Join(", ", sel.Available)}");
        sel.Balanced = req.Balanced;
    }
    return Results.Ok(new { fast = sel.Fast, balanced = sel.Balanced, available = sel.Available });
}).ExcludeFromDescription();

// Ollama health — checks reachability and lists available models
app.MapGet("/health/ollama", async (IConfiguration config, IHttpClientFactory httpClientFactory, CancellationToken ct) =>
{
    var ollamaHost = config["OLLAMA_HOST"] ?? "http://localhost:11434";
    var client = httpClientFactory.CreateClient();
    client.Timeout = TimeSpan.FromSeconds(5);
    try
    {
        var response = await client.GetAsync($"{ollamaHost.TrimEnd('/')}/api/tags", ct);
        if (!response.IsSuccessStatusCode)
            return Results.Json(new { up = false, host = ollamaHost, error = $"HTTP {(int)response.StatusCode}" }, statusCode: 502);

        var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>(ct);
        var models = body.TryGetProperty("models", out var arr)
            ? arr.EnumerateArray().Select(m => m.TryGetProperty("name", out var n) ? n.GetString() : null).Where(n => n != null).ToList()
            : [];
        return Results.Ok(new { up = true, host = ollamaHost, models });
    }
    catch (Exception ex)
    {
        return Results.Json(new { up = false, host = ollamaHost, error = ex.Message }, statusCode: 502);
    }
}).ExcludeFromDescription();

// Start Ollama if not running
app.MapPost("/health/ollama/start", async (IConfiguration config, IHttpClientFactory httpClientFactory, CancellationToken ct) =>
{
    try
    {
        var ollamaHost = config["OLLAMA_HOST"] ?? "http://localhost:11434";

        // 1. Already running?
        var probe = httpClientFactory.CreateClient();
        probe.Timeout = TimeSpan.FromSeconds(1);
        try
        {
            var r = await probe.GetAsync($"{ollamaHost.TrimEnd('/')}/api/tags", ct);
            if (r.IsSuccessStatusCode)
                return Results.Json(new { started = false, message = "Ollama is already running" }, statusCode: 409);
        }
        catch { /* not reachable — proceed */ }

        // 2. Already launching?
        if (OllamaLaunchState.IsLaunching)
            return Results.Json(new { started = false, message = "Ollama start already in progress" }, statusCode: 202);

        // 3. Is `ollama` resolvable?
        //    Use the shell so that user PATH additions (e.g. Homebrew) are respected.
        var (shellCmd, shellArgs) = RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
            ? ("cmd.exe", "/c where ollama")
            : ("/bin/sh", "-c \"which ollama 2>/dev/null\"");

        var whichPsi = new ProcessStartInfo(shellCmd, shellArgs)
        {
            UseShellExecute        = false,
            RedirectStandardOutput = true,
            CreateNoWindow         = true,
        };
        try
        {
            using var which = Process.Start(whichPsi)!;
            var output = await which.StandardOutput.ReadToEndAsync(ct);
            await which.WaitForExitAsync(ct);
            if (which.ExitCode != 0 || string.IsNullOrWhiteSpace(output))
                return Results.Json(
                    new { started = false, message = "ollama not found in PATH. Install from https://ollama.ai" },
                    statusCode: 422);
        }
        catch
        {
            return Results.Json(
                new { started = false, message = "ollama not found in PATH. Install from https://ollama.ai" },
                statusCode: 422);
        }

        // 4. Launch via shell so PATH is fully resolved
        var (launchCmd, launchArgs) = RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
            ? ("cmd.exe", "/c ollama serve")
            : ("/bin/sh", "-c \"ollama serve\"");

        OllamaLaunchState.IsLaunching = true;
        try
        {
            var psi = new ProcessStartInfo(launchCmd, launchArgs)
            {
                UseShellExecute = false,
                CreateNoWindow  = true,
            };
            var process = Process.Start(psi) ?? throw new Exception("Process.Start returned null");

            // Fire-and-forget: reset flag when the process exits
            _ = process.WaitForExitAsync(CancellationToken.None)
                       .ContinueWith(_ => OllamaLaunchState.IsLaunching = false);

            return Results.Ok(new { started = true, message = "ollama serve launched" });
        }
        catch (Exception ex)
        {
            OllamaLaunchState.IsLaunching = false;
            return Results.Json(new { started = false, message = ex.Message }, statusCode: 500);
        }
    }
    catch (Exception ex)
    {
        // Safety net — ensures this endpoint always returns JSON, never an HTML error page
        return Results.Json(new { started = false, message = $"Unexpected error: {ex.Message}" }, statusCode: 500);
    }
}).ExcludeFromDescription();

// ---------------------------------------------------------------------------
// Provider configs CRUD — sidecar fetches at startup via GET /api/providers
// ---------------------------------------------------------------------------

app.MapGet("/api/providers", async (MasteroidDbContext db, string? type, CancellationToken ct) =>
{
    var query = db.ProviderConfigs.Where(c => c.Enabled);
    if (!string.IsNullOrWhiteSpace(type))
        query = query.Where(c => c.Provider == type);

    var configs = await query
        .OrderBy(c => c.Priority)
        .Select(c => new
        {
            id       = c.Id.ToString(),
            name     = c.Name,
            provider = c.Provider,
            baseUrl  = c.BaseUrl,
            isLocal  = c.IsLocal,
            enabled  = c.Enabled,
            priority = c.Priority,
            // apiKey intentionally omitted — never returned to clients
        })
        .ToListAsync(ct);

    return Results.Ok(configs);
}).ExcludeFromDescription();

app.MapPost("/api/providers", async (
    ProviderConfigRequest req,
    MasteroidDbContext db,
    IDataProtectionProvider dpProvider,
    CancellationToken ct) =>
{
    string? encryptedKey = null;
    if (!string.IsNullOrEmpty(req.ApiKey))
    {
        var protector = dpProvider.CreateProtector("ProviderApiKey");
        encryptedKey  = protector.Protect(req.ApiKey);
    }

    var entity = new ProviderConfigEntity
    {
        Name            = req.Name,
        Provider        = req.Provider,
        BaseUrl         = req.BaseUrl,
        IsLocal         = req.IsLocal,
        Enabled         = req.Enabled,
        Priority        = req.Priority,
        EncryptedApiKey = encryptedKey,
    };

    db.ProviderConfigs.Add(entity);
    await db.SaveChangesAsync(ct);

    return Results.Created($"/api/providers/{entity.Id}", new { id = entity.Id.ToString() });
}).ExcludeFromDescription();

// ---------------------------------------------------------------------------
// Provider call records — sidecar POSTs here after each trackedGenerate() call
// ---------------------------------------------------------------------------

app.MapPost("/api/provider-calls", async (ProviderCallRecordRequest req, MasteroidDbContext db, CancellationToken ct) =>
{
    var entity = new ProviderCallRecordEntity
    {
        Id            = Guid.TryParse(req.Id, out var id) ? id : Guid.NewGuid(),
        Timestamp     = req.Timestamp,
        WorkPackageId = req.WorkPackageId,
        PhaseId       = req.PhaseId,
        InstanceId    = req.InstanceId,
        Provider      = req.Provider,
        Model         = req.Model,
        Tier          = req.Tier,
        Consumer      = req.Consumer,
        InputTokens   = req.InputTokens,
        OutputTokens  = req.OutputTokens,
        CostUsd       = (decimal)req.CostUsd,
        DurationMs    = req.DurationMs,
        WasEscalated  = req.WasEscalated,
    };

    db.ProviderCallRecords.Add(entity);
    await db.SaveChangesAsync(ct);

    return Results.Created($"/api/provider-calls/{entity.Id}", new { id = entity.Id.ToString() });
}).ExcludeFromDescription();

// User-model overrides endpoint — sidecar fetches custom model entries from DB
app.MapGet("/api/provider-models", (MasteroidDbContext db) =>
{
    // Reserved for future user-defined model overrides (Layer 3 of the catalog).
    // Returns empty list until the model override feature is implemented.
    return Results.Ok(Array.Empty<object>());
}).ExcludeFromDescription();

app.MapOrchestrationEndpoints();

app.Run();

file static class OllamaLaunchState
{
    public static volatile bool IsLaunching;
}

record ModelUpdateRequest(string? Fast, string? Balanced);

record ProviderConfigRequest(
    string Name,
    string Provider,
    string? BaseUrl,
    string? ApiKey,
    bool IsLocal,
    bool Enabled,
    int Priority
);

record ProviderCallRecordRequest(
    string Id,
    DateTime Timestamp,
    string? WorkPackageId,
    string? PhaseId,
    string InstanceId,
    string Provider,
    string Model,
    string Tier,
    string Consumer,
    int InputTokens,
    int OutputTokens,
    double CostUsd,
    int DurationMs,
    bool WasEscalated
);
