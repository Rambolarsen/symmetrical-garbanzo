using System.Text.Json.Serialization;

namespace Maestroid.Core.Orchestrator;

public record PlanProgressEvent(
    [property: JsonPropertyName("type")]       string Type,
    [property: JsonPropertyName("message")]    string? Message = null,
    [property: JsonPropertyName("text")]       string? Text = null,
    [property: JsonPropertyName("phase")]      string? Phase = null,
    [property: JsonPropertyName("tier")]       string? Tier = null,
    [property: JsonPropertyName("model")]      string? Model = null,
    [property: JsonPropertyName("elapsedMs")]  int? ElapsedMs = null,
    [property: JsonPropertyName("attempt")]    int? Attempt = null,
    [property: JsonPropertyName("maxAttempts")]int? MaxAttempts = null,
    [property: JsonPropertyName("issues")]     IReadOnlyList<string>? Issues = null
);
