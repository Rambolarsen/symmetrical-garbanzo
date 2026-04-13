namespace Maestroid.Core.Providers;

/// <summary>
/// Domain representation of a configured AI provider instance.
/// Mapped from <see cref="Data.ProviderConfigEntity"/> by <see cref="IProviderService"/>.
/// </summary>
public record ProviderConfig(
    Guid    Id,
    string  Name,
    string  Provider,
    string? BaseUrl,
    bool    IsLocal,
    bool    Enabled,
    int     Priority,
    string? ApiKey = null
);
