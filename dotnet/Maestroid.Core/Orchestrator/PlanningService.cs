using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
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
    private const int MaxPlanningAttempts = 2;
    private static readonly Regex WorkPackageIdPattern = new(@"^\d+(?:\.\d+){0,3}$", RegexOptions.Compiled);

    private IChatClient? chatClient =>
        (services as IKeyedServiceProvider)?.GetKeyedService<IChatClient>("balanced");

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private const string SystemPrompt = """
        You are a project planning agent. Decompose the given task into a Work Breakdown Structure (WBS).

        You are decomposing the TASK provided in the user message. That is your sole subject.
        The PROJECT CONTEXT block (if present) is read-only background — it tells you what codebase the task applies to.
        Use it to make work packages specific (name real files, services, endpoints, components) but never let it change what the task is.
        If the task says "add tests", decompose adding tests — not anything else in the context.
        Do not invent a different task. Do not decompose the project. Decompose exactly the task given.

        WBS Rules:
        - 100% Rule: children hours must sum to parent hours exactly
        - Work package size: aim for 2–40 hours each; for trivial tasks values as low as 0.25h are fine
        - Max 4 levels of hierarchy
        - Each work package (leaf node) MUST have: estimatedHours (a number, never null), deliverable, successCriteria, assignedAgent, prerequisites
        - CRITICAL: estimatedHours is REQUIRED for every element where isWorkPackage is true — never omit it, never set it to null
        - Prerequisites reference other element IDs ("1.1.1", "2.3", etc.)
        - Group work packages into sequential execution phases respecting dependencies
        - Parallel tasks within a phase are fine (canParallelize: true)

        Work package quality bar — every work package must meet ALL of these:
        - description: explain the specific change being made, which function or class is affected, and why
        - assignedAgent.instructions: write these as step-by-step actions an agent can execute directly.
          Example: "1. Open web/src/components/TaskCard.tsx. 2. Add useState(false) for errorExpanded. 3. Replace the <p> error element with a collapsible div that line-clamps to 3 lines when collapsed. 4. Add a 'Show more' button below that toggles the state."
          Bad example: "Update the error display component." — this is not acceptable.
          Every assignedAgent.instructions MUST begin with: "Open <specific file path>."
          If you cannot name the file, look harder at the file tree and Task-relevant code sections — every relevant file is listed.
          NEVER start instructions with the words "Refactor", "Update", "Improve", "Optimize", or "Apply" without naming a specific file path on the same line.
        - deliverable: always "path/to/file.ext — <what changed>", e.g. "web/src/components/TaskCard.tsx — expandable error UI with 3-line clamp"
          Never write a deliverable like "improved codebase" or "refactored module".
        - successCriteria: 2–4 items, each a concrete observable outcome, e.g. "Error text truncates to 3 lines by default", "Clicking 'Show more' reveals the full error", "Copy button copies the full error text to clipboard"

        Specification quality bar — the "specification" field is the implementation brief the coding agent will read before making changes:
        - Write it for the implementer, not for a stakeholder status update
        - Name the exact files, classes, functions, endpoints, schemas, and tests that should change or be created
        - Describe the implementation sequence concretely: what to edit first, what logic to add, what contracts must line up, and how the pieces fit together
        - Call out dependency order and any prerequisite work that must happen before later steps
        - Include validation guidance: what should be tested, run, or manually verified after the changes
        - If the project context identifies a likely file path, use it; do not say vague things like "update the relevant component"
        - Avoid generic phrasing like "implement the feature", "wire everything up", or "make necessary changes"

        Use the pre-planning context (risks, constraints, recommendedAgents) to inform agent assignments.

        Return ONLY valid JSON matching this schema:
        {
          "specification": string,          // Agent-ready implementation brief. Include concrete file paths, components/services/APIs, ordered implementation steps, dependency notes, and validation/test guidance. Specific enough that a coding agent could start editing immediately without guessing the architecture.
          "elements": [
            {
              "id": string,                       // e.g. "1", "1.1", "1.1.2"
              "level": number,                    // 1–4
              "title": string,
              "description": string,              // which specific file/function/class is changing and why
              "parentId": string | null,
              "childrenIds": string[],
              "isWorkPackage": boolean,           // true only for leaf nodes (no children)
              "estimatedHours": number,           // REQUIRED for work packages (isWorkPackage: true); set to 0 for parent nodes
              "assignedAgent": { "name": string, "instructions": string } | null,  // numbered step-by-step actions naming specific files
              "prerequisites": string[],          // element IDs that must complete first
              "deliverable": string | null,       // exact file(s) modified or created
              "successCriteria": string[]         // 2–4 concrete, observable, testable outcomes
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
        string? context = null,
        Func<PlanProgressEvent, CancellationToken, Task>? onProgress = null,
        CancellationToken ct = default)
    {
        if (chatClient is null)
            throw new InvalidOperationException("No LLM provider available. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or start Ollama (ollama serve).");

        var basePrompt = BuildPrompt(task, prePlanning, context);
        var prompt = basePrompt;
        List<string> issues = [];

        for (var attempt = 1; attempt <= MaxPlanningAttempts; attempt++)
        {
            if (onProgress is not null)
                await onProgress(new PlanProgressEvent("progress",
                    $"Decomposing task into work packages… (attempt {attempt}/{MaxPlanningAttempts})",
                    Phase: "planning",
                    Tier: "balanced",
                    Attempt: attempt,
                    MaxAttempts: MaxPlanningAttempts), ct);

            var dto = await RequestPlanningDtoAsync(prompt, onProgress, ct);
            issues = ValidatePlanningResponse(dto);

            if (issues.Count == 0)
                return BuildResult(task, prePlanning, dto);

            Console.WriteLine(
                $"[Planning] Rejected invalid planner output on attempt {attempt}/{MaxPlanningAttempts}: " +
                string.Join(" | ", issues.Take(8)));

            if (attempt < MaxPlanningAttempts)
            {
                if (onProgress is not null)
                    await onProgress(new PlanProgressEvent("retry",
                        Phase: "planning",
                        Tier: "balanced",
                        Attempt: attempt, MaxAttempts: MaxPlanningAttempts,
                        Issues: issues.Take(8).ToList()), ct);

                prompt = BuildRetryPrompt(basePrompt, issues);
            }
        }

        throw new InvalidOperationException(
            $"Planning model returned an invalid plan after {MaxPlanningAttempts} attempts: " +
            string.Join(" | ", issues.Take(8)));
    }

    private static string BuildPrompt(string task, PrePlanningResult? pre, string? context = null)
    {
        var sb = new System.Text.StringBuilder();

        // Task specification always comes first so the model anchors on it
        sb.AppendLine($"TASK SPECIFICATION:\n{task}");

        if (pre is not null)
        {
            sb.AppendLine();
            sb.AppendLine("Pre-planning analysis:");
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
        }

        // Project context comes last — background reference only, task drives the decomposition
        if (!string.IsNullOrWhiteSpace(context))
        {
            sb.AppendLine();
            sb.AppendLine("---");
            sb.AppendLine("PROJECT CONTEXT (background only — decompose the TASK above, not this):");
            sb.AppendLine(context);
        }

        return sb.ToString();
    }

    private static string BuildRetryPrompt(string basePrompt, IReadOnlyList<string> issues)
    {
        var sb = new System.Text.StringBuilder(basePrompt);
        sb.AppendLine();
        sb.AppendLine("---");
        sb.AppendLine("YOUR PREVIOUS RESPONSE WAS REJECTED. Regenerate the entire JSON plan from scratch and fix these issues:");

        foreach (var issue in issues.Take(10))
            sb.AppendLine($"- {issue}");

        sb.AppendLine("Do not leave any work package title, description, deliverable, assignedAgent, assignedAgent.name, assignedAgent.instructions, or phase name blank.");
        sb.AppendLine("Every execution phase must have a non-empty name and at least one valid work package ID.");
        return sb.ToString();
    }

    private async Task<PlanningResponseDto> RequestPlanningDtoAsync(
        string prompt,
        Func<PlanProgressEvent, CancellationToken, Task>? onProgress,
        CancellationToken ct)
    {
        if (chatClient is null)
            throw new InvalidOperationException("No LLM provider available. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or start Ollama (ollama serve).");

        string responseText;
        try
        {
            responseText = await RequestPrimaryTextAsync(prompt, onProgress, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new InvalidOperationException(
                $"Planning model call failed: {ex.Message}",
                ex);
        }

        var json = await ExtractValidJsonAsync(responseText, onProgress, ct);

        return JsonSerializer.Deserialize<PlanningResponseDto>(json, JsonOptions)
            ?? throw new InvalidOperationException("LLM returned null planning response.");
    }

    private static PlanningResult BuildResult(string task, PrePlanningResult? pre, PlanningResponseDto dto)
    {
        var scopeId = pre?.ScopeId ?? $"scope_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";

        // Collect all non-leaf element IDs from explicit and structurally-inferred parent-child relationships.
        var nonLeafIds = ComputeNonLeafIds(dto.Elements);

        var elements = dto.Elements.Select(e =>
        {
            // Work packages are leaf nodes only. Ignore model flags that mark parent nodes as work packages.
            var isWorkPackage = !nonLeafIds.Contains(e.Id);
            // Coerce hours: work packages must have a value; parent roll-up nodes default to 0
            double? hours = e.EstimatedHours.HasValue && e.EstimatedHours.Value > 0
                ? e.EstimatedHours
                : (isWorkPackage ? 1.0 : null);
            AgentRole? assignedAgent = null;

            if (e.AssignedAgent is { } a)
            {
                if (string.IsNullOrWhiteSpace(a.Name))
                {
                    var inferredName = InferAgentName(e);
                    Console.WriteLine(
                        $"[Planning] Work package '{e.Id}' ('{e.Title}') returned assignedAgent without a valid name. " +
                        $"Instructions present: {!string.IsNullOrWhiteSpace(a.Instructions)}. " +
                        $"Using fallback agent name '{inferredName}'.");
                    assignedAgent = new AgentRole(inferredName, a.Instructions);
                }
                else
                {
                    assignedAgent = new AgentRole(a.Name, a.Instructions);
                }
            }
            else if (isWorkPackage)
            {
                Console.WriteLine($"[Planning] Work package '{e.Id}' ('{e.Title}') returned assignedAgent: null.");
            }

            return new WBSElement(
                Id: e.Id,
                Level: e.Level,
                Title: e.Title,
                Description: e.Description,
                ParentId: e.ParentId,
                ChildrenIds: e.ChildrenIds ?? [],
                IsWorkPackage: isWorkPackage,
                EstimatedHours: hours,
                EstimatedCost: hours.HasValue ? EstimateCost(hours.Value) : null,
                AssignedAgent: assignedAgent,
                Prerequisites: e.Prerequisites ?? [],
                Status: "pending",
                Deliverable: e.Deliverable,
                SuccessCriteria: e.SuccessCriteria ?? []
            );
        }).ToList();

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

        var normalizedPhaseWorkPackageIds = NormalizePhaseAssignments(dto, nonLeafIds);
        var workPackageIdSet = workPackages
            .Select(e => e.Id)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var phases = BuildExecutionPhases(dto.ExecutionPhases, normalizedPhaseWorkPackageIds, workPackageIdSet);

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

        return SanitizeJson(text.Trim());
    }

    private static string SanitizeJson(string json)
    {
        json = Regex.Replace(json, @"//[^\n\r]*", "");
        json = Regex.Replace(json, @"/\*.*?\*/", "", RegexOptions.Singleline);
        json = Regex.Replace(json, @",\s*([\}\]])", "$1");
        json = EscapeControlCharsInStrings(json);
        return json.Trim();
    }

    /// <summary>
    /// Walks the raw JSON character by character and escapes any bare control
    /// characters (0x00–0x1F) that appear inside a JSON string literal.
    /// LLMs (especially local models) frequently emit literal newlines inside
    /// string values, which is invalid per RFC 8259.
    /// </summary>
    private static string EscapeControlCharsInStrings(string json)
    {
        var sb = new System.Text.StringBuilder(json.Length);
        var inString = false;
        var i = 0;

        while (i < json.Length)
        {
            var ch = json[i];

            if (inString)
            {
                if (ch == '\\' && i + 1 < json.Length)
                {
                    // Already-escaped sequence — copy both chars verbatim
                    sb.Append(ch);
                    sb.Append(json[i + 1]);
                    i += 2;
                    continue;
                }

                if (ch == '"')
                {
                    inString = false;
                    sb.Append(ch);
                }
                else if (ch < 0x20) // bare control character — must be escaped
                {
                    sb.Append(ch switch
                    {
                        '\n' => "\\n",
                        '\r' => "\\r",
                        '\t' => "\\t",
                        '\b' => "\\b",
                        '\f' => "\\f",
                        _    => $"\\u{(int)ch:x4}",
                    });
                }
                else
                {
                    sb.Append(ch);
                }
            }
            else
            {
                if (ch == '"') inString = true;
                sb.Append(ch);
            }

            i++;
        }

        return sb.ToString();
    }

    private async Task<string> ExtractValidJsonAsync(
        string raw,
        Func<PlanProgressEvent, CancellationToken, Task>? onProgress,
        CancellationToken ct)
    {
        var json = ExtractJson(raw);

        try
        {
            using var _ = JsonDocument.Parse(json);
            return json;
        }
        catch (JsonException firstEx)
        {
            if (onProgress is not null)
                await onProgress(new PlanProgressEvent(
                    "progress",
                    "Repairing malformed JSON…",
                    Phase: "planning",
                    Tier: "balanced"), ct);

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

    private async Task<string> RequestPrimaryTextAsync(
        string prompt,
        Func<PlanProgressEvent, CancellationToken, Task>? onProgress,
        CancellationToken ct)
    {
        if (chatClient is null)
            throw new InvalidOperationException("No LLM provider available.");

        var messages = new[]
        {
            new ChatMessage(ChatRole.System, SystemPrompt),
            new ChatMessage(ChatRole.User, prompt),
        };

        try
        {
            var sb = new System.Text.StringBuilder();
            await foreach (var update in chatClient.GetStreamingResponseAsync(messages, cancellationToken: ct).WithCancellation(ct))
            {
                if (string.IsNullOrEmpty(update.Text)) continue;

                sb.Append(update.Text);
                if (onProgress is not null)
                    await onProgress(new PlanProgressEvent(
                        "model_delta",
                        Text: update.Text,
                        Phase: "planning",
                        Tier: "balanced"), ct);
            }

            return sb.ToString();
        }
        catch (Exception ex) when (IsStreamingUnsupported(ex))
        {
            var response = await chatClient.GetResponseAsync(messages, cancellationToken: ct);
            if (onProgress is not null && !string.IsNullOrEmpty(response.Text))
                await onProgress(new PlanProgressEvent(
                    "model_delta",
                    Text: response.Text,
                    Phase: "planning",
                    Tier: "balanced"), ct);
            return response.Text;
        }
    }

    private static bool IsStreamingUnsupported(Exception ex) =>
        ex is NotSupportedException ||
        (ex.Message.Contains("stream", StringComparison.OrdinalIgnoreCase) &&
         ex.Message.Contains("not supported", StringComparison.OrdinalIgnoreCase));

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

    /// <summary>
    /// Computes the set of non-leaf element IDs using explicit childrenIds/parentId fields
    /// AND structural inference from hierarchical IDs (e.g. "1.1" implies "1" is a parent).
    /// </summary>
    private static HashSet<string> ComputeNonLeafIds(List<ElementDto> elements)
    {
        var allIds = elements
            .Select(e => e.Id)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var nonLeafIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        // Explicit children via childrenIds
        foreach (var e in elements.Where(e => e.ChildrenIds is { Count: > 0 }))
            nonLeafIds.Add(e.Id);

        // Explicit parent references via parentId
        foreach (var e in elements.Where(e => !string.IsNullOrWhiteSpace(e.ParentId)))
            nonLeafIds.Add(e.ParentId!);

        // Infer parent from ID structure: "1.1" → "1" is a parent, "1.2.3" → "1.2" is a parent
        foreach (var e in elements.Where(e => !string.IsNullOrWhiteSpace(e.Id)))
        {
            var lastDot = e.Id.LastIndexOf('.');
            if (lastDot > 0)
            {
                var inferredParentId = e.Id[..lastDot];
                if (allIds.Contains(inferredParentId))
                    nonLeafIds.Add(inferredParentId);
            }
        }

        return nonLeafIds;
    }

    private static Dictionary<string, List<string>> BuildChildMap(PlanningResponseDto dto)
    {
        var childMap = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);

        foreach (var element in dto.Elements)
        {
            if (!childMap.ContainsKey(element.Id))
                childMap[element.Id] = [];

            foreach (var childId in element.ChildrenIds ?? [])
            {
                if (string.IsNullOrWhiteSpace(childId)) continue;
                if (!childMap.TryGetValue(element.Id, out var children))
                {
                    children = [];
                    childMap[element.Id] = children;
                }
                if (!children.Contains(childId, StringComparer.OrdinalIgnoreCase))
                    children.Add(childId);
            }
        }

        foreach (var element in dto.Elements)
        {
            if (string.IsNullOrWhiteSpace(element.ParentId)) continue;
            if (!childMap.TryGetValue(element.ParentId, out var children))
            {
                children = [];
                childMap[element.ParentId] = children;
            }
            if (!children.Contains(element.Id, StringComparer.OrdinalIgnoreCase))
                children.Add(element.Id);
        }

        // Infer parent-child from ID structure for elements that didn't set parentId/childrenIds
        var allIds = dto.Elements
            .Select(e => e.Id)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var element in dto.Elements.Where(e => !string.IsNullOrWhiteSpace(e.Id)))
        {
            var lastDot = element.Id.LastIndexOf('.');
            if (lastDot <= 0) continue;

            var inferredParentId = element.Id[..lastDot];
            if (!allIds.Contains(inferredParentId)) continue;

            if (!childMap.TryGetValue(inferredParentId, out var children))
            {
                children = [];
                childMap[inferredParentId] = children;
            }
            if (!children.Contains(element.Id, StringComparer.OrdinalIgnoreCase))
                children.Add(element.Id);
        }

        return childMap;
    }

    private static List<string> ExpandToLeafWorkPackageIds(
        string id,
        ISet<string> nonLeafIds,
        IReadOnlyDictionary<string, List<string>> childMap)
    {
        if (!nonLeafIds.Contains(id))
            return [id];

        var result = new List<string>();
        var stack = new Stack<string>();
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        stack.Push(id);

        while (stack.Count > 0)
        {
            var current = stack.Pop();
            if (!visited.Add(current)) continue;

            if (!nonLeafIds.Contains(current))
            {
                result.Add(current);
                continue;
            }

            if (!childMap.TryGetValue(current, out var children)) continue;

            for (var i = children.Count - 1; i >= 0; i--)
                stack.Push(children[i]);
        }

        return result;
    }

    private static Dictionary<int, IReadOnlyList<string>> NormalizePhaseAssignments(
        PlanningResponseDto dto,
        ISet<string> nonLeafIds)
    {
        var childMap = BuildChildMap(dto);
        var validIds = dto.Elements
            .Select(e => e.Id)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var result = new Dictionary<int, IReadOnlyList<string>>();

        foreach (var phase in dto.ExecutionPhases)
        {
            var normalized = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var id in phase.WorkPackageIds ?? [])
            {
                if (string.IsNullOrWhiteSpace(id) || !validIds.Contains(id)) continue;

                foreach (var leafId in ExpandToLeafWorkPackageIds(id, nonLeafIds, childMap))
                {
                    if (seen.Add(leafId))
                        normalized.Add(leafId);
                }
            }

            result[phase.PhaseNumber] = normalized;
        }

        return result;
    }

    private static List<ExecutionPhase> BuildExecutionPhases(
        IReadOnlyList<PhaseDto> dtoPhases,
        IReadOnlyDictionary<int, IReadOnlyList<string>> normalizedPhaseWorkPackageIds,
        ISet<string> allWorkPackageIds)
    {
        var phases = new List<ExecutionPhase>();
        var assignedIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var phase in dtoPhases.OrderBy(p => p.PhaseNumber))
        {
            var normalizedIds = normalizedPhaseWorkPackageIds.TryGetValue(phase.PhaseNumber, out var ids)
                ? ids.Where(id => allWorkPackageIds.Contains(id)).Distinct(StringComparer.OrdinalIgnoreCase).ToList()
                : [];

            foreach (var id in normalizedIds)
                assignedIds.Add(id);

            if (normalizedIds.Count == 0)
                continue;

            phases.Add(new ExecutionPhase(
                PhaseNumber: phase.PhaseNumber,
                Name: string.IsNullOrWhiteSpace(phase.Name) ? $"Phase {phase.PhaseNumber}" : phase.Name,
                WorkPackageIds: normalizedIds,
                CanParallelize: phase.CanParallelize
            ));
        }

        var unassignedIds = allWorkPackageIds
            .Except(assignedIds, StringComparer.OrdinalIgnoreCase)
            .OrderBy(id => id, StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (unassignedIds.Count > 0)
        {
            var nextPhaseNumber = phases.Count > 0
                ? phases.Max(p => p.PhaseNumber) + 1
                : 1;

            phases.Add(new ExecutionPhase(
                PhaseNumber: nextPhaseNumber,
                Name: "Auto-assigned work packages",
                WorkPackageIds: unassignedIds,
                CanParallelize: false
            ));
        }

        if (phases.Count == 0 && allWorkPackageIds.Count > 0)
        {
            phases.Add(new ExecutionPhase(
                PhaseNumber: 1,
                Name: "Auto-assigned work packages",
                WorkPackageIds: allWorkPackageIds.OrderBy(id => id, StringComparer.OrdinalIgnoreCase).ToList(),
                CanParallelize: false
            ));
        }

        return phases;
    }

    private static string InferAgentName(ElementDto element)
    {
        var text = string.Join(" ",
            element.Title,
            element.Description,
            element.Deliverable,
            element.AssignedAgent?.Instructions).ToLowerInvariant();

        if (text.Contains("test"))
            return "tester";
        if (text.Contains("review"))
            return "reviewer";
        if (text.Contains("document"))
            return "documenter";
        if (text.Contains("research"))
            return "researcher";
        return "coder";
    }

    private static List<string> ValidatePlanningResponse(PlanningResponseDto dto)
    {
        var issues = new List<string>();

        if (string.IsNullOrWhiteSpace(dto.Specification))
            issues.Add("Specification is blank.");

        if (dto.Elements.Count == 0)
            issues.Add("No WBS elements were returned.");

        var nonLeafIds = ComputeNonLeafIds(dto.Elements);

        var workPackageIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var element in dto.Elements)
        {
            if (string.IsNullOrWhiteSpace(element.Id))
            {
                issues.Add("A WBS element is missing its id.");
                continue;
            }

            if (string.IsNullOrWhiteSpace(element.Title))
                issues.Add($"Element '{element.Id}' has a blank title.");

            if (string.IsNullOrWhiteSpace(element.Description))
                issues.Add($"Element '{element.Id}' has a blank description.");

            if (!WorkPackageIdPattern.IsMatch(element.Id))
                issues.Add($"Element '{element.Id}' does not use a valid hierarchical id format (expected values like 1, 1.1, or 1.2.3).");

            var isWorkPackage = !nonLeafIds.Contains(element.Id);
            if (!isWorkPackage) continue;

            workPackageIds.Add(element.Id);

            if (!element.EstimatedHours.HasValue || element.EstimatedHours.Value <= 0)
                issues.Add($"Work package '{element.Id}' is missing a valid estimatedHours value.");

            if (element.AssignedAgent is null)
            {
                issues.Add($"Work package '{element.Id}' is missing assignedAgent.");
            }
            else
            {
                if (string.IsNullOrWhiteSpace(element.AssignedAgent.Instructions))
                    issues.Add($"Work package '{element.Id}' has blank assignedAgent.instructions.");
            }

            if (string.IsNullOrWhiteSpace(element.Deliverable))
                issues.Add($"Work package '{element.Id}' has a blank deliverable.");

            var successCriteriaCount = (element.SuccessCriteria ?? [])
                .Count(c => !string.IsNullOrWhiteSpace(c));

            if (successCriteriaCount < 1)
                issues.Add($"Work package '{element.Id}' has no success criteria.");
        }

        var childMap = BuildChildMap(dto);
        var validIds = dto.Elements
            .Select(e => e.Id)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var phase in dto.ExecutionPhases)
        {
            if (phase.WorkPackageIds is null || phase.WorkPackageIds.Count == 0)
                continue;

            foreach (var workPackageId in phase.WorkPackageIds)
            {
                if (string.IsNullOrWhiteSpace(workPackageId))
                    continue;

                if (!validIds.Contains(workPackageId))
                    continue;

                _ = ExpandToLeafWorkPackageIds(workPackageId, nonLeafIds, childMap);
            }
        }

        return issues;
    }
}

// ---------------------------------------------------------------------------
// Private DTOs for JSON deserialization
// ---------------------------------------------------------------------------

internal sealed class PlanningResponseDto
{
    [JsonConverter(typeof(StringOrArrayConverter))]
    public string Specification { get; set; } = "";
    public List<ElementDto> Elements { get; set; } = [];
    public List<PhaseDto> ExecutionPhases { get; set; } = [];
}

internal sealed class ElementDto
{
    public string Id { get; set; } = "";
    public int Level { get; set; }
    [JsonConverter(typeof(StringOrArrayConverter))]
    public string Title { get; set; } = "";
    [JsonConverter(typeof(StringOrArrayConverter))]
    public string Description { get; set; } = "";
    public string? ParentId { get; set; }
    public List<string>? ChildrenIds { get; set; }
    public bool IsWorkPackage { get; set; }
    public double? EstimatedHours { get; set; }
    public AgentDto? AssignedAgent { get; set; }
    public List<string>? Prerequisites { get; set; }
    [JsonConverter(typeof(StringOrArrayConverter))]
    public string? Deliverable { get; set; }
    public List<string>? SuccessCriteria { get; set; }
}

internal sealed class AgentDto
{
    public string Name { get; set; } = "";

    // The LLM sometimes returns instructions as a string, sometimes as an array of steps.
    // We accept an array here and join into a single string downstream.
    [JsonConverter(typeof(StringOrArrayConverter))]
    public string Instructions { get; set; } = "";
}

internal sealed class PhaseDto
{
    public int PhaseNumber { get; set; }
    [JsonConverter(typeof(StringOrArrayConverter))]
    public string Name { get; set; } = "";
    public List<string>? WorkPackageIds { get; set; }
    public bool CanParallelize { get; set; }
}

/// <summary>
/// Deserializes a JSON value that may be either a plain string or an array of strings.
/// Arrays are joined with newlines to produce a single string.
/// </summary>
internal sealed class StringOrArrayConverter : JsonConverter<string>
{
    public override string Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
            return reader.GetString() ?? "";

        if (reader.TokenType == JsonTokenType.StartArray)
        {
            var items = new List<string>();
            while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
            {
                if (reader.TokenType == JsonTokenType.String)
                    items.Add(reader.GetString() ?? "");
            }
            return string.Join("\n", items);
        }

        throw new JsonException($"Cannot convert token type '{reader.TokenType}' to string.");
    }

    public override void Write(Utf8JsonWriter writer, string value, JsonSerializerOptions options)
        => writer.WriteStringValue(value);
}
