using Maestroid.Api.Agents;
using Maestroid.Core.Orchestrator;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Maestroid.Api.Endpoints;

public static class OrchestrationEndpoints
{
    private static readonly JsonSerializerOptions SseJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

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
                var result = await prePlanning.RunAsync(req.Task, req.Context, ct: ct);
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
                var result = await planning.RunAsync(req.Task, req.PrePlanning, context, ct: ct);
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

        // POST /orchestration/task-chat-stream — SSE-streaming task-aware spec discussion
        group.MapPost("/task-chat-stream", async (
            TaskChatStreamRequest req,
            TaskChatService taskChat,
            ModelSelectionService models,
            HttpContext http,
            CancellationToken ct) =>
        {
            var startedAt = DateTimeOffset.UtcNow;

            http.Response.ContentType = "text/event-stream";
            http.Response.Headers.CacheControl = "no-cache";
            http.Response.Headers.Connection = "keep-alive";
            http.Response.Headers["X-Accel-Buffering"] = "no";

            async Task Emit(object payload)
            {
                await http.Response.WriteAsync($"data: {JsonSerializer.Serialize(payload, SseJsonOptions)}\n\n", ct);
                await http.Response.Body.FlushAsync(ct);
            }

            try
            {
                var result = await taskChat.RunAsync(
                    new TaskChatRequest(
                        req.TaskTitle,
                        req.Spec,
                        req.Phase,
                        req.Messages.Select(m => new TaskChatMessage(m.Role, m.Content)).ToList(),
                        req.PrePlanning,
                        req.Planning,
                        req.Transcript),
                    onProgress: (e, token) => Emit(WithModelInfo(
                        e,
                        models,
                        req.Phase,
                        string.Equals(req.Phase, "pre-planning", StringComparison.OrdinalIgnoreCase) ? "fast" : "balanced",
                        startedAt)),
                    ct: ct);

                await Emit(new { type = "complete", output = result.Output });
            }
            catch (OperationCanceledException) { /* client disconnected */ }
            catch (Exception ex)
            {
                try { await Emit(new { type = "error", message = ex.Message }); } catch { /* response gone */ }
            }
        })
        .WithName("TaskChatStream")
        .WithSummary("Discuss and refine a task spec with the underlying model");

        // POST /orchestration/pre-plan-stream — SSE-streaming pre-planning
        group.MapPost("/pre-plan-stream", async (
            PrePlanRequest req,
            PrePlanningService prePlanning,
            ModelSelectionService models,
            HttpContext http,
            CancellationToken ct) =>
        {
            var startedAt = DateTimeOffset.UtcNow;

            http.Response.ContentType = "text/event-stream";
            http.Response.Headers.CacheControl = "no-cache";
            http.Response.Headers.Connection = "keep-alive";
            http.Response.Headers["X-Accel-Buffering"] = "no";

            async Task Emit(object payload)
            {
                await http.Response.WriteAsync($"data: {JsonSerializer.Serialize(payload, SseJsonOptions)}\n\n", ct);
                await http.Response.Body.FlushAsync(ct);
            }

            try
            {
                var result = await prePlanning.RunAsync(
                    req.Task, req.Context,
                    onProgress: (e, token) => Emit(WithModelInfo(e, models, "pre-planning", "fast", startedAt)),
                    ct: ct);
                await Emit(new { type = "complete", result });
            }
            catch (OperationCanceledException) { /* client disconnected */ }
            catch (Exception ex)
            {
                try { await Emit(new { type = "error", message = ex.Message }); } catch { /* response gone */ }
            }
        })
        .WithName("PrePlanStream")
        .WithSummary("Phase 0: pre-planning with SSE progress events");

        // POST /orchestration/plan-stream — SSE-streaming planning
        group.MapPost("/plan-stream", async (
            PlanRequest req,
            PlanningService planning,
            ClaudeCodeSidecarClient sidecar,
            ModelSelectionService models,
            HttpContext http,
            CancellationToken ct) =>
        {
            var startedAt = DateTimeOffset.UtcNow;

            http.Response.ContentType = "text/event-stream";
            http.Response.Headers.CacheControl = "no-cache";
            http.Response.Headers.Connection = "keep-alive";
            http.Response.Headers["X-Accel-Buffering"] = "no";

            async Task Emit(object payload)
            {
                await http.Response.WriteAsync($"data: {JsonSerializer.Serialize(payload, SseJsonOptions)}\n\n", ct);
                await http.Response.Body.FlushAsync(ct);
            }

            // Enrich context with Serena (best-effort)
            var context = req.Context;
            if (!string.IsNullOrWhiteSpace(req.ProjectPath))
            {
                var serenaContext = await sidecar.GetSerenaContextAsync(req.ProjectPath, req.Task, ct);
                if (!string.IsNullOrWhiteSpace(serenaContext))
                    context = $"{context}\n\n---\nTask-relevant code (from Serena):\n{serenaContext}";
            }

            try
            {
                var result = await planning.RunAsync(
                    req.Task, req.PrePlanning, context,
                    onProgress: (e, token) => Emit(WithModelInfo(e, models, "planning", "balanced", startedAt)),
                    ct: ct);
                await Emit(new { type = "complete", result });
            }
            catch (OperationCanceledException) { /* client disconnected */ }
            catch (Exception ex)
            {
                try { await Emit(new { type = "error", message = ex.Message }); } catch { /* response gone */ }
            }
        })
        .WithName("PlanStream")
        .WithSummary("Phase 1: planning with SSE progress events");

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

    private static PlanProgressEvent WithModelInfo(
        PlanProgressEvent progress,
        ModelSelectionService models,
        string defaultPhase,
        string defaultTier,
        DateTimeOffset startedAt)
    {
        var tier = string.IsNullOrWhiteSpace(progress.Tier) ? defaultTier : progress.Tier;
        var model = progress.Model ?? tier switch
        {
            "fast" => models.Fast,
            "balanced" => models.Balanced,
            _ => null,
        };
        var elapsedMs = progress.ElapsedMs ?? (int)Math.Max(0, (DateTimeOffset.UtcNow - startedAt).TotalMilliseconds);

        return progress with
        {
            Phase = progress.Phase ?? defaultPhase,
            Tier = tier,
            Model = model,
            ElapsedMs = elapsedMs,
        };
    }
}

public record PrePlanRequest(string Task, string? Context = null);
public record PlanRequest(string Task, PrePlanningResult? PrePlanning = null, string? Context = null, string? ProjectPath = null);

public record RepoContextRequest(string Source, string? GithubToken = null);
public record SerenaContextRequest(string ProjectPath, string Task);
public record TaskChatMessageRequest(string Role, string Content);
public record TaskChatStreamRequest(
    string TaskTitle,
    string Spec,
    string Phase,
    IReadOnlyList<TaskChatMessageRequest> Messages,
    PrePlanningResult? PrePlanning = null,
    PlanningResult? Planning = null,
    string? Transcript = null
);

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
