using Maestroid.Core.Data;
using Microsoft.EntityFrameworkCore;

namespace Maestroid.Core.Providers;

public class ProviderService(MasteroidDbContext db) : IProviderService
{
    public async Task<List<ProviderConfig>> GetEnabledAsync(CancellationToken ct = default)
    {
        var entities = await db.ProviderConfigs
            .Where(c => c.Enabled)
            .ToListAsync(ct);

        return entities.Select(ToConfig).ToList();
    }

    public async Task<List<ProviderConfig>> GetEnabledAsync(string type, CancellationToken ct = default)
    {
        var entities = await db.ProviderConfigs
            .Where(c => c.Provider == type && c.Enabled)
            .ToListAsync(ct);

        return entities.Select(ToConfig).ToList();
    }

    public async Task<Guid> AddAsync(ProviderConfig config, CancellationToken ct = default)
    {
        var entity = new ProviderConfigEntity
        {
            Id              = config.Id == Guid.Empty ? Guid.NewGuid() : config.Id,
            Name            = config.Name,
            Provider        = config.Provider,
            BaseUrl         = config.BaseUrl,
            IsLocal         = config.IsLocal,
            Enabled         = config.Enabled,
            Priority        = config.Priority,
            EncryptedApiKey = config.ApiKey,
        };

        db.ProviderConfigs.Add(entity);
        await db.SaveChangesAsync(ct);
        return entity.Id;
    }

    private static ProviderConfig ToConfig(ProviderConfigEntity e) =>
        new(e.Id, e.Name, e.Provider, e.BaseUrl, e.IsLocal, e.Enabled, e.Priority);
}
