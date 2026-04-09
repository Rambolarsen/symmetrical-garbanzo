using Maestroid.Api.Agents;
using Maestroid.Core.Orchestrator;
using Maestroid.Api.Endpoints;
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
// Agent providers (all via IChatClient)
// ---------------------------------------------------------------------------

builder.Services.AddAgentProviders(builder.Configuration);

// ---------------------------------------------------------------------------
// Orchestration services
// ---------------------------------------------------------------------------

builder.Services.AddScoped<PrePlanningService>();
builder.Services.AddScoped<PlanningService>();
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

app.MapOpenApi();

// Health endpoints (Aspire convention)
app.MapGet("/health", () => Results.Ok("Healthy")).ExcludeFromDescription();
app.MapGet("/alive", () => Results.Ok("Alive")).ExcludeFromDescription();

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

app.MapOrchestrationEndpoints();

app.Run();

file static class OllamaLaunchState
{
    public static volatile bool IsLaunching;
}
