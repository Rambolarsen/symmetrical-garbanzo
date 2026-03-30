using Maestroid.Api.Agents;
using Maestroid.Core.Orchestrator;
using Maestroid.Api.Endpoints;

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

// ---------------------------------------------------------------------------
// Claude Code sidecar client
// Aspire service discovery resolves "claude-code-sidecar" → actual URL
// ---------------------------------------------------------------------------

builder.Services.AddHttpClient<ClaudeCodeSidecarClient>(client =>
{
    client.BaseAddress = new Uri("http://claude-code-sidecar");
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

app.MapOrchestrationEndpoints();

app.Run();
