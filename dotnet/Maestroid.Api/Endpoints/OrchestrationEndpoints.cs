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
            var result = await prePlanning.RunAsync(req.Task, req.Context, ct);
            return Results.Ok(result);
        })
        .WithName("PrePlan")
        .WithSummary("Phase 0: analyze task complexity and decide if planning is needed");

        // POST /orchestration/plan
        group.MapPost("/plan", async (
            PlanRequest req,
            PlanningService planning,
            CancellationToken ct) =>
        {
            var result = await planning.RunAsync(req.Task, req.PrePlanning, ct);
            return Results.Ok(result);
        })
        .WithName("Plan")
        .WithSummary("Phase 1: decompose task into a Work Breakdown Structure");

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

        return app;
    }
}

public record PrePlanRequest(string Task, string? Context = null);
public record PlanRequest(string Task, PrePlanningResult? PrePlanning = null);

public record CodeAgentRequest(
    string Task,
    string RoleName,
    string RoleInstructions,
    string? WorkingDirectory = null,
    string[]? AllowedTools = null,
    string? PermissionMode = null
);
