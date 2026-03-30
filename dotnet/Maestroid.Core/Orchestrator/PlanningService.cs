using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;

namespace Maestroid.Core.Orchestrator;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

public record WBSElement(
    string Id,
    int Level,
    string Title,
    string Description,
    string? ParentId,
    IReadOnlyList<string> ChildrenIds,
    bool IsWorkPackage,
    double? EstimatedHours,
    double? EstimatedCost,
    AgentRole? AssignedAgent,
    IReadOnlyList<string> Prerequisites,
    string Status,
    string? Deliverable,
    IReadOnlyList<string> SuccessCriteria
);

public record WorkBreakdownStructure(
    string ProjectId,
    double TotalEstimatedHours,
    double TotalEstimatedCost,
    IReadOnlyList<WBSElement> Elements,
    double CriticalPathHours,
    int ParallelOpportunities
);

public record ExecutionPhase(
    int PhaseNumber,
    string Name,
    IReadOnlyList<string> WorkPackageIds,
    bool CanParallelize
);

public record PlanningResult(
    string ScopeId,
    string Specification,
    WorkBreakdownStructure Wbs,
    IReadOnlyList<ExecutionPhase> ExecutionPlan
);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/// <summary>
/// Phase 1: Planning.
/// Decomposes a task into a Work Breakdown Structure following the 8/80 rule.
/// </summary>
public class PlanningService(IServiceProvider services)
{
    private IChatClient? chatClient =>
        (services as IKeyedServiceProvider)?.GetKeyedService<IChatClient>("balanced");

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private const string SystemPrompt = """
        You are a project planning agent. Decompose the given task into a Work Breakdown Structure (WBS).

        Rules:
        - 100% Rule: children hours must sum to parent hours exactly
        - 8/80 Rule: work packages (leaf nodes) must be 8–80 hours each
        - Max 4 levels of hierarchy
        - Each work package needs: deliverable, successCriteria, assignedAgent, prerequisites
        - Prerequisites reference other element IDs ("1.1.1", "2.3", etc.)
        - Group work packages into sequential execution phases respecting dependencies
        - Parallel tasks within a phase are fine (canParallelize: true)

        Use the pre-planning context (risks, constraints, recommendedAgents) to inform agent assignments.

        Return ONLY valid JSON matching this schema:
        {
          "specification": string,
          "elements": [
            {
              "id": string,                       // e.g. "1", "1.1", "1.1.2"
              "level": number,                    // 1–4
              "title": string,
              "description": string,
              "parentId": string | null,
              "childrenIds": string[],
              "isWorkPackage": boolean,           // true only for leaf nodes
              "estimatedHours": number | null,    // required for work packages
              "assignedAgent": { "name": string, "instructions": string } | null,
              "prerequisites": string[],          // element IDs that must complete first
              "deliverable": string | null,       // required for work packages
              "successCriteria": string[]         // required for work packages
            }
          ],
          "executionPhases": [
            {
              "phaseNumber": number,
              "name": string,
              "workPackageIds": string[],
              "canParallelize": boolean
            }
          ]
        }
        """;

    private const string JsonRepairPrompt = """
        You repair LLM output into strict RFC 8259 JSON.

        Rewrite the provided content as valid JSON only.
        Rules:
        - Output exactly one JSON object
        - Use double-quoted property names and string values
        - Remove markdown fences and prose
        - Preserve the original meaning as closely as possible
        - Do not add commentary
        """;

    public async Task<PlanningResult> RunAsync(
        string task,
        PrePlanningResult? prePlanning = null,
        CancellationToken ct = default)
    {
        if (chatClient is null)
            throw new InvalidOperationException("No LLM provider available. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or start Ollama (ollama serve).");

        var prompt = BuildPrompt(task, prePlanning);

        ChatResponse response;
        try
        {
            response = await chatClient.GetResponseAsync(
                [new ChatMessage(ChatRole.System, SystemPrompt),
                 new ChatMessage(ChatRole.User, prompt)],
                cancellationToken: ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new InvalidOperationException(
                $"Planning model call failed: {ex.Message}",
                ex);
        }

        var json = await ExtractValidJsonAsync(response.Text, ct);

        var dto = JsonSerializer.Deserialize<PlanningResponseDto>(json, JsonOptions)
            ?? throw new InvalidOperationException("LLM returned null planning response.");

        return BuildResult(task, prePlanning, dto);
    }

    private static string BuildPrompt(string task, PrePlanningResult? pre)
    {
        if (pre is null) return $"Task: {task}";

        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"Task: {task}");
        sb.AppendLine();
        sb.AppendLine("Pre-planning context:");
        sb.AppendLine($"  Complexity: {pre.ComplexityScore}/100 ({pre.ComplexityLevel})");
        sb.AppendLine($"  Estimated hours: {pre.EstimatedHours}h");

        if (pre.Constraints.Count > 0)
        {
            sb.AppendLine("  Constraints:");
            foreach (var c in pre.Constraints) sb.AppendLine($"    - {c}");
        }

        if (pre.Risks.Count > 0)
        {
            sb.AppendLine("  Risks:");
            foreach (var r in pre.Risks) sb.AppendLine($"    - [{r.Severity}] {r.Description}");
        }

        if (pre.RecommendedAgents.Count > 0)
        {
            sb.AppendLine("  Recommended agents:");
            foreach (var a in pre.RecommendedAgents) sb.AppendLine($"    - {a.Name}: {a.Instructions}");
        }

        return sb.ToString();
    }

    private static PlanningResult BuildResult(string task, PrePlanningResult? pre, PlanningResponseDto dto)
    {
        var scopeId = pre?.ScopeId ?? $"scope_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";

        var elements = dto.Elements.Select(e => new WBSElement(
            Id: e.Id,
            Level: e.Level,
            Title: e.Title,
            Description: e.Description,
            ParentId: e.ParentId,
            ChildrenIds: e.ChildrenIds ?? [],
            IsWorkPackage: e.IsWorkPackage,
            EstimatedHours: e.EstimatedHours,
            EstimatedCost: e.EstimatedHours.HasValue ? EstimateCost(e.EstimatedHours.Value) : null,
            AssignedAgent: e.AssignedAgent is { } a ? new AgentRole(a.Name, a.Instructions) : null,
            Prerequisites: e.Prerequisites ?? [],
            Status: "pending",
            Deliverable: e.Deliverable,
            SuccessCriteria: e.SuccessCriteria ?? []
        )).ToList();

        var workPackages = elements.Where(e => e.IsWorkPackage).ToList();
        var totalHours = workPackages.Sum(e => e.EstimatedHours ?? 0);
        var totalCost = workPackages.Sum(e => e.EstimatedCost ?? 0);
        var criticalPathHours = ComputeCriticalPath(elements);
        var parallelOps = workPackages.Count - dto.ExecutionPhases.Count;

        var wbs = new WorkBreakdownStructure(
            ProjectId: scopeId,
            TotalEstimatedHours: totalHours,
            TotalEstimatedCost: totalCost,
            Elements: elements,
            CriticalPathHours: criticalPathHours,
            ParallelOpportunities: Math.Max(0, parallelOps)
        );

        var phases = dto.ExecutionPhases.Select(p => new ExecutionPhase(
            PhaseNumber: p.PhaseNumber,
            Name: p.Name,
            WorkPackageIds: p.WorkPackageIds ?? [],
            CanParallelize: p.CanParallelize
        )).ToList();

        return new PlanningResult(scopeId, dto.Specification, wbs, phases);
    }

    // Sonnet pricing: $3/M input, $15/M output — approx $0.625/agent-hour
    private static double EstimateCost(double hours) => hours * 0.625;

    private static double ComputeCriticalPath(IReadOnlyList<WBSElement> elements)
    {
        // Simple: sum the longest sequential chain through prerequisite links
        var byId = elements.ToDictionary(e => e.Id);
        var memo = new Dictionary<string, double>();

        double Longest(string id)
        {
            if (memo.TryGetValue(id, out var cached)) return cached;
            if (!byId.TryGetValue(id, out var el)) return 0;

            var selfHours = el.IsWorkPackage ? el.EstimatedHours ?? 0 : 0;
            var prereqMax = el.Prerequisites.Count > 0
                ? el.Prerequisites.Max(p => Longest(p))
                : 0;

            return memo[id] = selfHours + prereqMax;
        }

        var workPackageIds = elements.Where(e => e.IsWorkPackage).Select(e => e.Id);
        return workPackageIds.Select(Longest).DefaultIfEmpty(0).Max();
    }

    public static string FormatReport(PlanningResult r)
    {
        var lines = new List<string>
        {
            "━━━ Planning Report ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            $"Specification: {r.Specification}",
            "",
            $"Work packages:  {r.Wbs.Elements.Count(e => e.IsWorkPackage)}",
            $"Total hours:    {r.Wbs.TotalEstimatedHours:F0}h",
            $"Critical path:  {r.Wbs.CriticalPathHours:F0}h",
            $"Parallel saves: ~{r.Wbs.TotalEstimatedHours - r.Wbs.CriticalPathHours:F0}h",
            $"Est. cost:      ~${r.Wbs.TotalEstimatedCost:F2}",
            "",
        };

        foreach (var phase in r.ExecutionPlan)
        {
            lines.Add($"Phase {phase.PhaseNumber}: {phase.Name}" +
                      (phase.CanParallelize ? " (parallelizable)" : ""));
            foreach (var id in phase.WorkPackageIds)
            {
                var el = r.Wbs.Elements.FirstOrDefault(e => e.Id == id);
                if (el is not null)
                    lines.Add($"  {id}  {el.Title}  ({el.EstimatedHours}h)");
            }
            lines.Add("");
        }

        lines.Add("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        return string.Join('\n', lines);
    }

    private static string ExtractJson(string raw)
    {
        var text = raw.Trim();

        if (text.StartsWith("```"))
        {
            text = text.Split('\n').Skip(1).TakeWhile(l => !l.StartsWith("```"))
                       .Aggregate((a, b) => $"{a}\n{b}");
        }

        var start = text.IndexOf('{');
        var end   = text.LastIndexOf('}');
        if (start >= 0 && end > start)
            text = text[start..(end + 1)];

        return text.Trim();
    }

    private async Task<string> ExtractValidJsonAsync(string raw, CancellationToken ct)
    {
        var json = ExtractJson(raw);

        try
        {
            using var _ = JsonDocument.Parse(json);
            return json;
        }
        catch (JsonException firstEx)
        {
            var repaired = await RepairJsonAsync(raw, ct);

            try
            {
                using var __ = JsonDocument.Parse(repaired);
                return repaired;
            }
            catch (JsonException secondEx)
            {
                var preview = CreatePreview(repaired);
                throw new InvalidOperationException(
                    $"LLM returned invalid JSON for planning: {secondEx.Message}. Preview: {preview}",
                    new AggregateException(firstEx, secondEx));
            }
        }
    }

    private async Task<string> RepairJsonAsync(string raw, CancellationToken ct)
    {
        if (chatClient is null)
            throw new InvalidOperationException("No LLM provider available for JSON repair.");

        ChatResponse repairResponse;
        try
        {
            repairResponse = await chatClient.GetResponseAsync(
                [new ChatMessage(ChatRole.System, JsonRepairPrompt),
                 new ChatMessage(ChatRole.User, raw)],
                cancellationToken: ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new InvalidOperationException(
                $"Planning JSON repair failed: {ex.Message}",
                ex);
        }

        return ExtractJson(repairResponse.Text);
    }

    private static string CreatePreview(string text)
    {
        const int maxLength = 160;
        var singleLine = text.Replace('\n', ' ').Replace('\r', ' ').Trim();
        return singleLine.Length <= maxLength
            ? singleLine
            : $"{singleLine[..maxLength]}...";
    }
}

// ---------------------------------------------------------------------------
// Private DTOs for JSON deserialization
// ---------------------------------------------------------------------------

internal sealed class PlanningResponseDto
{
    public string Specification { get; set; } = "";
    public List<ElementDto> Elements { get; set; } = [];
    public List<PhaseDto> ExecutionPhases { get; set; } = [];
}

internal sealed class ElementDto
{
    public string Id { get; set; } = "";
    public int Level { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string? ParentId { get; set; }
    public List<string>? ChildrenIds { get; set; }
    public bool IsWorkPackage { get; set; }
    public double? EstimatedHours { get; set; }
    public AgentDto? AssignedAgent { get; set; }
    public List<string>? Prerequisites { get; set; }
    public string? Deliverable { get; set; }
    public List<string>? SuccessCriteria { get; set; }
}

internal sealed class AgentDto
{
    public string Name { get; set; } = "";
    public string Instructions { get; set; } = "";
}

internal sealed class PhaseDto
{
    public int PhaseNumber { get; set; }
    public string Name { get; set; } = "";
    public List<string>? WorkPackageIds { get; set; }
    public bool CanParallelize { get; set; }
}
