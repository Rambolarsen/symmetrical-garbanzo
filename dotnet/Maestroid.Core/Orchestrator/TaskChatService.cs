using System.Text;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;

namespace Maestroid.Core.Orchestrator;

public record TaskChatMessage(string Role, string Content);

public record TaskChatRequest(
    string TaskTitle,
    string Spec,
    string Phase,
    IReadOnlyList<TaskChatMessage> Messages,
    PrePlanningResult? PrePlanning = null,
    PlanningResult? Planning = null,
    string? Transcript = null
);

public record TaskChatResult(string Output);

/// <summary>
/// Task-aware discussion loop for refining the spec before or during planning.
/// This is advisory only: it comments on the current spec and proposes explicit
/// clarification text the user can choose to apply.
/// </summary>
public class TaskChatService(IServiceProvider services)
{
    private const string SystemPrompt = """
        You are helping a human refine a task specification before or during planning.

        Your job:
        - comment on the current spec
        - spot missing details, ambiguity, contradictions, and under-specified requirements
        - ask concise follow-up questions when clarification is needed
        - when useful, propose exact text the user can add to the spec

        Rules:
        - do not claim you changed the spec
        - do not act like an execution agent
        - keep answers grounded in the task and existing planning context
        - if you have a concrete edit suggestion, end your response with exactly this heading:
          Clarification Draft:
          followed by concise bullet points or short prose the user can add to the spec
        - if no concrete spec addition is needed, omit the Clarification Draft section
        """;

    private IChatClient? ResolveClient(string phase)
    {
        var tier = string.Equals(phase, "pre-planning", StringComparison.OrdinalIgnoreCase)
            ? "fast"
            : "balanced";
        return (services as IKeyedServiceProvider)?.GetKeyedService<IChatClient>(tier);
    }

    private static string ResolveTier(string phase) =>
        string.Equals(phase, "pre-planning", StringComparison.OrdinalIgnoreCase) ? "fast" : "balanced";

    public async Task<TaskChatResult> RunAsync(
        TaskChatRequest input,
        Func<PlanProgressEvent, CancellationToken, Task>? onProgress = null,
        CancellationToken ct = default)
    {
        var chatClient = ResolveClient(input.Phase);
        if (chatClient is null)
            throw new InvalidOperationException("No LLM provider available. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or start Ollama (ollama serve).");

        var tier = ResolveTier(input.Phase);
        if (onProgress is not null)
            await onProgress(new PlanProgressEvent(
                "progress",
                "Reviewing the current spec and discussion context…",
                Phase: input.Phase,
                Tier: tier), ct);

        var messages = BuildMessages(input);

        try
        {
            var sb = new StringBuilder();
            await foreach (var update in chatClient.GetStreamingResponseAsync(messages, cancellationToken: ct).WithCancellation(ct))
            {
                if (string.IsNullOrEmpty(update.Text)) continue;

                sb.Append(update.Text);
                if (onProgress is not null)
                    await onProgress(new PlanProgressEvent(
                        "model_delta",
                        Text: update.Text,
                        Phase: input.Phase,
                        Tier: tier), ct);
            }

            return new TaskChatResult(sb.ToString());
        }
        catch (Exception ex) when (IsStreamingUnsupported(ex))
        {
            var response = await chatClient.GetResponseAsync(messages, cancellationToken: ct);
            if (onProgress is not null && !string.IsNullOrEmpty(response.Text))
                await onProgress(new PlanProgressEvent(
                    "model_delta",
                    Text: response.Text,
                    Phase: input.Phase,
                    Tier: tier), ct);
            return new TaskChatResult(response.Text);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new InvalidOperationException($"Task chat model call failed: {ex.Message}", ex);
        }
    }

    private static IReadOnlyList<ChatMessage> BuildMessages(TaskChatRequest input)
    {
        var messages = new List<ChatMessage>
        {
            new(ChatRole.System, SystemPrompt),
            new(ChatRole.User, BuildContextBlock(input)),
        };

        foreach (var message in input.Messages)
        {
            var role = string.Equals(message.Role, "assistant", StringComparison.OrdinalIgnoreCase)
                ? ChatRole.Assistant
                : ChatRole.User;
            messages.Add(new ChatMessage(role, message.Content));
        }

        return messages;
    }

    private static string BuildContextBlock(TaskChatRequest input)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"Task Title: {input.TaskTitle}");
        sb.AppendLine($"Current Phase: {input.Phase}");
        sb.AppendLine();
        sb.AppendLine("Current Spec (source of truth):");
        sb.AppendLine(input.Spec);

        if (input.PrePlanning is not null)
        {
            sb.AppendLine();
            sb.AppendLine("Current Pre-Planning Context:");
            sb.AppendLine($"- Complexity: {input.PrePlanning.ComplexityScore}/100 ({input.PrePlanning.ComplexityLevel})");
            sb.AppendLine($"- Requires planning: {input.PrePlanning.RequiresPlanning}");
            if (!string.IsNullOrWhiteSpace(input.PrePlanning.ScoreRationale))
                sb.AppendLine($"- Rationale: {input.PrePlanning.ScoreRationale}");
            foreach (var risk in input.PrePlanning.Risks.Take(3))
                sb.AppendLine($"- Risk [{risk.Severity}]: {risk.Description}");
        }

        if (input.Planning is not null)
        {
            var workPackages = input.Planning.Wbs.Elements.Count(element => element.IsWorkPackage);
            sb.AppendLine();
            sb.AppendLine("Current Planning Context:");
            sb.AppendLine($"- Work packages: {workPackages}");
            sb.AppendLine($"- Total estimated hours: {input.Planning.Wbs.TotalEstimatedHours:F0}h");
            foreach (var phase in input.Planning.ExecutionPlan.Take(4))
                sb.AppendLine($"- Phase {phase.PhaseNumber}: {phase.Name}");
        }

        if (!string.IsNullOrWhiteSpace(input.Transcript))
        {
            var transcript = input.Transcript.Trim();
            const int maxChars = 4000;
            if (transcript.Length > maxChars)
                transcript = transcript[^maxChars..];

            sb.AppendLine();
            sb.AppendLine("Recent Raw Debug Transcript Excerpt:");
            sb.AppendLine(transcript);
        }

        sb.AppendLine();
        sb.AppendLine("Use this context to discuss the spec and propose clarifications the human can apply.");
        return sb.ToString().Trim();
    }

    private static bool IsStreamingUnsupported(Exception ex) =>
        ex is NotSupportedException ||
        (ex.Message.Contains("stream", StringComparison.OrdinalIgnoreCase) &&
         ex.Message.Contains("not supported", StringComparison.OrdinalIgnoreCase));
}
