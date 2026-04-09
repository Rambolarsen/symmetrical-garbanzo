using Maestroid.Api.Agents;
using Maestroid.Core.Orchestrator;

namespace Maestroid.Api.Endpoints;

public static class OrchestrationEndpoints
{
    public static IEndpointRouteBuilder MapOrchestrationEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/orchestration").WithOpenApi();

        // POST /orchestration/pre-plan
        group.MapPost("/pre-plan", async (
            PrePlanRequest req,
            PrePlanningService prePlanning,
            CancellationToken ct) =>
        {
            try
            {
                var result = await prePlanning.RunAsync(req.Task, req.Context, ct);
                return Results.Ok(result);
            }
            catch (TimeoutException tex)
            {
                return Results.Problem(tex.Message, statusCode: 504);
            }
            catch (OperationCanceledException)
            {
                return Results.StatusCode(499);
            }
            catch (InvalidOperationException ex)
            {
                return Results.Problem(ex.Message, statusCode: 502);
            }
        })
        .WithName("PrePlan")
        .WithSummary("Phase 0: analyze task complexity and decide if planning is needed");

        // POST /orchestration/plan
        group.MapPost("/plan", async (
            PlanRequest req,
            PlanningService planning,
            ClaudeCodeSidecarClient sidecar,
            CancellationToken ct) =>
        {
            // Enrich context with task-specific Serena search (best-effort, never throws)
            var context = req.Context;
            if (!string.IsNullOrWhiteSpace(req.ProjectPath))
            {
                var serenaContext = await sidecar.GetSerenaContextAsync(req.ProjectPath, req.Task, ct);
                if (!string.IsNullOrWhiteSpace(serenaContext))
                {
                    context = $"{context}\n\n---\nTask-relevant code (from Serena):\n{serenaContext}";
                    Console.WriteLine($"[Plan] Serena context enriched: {serenaContext.Length} chars");
                }
            }

            try
            {
                var result = await planning.RunAsync(req.Task, req.PrePlanning, context, ct);
                return Results.Ok(result);
            }
            catch (TimeoutException tex)
            {
                return Results.Problem(tex.Message, statusCode: 504);
            }
            catch (OperationCanceledException)
            {
                return Results.StatusCode(499);
            }
            catch (InvalidOperationException ex)
            {
                return Results.Problem(ex.Message, statusCode: 502);
            }
        })
        .WithName("Plan")
        .WithSummary("Phase 1: decompose task into a Work Breakdown Structure");

        // GET /orchestration/pick-folder — opens native macOS folder picker, returns chosen path
        group.MapGet("/pick-folder", async (CancellationToken ct) =>
        {
            using var process = new System.Diagnostics.Process
            {
                StartInfo = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "osascript",
                    Arguments = "-e \"POSIX path of (choose folder)\"",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                }
            };

            process.Start();
            var output = await process.StandardOutput.ReadToEndAsync(ct);
            await process.WaitForExitAsync(ct);

            var path = output.Trim().TrimEnd('/');
            if (string.IsNullOrEmpty(path)) return Results.BadRequest("No folder selected");

            // Verify the chosen folder is a git repository
            using var gitCheck = new System.Diagnostics.Process
            {
                StartInfo = new System.Diagnostics.ProcessStartInfo
                {
                    FileName               = "git",
                    Arguments              = "rev-parse --git-dir",
                    WorkingDirectory       = path,
                    UseShellExecute        = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError  = true,
                    CreateNoWindow         = true,
                }
            };
            gitCheck.Start();
            await gitCheck.WaitForExitAsync(ct);

            if (gitCheck.ExitCode != 0)
                return Results.Problem(
                    $"The selected folder is not a git repository. Run 'git init' inside it or choose a folder that is already a git repo.",
                    statusCode: 422);

            return Results.Ok(new { path });
        })
        .WithName("PickFolder")
        .WithSummary("Open native macOS folder picker and return the chosen path");

        // POST /orchestration/repo-context
        group.MapPost("/repo-context", async (
            RepoContextRequest req,
            RepoContextService repoContext,
            CancellationToken ct) =>
        {
            var result = await repoContext.RunAsync(req.Source, req.GithubToken, ct);
            return Results.Ok(result);
        })
        .WithName("RepoContext")
        .WithSummary("Extract project context from a local folder path or GitHub URL");

        // POST /orchestration/serena-context
        group.MapPost("/serena-context", async (
            SerenaContextRequest req,
            ClaudeCodeSidecarClient sidecar,
            CancellationToken ct) =>
        {
            var context = await sidecar.GetSerenaContextAsync(req.ProjectPath, req.Task, ct);
            return Results.Ok(new { context });
        })
        .WithName("SerenaContext")
        .WithSummary("Get task-specific Serena code context for a local project path");

        // POST /orchestration/code-agent
        group.MapPost("/code-agent", async (
            CodeAgentRequest req,
            ClaudeCodeSidecarClient sidecar,
            CancellationToken ct) =>
        {
            var result = await sidecar.RunAsync(new RunAgentRequest(
                Task: req.Task,
                Role: new AgentRole(req.RoleName, req.RoleInstructions),
                WorkingDirectory: req.WorkingDirectory,
                AllowedTools: req.AllowedTools,
                PermissionMode: req.PermissionMode ?? "default"
            ), ct);
            return Results.Ok(result);
        })
        .WithName("RunCodeAgent")
        .WithSummary("Run a Claude Code agent task via the TypeScript sidecar");

        // POST /orchestration/execute — SSE-streaming execution (proxies sidecar stream)
        group.MapPost("/execute", async (
            ExecuteRequest req,
            ClaudeCodeSidecarClient sidecar,
            HttpContext http,
            CancellationToken ct) =>
        {
            http.Response.ContentType = "text/event-stream";
            http.Response.Headers.CacheControl = "no-cache";
            http.Response.Headers.Connection = "keep-alive";
            http.Response.Headers["X-Accel-Buffering"] = "no";

            await foreach (var line in sidecar.StreamAsync(new StreamAgentRequest(
                Task: req.Task,
                Role: new AgentRole(req.RoleName, req.RoleInstructions),
                WorkingDirectory: req.WorkingDirectory,
                AllowedTools: req.AllowedTools,
                PermissionMode: req.PermissionMode ?? "default",
                EnableClarification: req.EnableClarification ?? true
            ), ct))
            {
                await http.Response.WriteAsync(line + "\n", ct);
                await http.Response.Body.FlushAsync(ct);
            }
        })
        .WithName("ExecuteStream")
        .WithSummary("Run an AI agent with SSE streaming — proxies sidecar stream");

        // POST /orchestration/clarify/{requestId} — forward human answer to unblock a paused agent
        group.MapPost("/clarify/{requestId}", async (
            string requestId,
            ClarifyRequest req,
            ClaudeCodeSidecarClient sidecar,
            CancellationToken ct) =>
        {
            await sidecar.ClarifyAsync(requestId, req.Answer, ct);
            return Results.Ok(new { ok = true });
        })
        .WithName("Clarify")
        .WithSummary("Send a human clarification answer to resume a paused agent");

        // POST /orchestration/verify — run LLM verification against success criteria
        group.MapPost("/verify", async (
            VerifyRequest req,
            VerificationService verification,
            CancellationToken ct) =>
        {
            var result = await verification.RunAsync(
                req.TaskTitle,
                req.SuccessCriteria,
                req.ExecutionOutput,
                ct);
            return Results.Ok(result);
        })
        .WithName("Verify")
        .WithSummary("Phase 3: verify execution output against success criteria");

        return app;
    }
}

public record PrePlanRequest(string Task, string? Context = null);
public record PlanRequest(string Task, PrePlanningResult? PrePlanning = null, string? Context = null, string? ProjectPath = null);

public record RepoContextRequest(string Source, string? GithubToken = null);
public record SerenaContextRequest(string ProjectPath, string Task);

public record CodeAgentRequest(
    string Task,
    string RoleName,
    string RoleInstructions,
    string? WorkingDirectory = null,
    string[]? AllowedTools = null,
    string? PermissionMode = null
);

public record ExecuteRequest(
    string Task,
    string RoleName,
    string RoleInstructions,
    string? WorkingDirectory = null,
    string[]? AllowedTools = null,
    string? PermissionMode = null,
    bool? EnableClarification = true
);

public record ClarifyRequest(string Answer);

public record VerifyRequest(
    string TaskTitle,
    IReadOnlyList<string> SuccessCriteria,
    string ExecutionOutput
);
