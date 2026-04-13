using Maestroid.Core.Data;

namespace Maestroid.Core.Providers;

public class ProviderTelemetryService(MasteroidDbContext db) : IProviderTelemetryService
{
    public async Task<Guid> RecordAsync(ProviderCallRecord record, CancellationToken ct = default)
    {
        var entity = new ProviderCallRecordEntity
        {
            Id            = record.Id == Guid.Empty ? Guid.NewGuid() : record.Id,
            Timestamp     = record.Timestamp,
            WorkPackageId = record.WorkPackageId,
            PhaseId       = record.PhaseId,
            InstanceId    = record.InstanceId,
            Provider      = record.Provider,
            Model         = record.Model,
            Tier          = record.Tier,
            Consumer      = record.Consumer,
            InputTokens   = record.InputTokens,
            OutputTokens  = record.OutputTokens,
            CostUsd       = record.CostUsd,
            DurationMs    = record.DurationMs,
            WasEscalated  = record.WasEscalated,
        };

        db.ProviderCallRecords.Add(entity);
        await db.SaveChangesAsync(ct);
        return entity.Id;
    }
}
