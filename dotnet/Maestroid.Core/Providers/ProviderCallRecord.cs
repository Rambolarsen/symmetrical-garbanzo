namespace Maestroid.Core.Providers;

public record ProviderCallRecord(
    Guid     Id,
    DateTime Timestamp,
    string?  WorkPackageId,
    string?  PhaseId,
    string   InstanceId,
    string   Provider,
    string   Model,
    string   Tier,
    string   Consumer,
    int      InputTokens,
    int      OutputTokens,
    decimal  CostUsd,
    int      DurationMs,
    bool     WasEscalated
);
