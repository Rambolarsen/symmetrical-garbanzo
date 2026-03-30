var builder = DistributedApplication.CreateBuilder(args);

// Claude Code sidecar — TypeScript/Node.js, wraps @anthropic-ai/claude-agent-sdk
var sidecar = builder
    .AddJavaScriptApp("claude-code-sidecar", "../../")   // root = sidecar project dir
    .WithHttpEndpoint(port: 3000, env: "PORT")
    .WithEnvironment("ANTHROPIC_API_KEY", builder.Configuration["ANTHROPIC_API_KEY"] ?? "");

// Main orchestration API
builder
    .AddProject<Projects.Maestroid_Api>("maestroid-api")
    .WithReference(sidecar)                              // injects services__claude-code-sidecar__http__0
    .WithEnvironment("ANTHROPIC_API_KEY", builder.Configuration["ANTHROPIC_API_KEY"] ?? "")
    .WithEnvironment("OPENAI_API_KEY", builder.Configuration["OPENAI_API_KEY"] ?? "")
    .WithEnvironment("GOOGLE_API_KEY", builder.Configuration["GOOGLE_API_KEY"] ?? "");

// Web UI
builder
    .AddJavaScriptApp("maestroid-web", "../../web")
    .WithHttpEndpoint(port: 5173, env: "PORT");

builder.Build().Run();
