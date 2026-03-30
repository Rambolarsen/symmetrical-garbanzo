using System.Net.Http.Json;
using Maestroid.Core.Orchestrator;

namespace Maestroid.Api.Agents;

/// <summary>
/// HTTP client for the Claude Code TypeScript sidecar.
/// Aspire service discovery resolves "claude-code-sidecar" to the actual URL.
/// </summary>
public class ClaudeCodeSidecarClient(HttpClient httpClient)
{
    public async Task<RunAgentResponse> RunAsync(RunAgentRequest request, CancellationToken ct = default)
    {
        var response = await httpClient.PostAsJsonAsync("/agents/run", request, ct);
        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<RunAgentResponse>(ct)
            ?? throw new InvalidOperationException("Empty response from sidecar");
    }
}

public record RunAgentRequest(
    string Task,
    AgentRole Role,
    string? WorkingDirectory = null,
    string[]? AllowedTools = null,
    string PermissionMode = "default"
);

public record RunAgentResponse(
    string Output,
    double Cost,
    long DurationMs
);
