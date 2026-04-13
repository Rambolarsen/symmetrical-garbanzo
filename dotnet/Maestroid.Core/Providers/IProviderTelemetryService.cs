namespace Maestroid.Core.Providers;

/// <summary>
/// Records provider call telemetry. Called by the sidecar after each tracked
/// LLM generation to capture cost, latency, and routing decisions.
/// </summary>
public interface IProviderTelemetryService
{
    /// <summary>
    /// Persists a provider call record. Returns the ID of the created entry.
    /// </summary>
    Task<Guid> RecordAsync(ProviderCallRecord record, CancellationToken ct = default);
}
