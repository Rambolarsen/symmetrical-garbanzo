using System.Text.Json;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;

namespace Maestroid.Core.Orchestrator;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

public record AgentRole(string Name, string Instructions);

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
public class PrePlanningService(IServiceProvider services)
{
    private IChatClient? chatClient =>
        (services as IKeyedServiceProvider)?.GetKeyedService<IChatClient>("fast");

    private const string SystemPrompt = """
        You are a scope analysis agent. Analyze the given task and return a JSON object.

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
          - provide scoreRationale explaining why the total score is justified
          - provide 2-5 scoreBreakdown items
          - each scoreBreakdown item must explain one concrete factor
          - the sum of scoreBreakdown scores must equal complexityScore

        Return ONLY valid JSON matching this schema:
        {
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

    public async Task<PrePlanningResult> RunAsync(string task, string? context = null, CancellationToken ct = default)
    {
        var prompt = context is null ? task : $"{task}\n\nContext:\n{context}";

        if (chatClient is null)
            throw new InvalidOperationException("No LLM provider available. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or start Ollama (ollama serve).");

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
                $"Pre-planning model call failed: {ex.Message}",
                ex);
        }

        using var doc = await ParseJsonDocumentWithRepairAsync(response.Text, ct);
        var root = doc.RootElement;

        var isTaskCoherent = GetBoolean(root, "isTaskCoherent", defaultValue: true);
        var coherenceNotes = GetString(root, "coherenceNotes");
        var scoreRationale = GetString(root, "scoreRationale");
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

        return text.Trim();
    }

    private async Task<JsonDocument> ParseJsonDocumentWithRepairAsync(string raw, CancellationToken ct)
    {
        var json = ExtractJson(raw);

        try
        {
            return JsonDocument.Parse(json);
        }
        catch (JsonException firstEx)
        {
            var repaired = await RepairJsonAsync(raw, ct);

            try
            {
                return JsonDocument.Parse(repaired);
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
