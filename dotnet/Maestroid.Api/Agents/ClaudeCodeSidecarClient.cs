using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Maestroid.Core.Orchestrator;

namespace Maestroid.Api.Agents;

/// <summary>
/// HTTP client for the Claude Code sidecar (TypeScript/Node.js).
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

    /// <summary>
    /// Streams SSE execution events from the sidecar. Yields raw SSE data lines.
    /// Caller is responsible for forwarding these to the HTTP response.
    /// </summary>
    public async IAsyncEnumerable<string> StreamAsync(
        StreamAgentRequest request,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, "/agents/stream")
        {
            Content = JsonContent.Create(request),
        };

        using var response = await httpClient.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);

        string? line;
        while ((line = await reader.ReadLineAsync(ct)) is not null && !ct.IsCancellationRequested)
        {
            yield return line;
        }
    }

    /// <summary>
    /// Calls the sidecar's Serena-powered context extractor for task-relevant code.
    /// Returns null (never throws) if the sidecar is unavailable or Serena fails.
    /// Planning degrades gracefully to static context only.
    /// </summary>
    public async Task<string?> GetSerenaContextAsync(string projectPath, string task, CancellationToken ct = default)
    {
        // Skip GitHub URLs — Serena only works with local paths
        if (projectPath.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            return null;

        try
        {
            var response = await httpClient.PostAsJsonAsync(
                "/serena/context",
                new { projectPath, task },
                ct);

            if (!response.IsSuccessStatusCode) return null;

            var result = await response.Content.ReadFromJsonAsync<SerenaContextResponse>(ct);
            return result?.Context;
        }
        catch { return null; }
    }

    private record SerenaContextResponse(string? Context);

    /// <summary>
    /// Forwards a human clarification answer to the sidecar to resume a paused agent.
    /// </summary>
    public async Task ClarifyAsync(string requestId, string answer, CancellationToken ct = default)
    {
        var response = await httpClient.PostAsJsonAsync(
            $"/agents/clarify/{requestId}",
            new { answer },
            ct);
        response.EnsureSuccessStatusCode();
    }
}

public record RunAgentRequest(
    string Task,
    AgentRole Role,
    string? WorkingDirectory = null,
    string[]? AllowedTools = null,
    string PermissionMode = "default"
);

public record StreamAgentRequest(
    string Task,
    AgentRole Role,
    string? WorkingDirectory = null,
    string[]? AllowedTools = null,
    string PermissionMode = "default",
    bool EnableClarification = true
);

public record RunAgentResponse(
    string Output,
    double Cost,
    long DurationMs
);
