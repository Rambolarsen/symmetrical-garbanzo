namespace Maestroid.Core.Providers;

public record ModelCapabilities(
    int ContextWindow,
    int MaxOutputTokens,
    bool SupportsToolUse,
    bool SupportsVision,
    decimal CostPerInputToken,
    decimal CostPerOutputToken,
    bool IsLocal,
    int? MinComplexityScore = null,
    int? MaxComplexityScore = null
);

public record ModelEntry(
    string InstanceId,   // matches ProviderConfig.Id — used as DI key
    string Provider,     // "anthropic" | "openai" | "google" | "ollama"
    string Model,
    ModelCapabilities Capabilities
);
