namespace Maestroid.Core.Providers;

/// <summary>
/// Manages AI provider configurations. 
/// </summary>
public interface IProviderService
{
    /// <summary>Returns all enabled provider configs across every provider type.</summary>
    Task<List<ProviderConfig>> GetEnabledAsync(CancellationToken ct = default);

    /// <summary>Returns all enabled provider configs filtered to <paramref name="type"/> (e.g. "ollama", "anthropic").</summary>
    Task<List<ProviderConfig>> GetEnabledAsync(string type, CancellationToken ct = default);

    /// <summary>
    /// Persists a new provider config. Pass <see cref="Guid.Empty"/> for <see cref="ProviderConfig.Id"/>
    /// to have the service generate one. Returns the assigned ID.
    /// </summary>
    Task<Guid> AddAsync(ProviderConfig config, CancellationToken ct = default);
}
