using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;

namespace Maestroid.Core.Orchestrator;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

public record CriterionCheck(
    string Criterion,
    bool Passed,
    string Evidence,
    double Confidence
);

public record VerificationResult(
    bool OverallPassed,
    IReadOnlyList<CriterionCheck> CriteriaChecks,
    string Summary,
    IReadOnlyList<string>? Recommendations = null
);

// ---------------------------------------------------------------------------
// Prompt schema helpers (used for structured JSON extraction)
// ---------------------------------------------------------------------------

file record VerificationOutput(
    [property: JsonPropertyName("overallPassed")] bool OverallPassed,
    [property: JsonPropertyName("criteriaChecks")] IReadOnlyList<CriterionCheckOutput> CriteriaChecks,
    [property: JsonPropertyName("summary")] string Summary,
    [property: JsonPropertyName("recommendations")] IReadOnlyList<string>? Recommendations = null
);

file record CriterionCheckOutput(
    [property: JsonPropertyName("criterion")] string Criterion,
    [property: JsonPropertyName("passed")] bool Passed,
    [property: JsonPropertyName("evidence")] string Evidence,
    [property: JsonPropertyName("confidence")] double Confidence
);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

public class VerificationService([FromKeyedServices("fast")] IChatClient chatClient)
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private const string SystemPrompt = """
        You are a verification agent. Your job is to assess whether the output of an AI development agent satisfies the stated success criteria.

        Be objective and evidence-based. Do not pass criteria that lack clear evidence in the output. Do not fail criteria for cosmetic reasons.

        For each criterion:
        - Look for explicit evidence in the execution output (file mentions, test results, confirmations, code changes described)
        - If the output is ambiguous or silent on a criterion, mark it failed with low confidence (0.3 or below)
        - Set confidence based on how clearly the output addresses the criterion (0 = uncertain, 1 = certain)

        Overall pass/fail rule:
        - overallPassed = true ONLY if ALL criteria passed
        - If even one criterion failed, set overallPassed = false

        Return ONLY valid JSON matching this schema:
        {
          "overallPassed": boolean,
          "criteriaChecks": [{ "criterion": string, "passed": boolean, "evidence": string, "confidence": number }],
          "summary": "1-3 sentence verdict",
          "recommendations": ["actionable fix 1", ...] // omit if all passed
        }
        """;

    public async Task<VerificationResult> RunAsync(
        string taskTitle,
        IReadOnlyList<string> successCriteria,
        string executionOutput,
        CancellationToken ct = default)
    {
        if (successCriteria.Count == 0)
        {
            return new VerificationResult(
                OverallPassed: true,
                CriteriaChecks: [],
                Summary: "No success criteria were defined — verification skipped."
            );
        }

        var criteriaList = string.Join("\n", successCriteria.Select((c, i) => $"{i + 1}. {c}"));
        var truncatedOutput = executionOutput.Length > 8000
            ? executionOutput[..8000] + "\n... [truncated]"
            : executionOutput;

        var userMessage = $"""
            Task: {taskTitle}

            Success Criteria:
            {criteriaList}

            Execution Output:
            ---
            {(string.IsNullOrWhiteSpace(truncatedOutput) ? "(no output captured)" : truncatedOutput)}
            ---

            Assess whether each criterion was satisfied. Return JSON only.
            """;

        var response = await chatClient.GetResponseAsync(
            [
                new ChatMessage(ChatRole.System, SystemPrompt),
                new ChatMessage(ChatRole.User, userMessage),
            ],
            cancellationToken: ct
        );

        var json = ExtractJson(response.Text);
        VerificationOutput? output;

        try
        {
            output = JsonSerializer.Deserialize<VerificationOutput>(json, JsonOptions);
        }
        catch
        {
            output = null;
        }

        if (output is null)
        {
            // Fallback: mark all criteria as unverified
            return new VerificationResult(
                OverallPassed: false,
                CriteriaChecks: successCriteria
                    .Select(c => new CriterionCheck(c, false, "Verification parsing failed.", 0))
                    .ToList(),
                Summary: "Verification could not be parsed. Manual review required.",
                Recommendations: ["Re-run verification or review execution output manually."]
            );
        }

        // Align criteria checks with input order
        var checks = successCriteria.Select((criterion, i) =>
        {
            var check = output.CriteriaChecks.ElementAtOrDefault(i);
            return new CriterionCheck(
                Criterion: criterion,
                Passed: check?.Passed ?? false,
                Evidence: check?.Evidence ?? "Not assessed.",
                Confidence: check?.Confidence ?? 0
            );
        }).ToList();

        return new VerificationResult(
            OverallPassed: output.OverallPassed,
            CriteriaChecks: checks,
            Summary: output.Summary,
            Recommendations: output.Recommendations
        );
    }

    private static string ExtractJson(string text)
    {
        // Strip markdown code fences if present
        var match = Regex.Match(text, @"```(?:json)?\s*([\s\S]*?)```");
        if (match.Success) return match.Groups[1].Value.Trim();

        // Find the first '{' and last '}'
        var start = text.IndexOf('{');
        var end = text.LastIndexOf('}');
        if (start >= 0 && end > start) return text[start..(end + 1)];

        return text.Trim();
    }
}
