using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Maestroid.Core.Providers;

namespace Maestroid.Core.Orchestrator;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

public record AgentRole(string Name, string Instructions);

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum ComplexityLevel { Trivial, Simple, Moderate, Complex, Enterprise }

public record Risk(string Description, string Severity, string Mitigation);

public record ScoreFactor(string Description, int Score, string Rationale);

public record PrePlanningResult(
    string ScopeId,
    bool IsTaskCoherent,
    string CoherenceNotes,
    int ComplexityScore,
    ComplexityLevel ComplexityLevel,
    bool RequiresPlanning,
    bool RecommendsPlanning,
    double EstimatedHours,
    double EstimatedCostUsd,
    string ScoreRationale,
    string Specification,
    IReadOnlyList<ScoreFactor> ScoreBreakdown,
    IReadOnlyList<Risk> Risks,
    IReadOnlyList<string> Constraints,
    IReadOnlyList<string> Assumptions,
    IReadOnlyList<string> SuccessCriteria,
    IReadOnlyList<AgentRole> RecommendedAgents
);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/// <summary>
/// Phase 0: Pre-Planning.
/// Analyzes a task and scores its complexity to decide if full planning is needed.
/// </summary>
public class PrePlanningService(IProviderRegistry registry, IConfiguration? config = null)
{
    // Pre-planning routing context — bootstrapping convention.
    // Score 0 always resolves to fast tier; this is deliberate, not a hardcode.
    private static readonly RoutingContext PrePlanningCtx = new(
        ComplexityScore: 0,
        RequiresToolUse: false
    );

    // Repair uses balanced floor — a model that can't fix its own output isn't useful.
    private static readonly RoutingContext RepairCtx = new(
        ComplexityScore: 0,
        MinTier: ModelTier.Balanced
    );

    private IChatClient ChatClient => registry.ResolveForTask(PrePlanningCtx);
    private IChatClient RepairClient => registry.ResolveForTask(RepairCtx);

    private int TimeoutSeconds =>
        config?.GetValue<int?>("PrePlanning:TimeoutSeconds") ?? 600;

    private const string SystemPrompt = """
        You are a scope analysis agent. Analyze the given task and return a JSON object.

        You are analyzing the TASK provided in the user message. That is your sole subject.
        The PROJECT CONTEXT block (if present) is read-only background — it tells you what codebase the task applies to.
        Use it to make your output specific (name real files, services, tech) but never let it change what the task is.
        If the task says "add tests", analyze adding tests — not anything else you see in the context.
        Do not invent a different task. Do not describe the project. Analyze exactly the task given.

        First determine whether the task is coherent and actionable.
        Mark isTaskCoherent as false when the task is nonsensical, self-contradictory, pure gibberish,
        too vague to scope, or does not describe a real software outcome.

        Complexity scoring guide:
          0-20:  Trivial   — single file, no dependencies, routine change
          21-40: Simple    — small feature, known pattern, minimal deps
          41-60: Moderate  — multiple components, some integration work
          61-80: Complex   — cross-cutting concerns, significant risk
          81-100: Enterprise — multi-system, compliance, high stakes

        Planning thresholds:
          requiresPlanning: true when complexityScore >= 70
          recommendsPlanning: true when complexityScore >= 45

        If isTaskCoherent is false:
          - set complexityScore to 0
          - set complexityLevel to "trivial"
          - set requiresPlanning and recommendsPlanning to false
          - set estimatedHours and estimatedCostUsd to 0
          - return an empty scoreBreakdown array
          - explain clearly in coherenceNotes and scoreRationale why the task cannot be scored yet

        If isTaskCoherent is true:
          - provide scoreRationale explaining why the total score is justified, citing specific parts of the project
          - provide 2-5 scoreBreakdown items, each grounded in what the project actually contains
          - each scoreBreakdown item must explain one concrete factor
          - the sum of scoreBreakdown scores must equal complexityScore

        Return ONLY valid JSON matching this schema:
        {
          "specification": string,          // 3-5 sentences. What is being built and where in this specific project. Name the actual files, components, services, and APIs that will change or be created. Describe the end state concretely. Do not restate the task title. Do not use generic descriptions.
          "isTaskCoherent": boolean,
          "coherenceNotes": string,
          "complexityScore": number (0-100),
          "complexityLevel": "trivial"|"simple"|"moderate"|"complex"|"enterprise",
          "requiresPlanning": boolean,
          "recommendsPlanning": boolean,
          "estimatedHours": number,
          "estimatedCostUsd": number,
          "scoreRationale": string,
          "scoreBreakdown": [{ "description": string, "score": number, "rationale": string }],
          "risks": [{ "description": string, "severity": "low"|"medium"|"high"|"critical", "mitigation": string }],
          "constraints": string[],
          "assumptions": string[],
          "successCriteria": string[],
          "recommendedAgents": [{ "name": string, "instructions": string }]
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

    public async Task<PrePlanningResult> RunAsync(
        string task,
        string? context = null,
        Func<PlanProgressEvent, CancellationToken, Task>? onProgress = null,
        CancellationToken ct = default)
    {
        var prompt = string.IsNullOrWhiteSpace(context)
            ? $"TASK SPECIFICATION:\n{task}"
            : $"TASK SPECIFICATION:\n{task}\n\n---\nPROJECT CONTEXT (background only — your job is to analyze the TASK SPECIFICATION above):\n{context}";

        // ChatClient is resolved via IProviderRegistry — throws if no provider is available.

        if (onProgress is not null)
            await onProgress(new PlanProgressEvent(
                "progress",
                "Analyzing task complexity and coherence…",
                Phase: "pre-planning",
                Tier: "fast"), ct);

        string responseText;
        using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(TimeoutSeconds));
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);
        try
        {
            responseText = await RequestPrimaryTextAsync(prompt, onProgress, linkedCts.Token);
        }
        catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
        {
            throw new TimeoutException($"Pre-planning timed out after {TimeoutSeconds}s.");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new InvalidOperationException(
                $"Pre-planning model call failed: {ex.Message}",
                ex);
        }

        using var doc = await ParseJsonDocumentWithRepairAsync(responseText, onProgress, ct);
        var root = doc.RootElement;

        var isTaskCoherent = GetBoolean(root, "isTaskCoherent", defaultValue: true);
        var coherenceNotes = GetString(root, "coherenceNotes");
        var scoreRationale = GetString(root, "scoreRationale");
        var specification = GetString(root, "specification");
        var scoreBreakdown = GetArray(root, "scoreBreakdown")
            .Select(x => new ScoreFactor(
                GetString(x, "description"),
                GetInt32(x, "score"),
                GetString(x, "rationale")))
            .ToList();

        var complexityScore = GetInt32(root, "complexityScore");
        var complexityLevel = GetEnum(root, "complexityLevel", ComplexityLevel.Trivial);
        var requiresPlanning = GetBoolean(root, "requiresPlanning");
        var recommendsPlanning = GetBoolean(root, "recommendsPlanning");
        var estimatedHours = GetDouble(root, "estimatedHours");
        var estimatedCostUsd = GetDouble(root, "estimatedCostUsd");

        if (!isTaskCoherent)
        {
            complexityScore = 0;
            complexityLevel = ComplexityLevel.Trivial;
            requiresPlanning = false;
            recommendsPlanning = false;
            estimatedHours = 0;
            estimatedCostUsd = 0;
            scoreBreakdown = [];
        }
        else if (scoreBreakdown.Count > 0)
        {
            complexityScore = Math.Clamp(scoreBreakdown.Sum(x => x.Score), 0, 100);
            requiresPlanning = complexityScore >= 70;
            recommendsPlanning = complexityScore >= 45;
        }

        return new PrePlanningResult(
            ScopeId: $"scope_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}_{Guid.NewGuid():N}"[..30],
            IsTaskCoherent: isTaskCoherent,
            CoherenceNotes: coherenceNotes,
            ComplexityScore: complexityScore,
            ComplexityLevel: complexityLevel,
            RequiresPlanning: requiresPlanning,
            RecommendsPlanning: recommendsPlanning,
            EstimatedHours: estimatedHours,
            EstimatedCostUsd: estimatedCostUsd,
            ScoreRationale: scoreRationale,
            Specification: specification,
            ScoreBreakdown: scoreBreakdown,
            Risks: GetArray(root, "risks")
                       .Select(r => new Risk(
                           GetString(r, "description"),
                           GetString(r, "severity"),
                           GetString(r, "mitigation")))
                       .ToList(),
            Constraints: GetStringArray(root, "constraints"),
            Assumptions: GetStringArray(root, "assumptions"),
            SuccessCriteria: GetStringArray(root, "successCriteria"),
            RecommendedAgents: GetArray(root, "recommendedAgents")
                                   .Select(a => new AgentRole(
                                       GetString(a, "name"),
                                       GetString(a, "instructions")))
                                   .ToList()
        );
    }

    public static string FormatReport(PrePlanningResult r)
    {
        var bar = new string('█', r.ComplexityScore / 5).PadRight(20, '░');
        var lines = new List<string>
        {
            "━━━ Pre-Planning Report ━━━━━━━━━━━━━━━━━━━━━━━━━━",
            r.IsTaskCoherent
                ? "Task quality: coherent"
                : $"Task quality: needs clarification — {r.CoherenceNotes}",
            $"Complexity: {bar} {r.ComplexityScore}/100 ({r.ComplexityLevel})",
            $"Estimated:  {r.EstimatedHours}h  ~${r.EstimatedCostUsd:F2}",
            "",
            r.RequiresPlanning
                ? "⚠  PLANNING REQUIRED — complexity too high to skip safely"
                : r.RecommendsPlanning
                    ? "→  Planning recommended — but you can skip if you know the domain"
                    : "✓  Skip planning — straightforward task",
            ""
        };

        if (!string.IsNullOrWhiteSpace(r.ScoreRationale))
        {
            lines.Add($"Why this score: {r.ScoreRationale}");
            lines.Add("");
        }

        if (r.ScoreBreakdown.Count > 0)
        {
            lines.Add("Score breakdown:");
            foreach (var factor in r.ScoreBreakdown)
            {
                lines.Add($"  [{factor.Score}] {factor.Description}");
                lines.Add($"       → {factor.Rationale}");
            }
            lines.Add("");
        }

        if (r.Risks.Count > 0)
        {
            lines.Add("Risks:");
            foreach (var risk in r.Risks)
            {
                lines.Add($"  [{risk.Severity.ToUpper()}] {risk.Description}");
                lines.Add($"         → {risk.Mitigation}");
            }
            lines.Add("");
        }

        if (r.SuccessCriteria.Count > 0)
        {
            lines.Add("Success criteria:");
            lines.AddRange(r.SuccessCriteria.Select(c => $"  • {c}"));
            lines.Add("");
        }

        lines.Add("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        return string.Join('\n', lines);
    }

    /// <summary>
    /// Extracts a JSON object from raw LLM output, handling markdown fences
    /// and prose preambles like "Here is the JSON: {...}".
    /// </summary>
    private static string ExtractJson(string raw)
    {
        var text = raw.Trim();

        // Strip ```json ... ``` or ``` ... ``` fences
        if (text.StartsWith("```"))
        {
            text = text.Split('\n').Skip(1).TakeWhile(l => !l.StartsWith("```"))
                       .Aggregate((a, b) => $"{a}\n{b}");
        }

        // Find the outermost { ... } block in case the model prepended prose
        var start = text.IndexOf('{');
        var end   = text.LastIndexOf('}');
        if (start >= 0 && end > start)
            text = text[start..(end + 1)];

        return SanitizeJson(text.Trim());
    }

    /// <summary>
    /// Fixes common LLM JSON mistakes locally before falling back to LLM repair.
    /// Handles: trailing commas, JS-style comments, single-quoted strings.
    /// </summary>
    private static string SanitizeJson(string json)
    {
        // Remove single-line comments (// ...)
        json = Regex.Replace(json, @"//[^\n\r]*", "");
        // Remove multi-line comments (/* ... */)
        json = Regex.Replace(json, @"/\*.*?\*/", "", RegexOptions.Singleline);
        // Remove trailing commas before } or ]
        json = Regex.Replace(json, @",\s*([\}\]])", "$1");
        return json.Trim();
    }

    private static readonly JsonDocumentOptions LenientJsonOptions = new()
    {
        AllowTrailingCommas = true,
        CommentHandling = JsonCommentHandling.Skip,
    };

    private async Task<JsonDocument> ParseJsonDocumentWithRepairAsync(
        string raw,
        Func<PlanProgressEvent, CancellationToken, Task>? onProgress,
        CancellationToken ct)
    {
        var json = ExtractJson(raw);

        try
        {
            return JsonDocument.Parse(json, LenientJsonOptions);
        }
        catch (JsonException firstEx)
        {
            if (onProgress is not null)
                await onProgress(new PlanProgressEvent(
                    "progress",
                    "Repairing malformed JSON…",
                    Phase: "pre-planning",
                    Tier: "balanced"), ct);

            // Pass the already-extracted JSON, not the raw response with prose/fences
            var repaired = await RepairJsonAsync(json, ct);

            try
            {
                return JsonDocument.Parse(repaired, LenientJsonOptions);
            }
            catch (JsonException secondEx)
            {
                var preview = CreatePreview(repaired);
                throw new InvalidOperationException(
                    $"LLM returned invalid JSON for pre-planning: {secondEx.Message}. Preview: {preview}",
                    new AggregateException(firstEx, secondEx));
            }
        }
    }

    private async Task<string> RequestPrimaryTextAsync(
        string prompt,
        Func<PlanProgressEvent, CancellationToken, Task>? onProgress,
        CancellationToken ct)
    {
        var chatClient = ChatClient;

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
                        Phase: "pre-planning",
                        Tier: "fast"), ct);
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
                    Phase: "pre-planning",
                    Tier: "fast"), ct);
            return response.Text;
        }
    }

    private static bool IsStreamingUnsupported(Exception ex) =>
        ex is NotSupportedException ||
        (ex.Message.Contains("stream", StringComparison.OrdinalIgnoreCase) &&
         ex.Message.Contains("not supported", StringComparison.OrdinalIgnoreCase));

    private async Task<string> RepairJsonAsync(string json, CancellationToken ct)
    {
        var repairClient = RepairClient;
        ChatResponse repairResponse;
        using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(TimeoutSeconds));
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);
        try
        {
            repairResponse = await repairClient.GetResponseAsync(
                [new ChatMessage(ChatRole.System, JsonRepairPrompt),
                 new ChatMessage(ChatRole.User, json)],
                cancellationToken: linkedCts.Token);
        }
        catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
        {
            throw new TimeoutException($"Pre-planning JSON repair timed out after {TimeoutSeconds}s.");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new InvalidOperationException(
                $"Pre-planning JSON repair failed: {ex.Message}",
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

    private static IEnumerable<JsonElement> GetArray(JsonElement element, string propertyName)
    {
        if (!TryGetProperty(element, propertyName, out var value) || value.ValueKind != JsonValueKind.Array)
            return [];

        return value.EnumerateArray().ToArray();
    }

    private static List<string> GetStringArray(JsonElement element, string propertyName) =>
        GetArray(element, propertyName)
            .Where(x => x.ValueKind == JsonValueKind.String)
            .Select(x => x.GetString() ?? "")
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .ToList();

    private static string GetString(JsonElement element, string propertyName, string defaultValue = "")
    {
        if (!TryGetProperty(element, propertyName, out var value))
            return defaultValue;

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? defaultValue,
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.True => bool.TrueString.ToLowerInvariant(),
            JsonValueKind.False => bool.FalseString.ToLowerInvariant(),
            _ => defaultValue,
        };
    }

    private static bool GetBoolean(JsonElement element, string propertyName, bool defaultValue = false)
    {
        if (!TryGetProperty(element, propertyName, out var value))
            return defaultValue;

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when bool.TryParse(value.GetString(), out var parsed) => parsed,
            _ => defaultValue,
        };
    }

    private static int GetInt32(JsonElement element, string propertyName, int defaultValue = 0)
    {
        if (!TryGetProperty(element, propertyName, out var value))
            return defaultValue;

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var intValue))
            return intValue;

        if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out var parsed))
            return parsed;

        return defaultValue;
    }

    private static double GetDouble(JsonElement element, string propertyName, double defaultValue = 0)
    {
        if (!TryGetProperty(element, propertyName, out var value))
            return defaultValue;

        if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var doubleValue))
            return doubleValue;

        if (value.ValueKind == JsonValueKind.String && double.TryParse(value.GetString(), out var parsed))
            return parsed;

        return defaultValue;
    }

    private static TEnum GetEnum<TEnum>(JsonElement element, string propertyName, TEnum defaultValue)
        where TEnum : struct
    {
        var raw = GetString(element, propertyName);
        return Enum.TryParse<TEnum>(raw, ignoreCase: true, out var parsed) ? parsed : defaultValue;
    }

    private static bool TryGetProperty(JsonElement element, string propertyName, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty(propertyName, out value))
            return true;

        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                if (string.Equals(property.Name, propertyName, StringComparison.OrdinalIgnoreCase))
                {
                    value = property.Value;
                    return true;
                }
            }
        }

        value = default;
        return false;
    }
}
