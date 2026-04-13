using Microsoft.EntityFrameworkCore;

namespace Maestroid.Core.Data;

public class MasteroidDbContext(DbContextOptions<MasteroidDbContext> options) : DbContext(options)
{
    public DbSet<ProviderConfigEntity> ProviderConfigs => Set<ProviderConfigEntity>();
    public DbSet<ProviderCallRecordEntity> ProviderCallRecords => Set<ProviderCallRecordEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Seed a default local Ollama provider config on first run
        modelBuilder.Entity<ProviderConfigEntity>().HasData(new ProviderConfigEntity
        {
            Id       = new Guid("00000000-0000-0000-0000-000000000001"),
            Name     = "Local Ollama",
            Provider = "ollama",
            BaseUrl  = "http://localhost:11434",
            IsLocal  = true,
            Enabled  = true,
            Priority = 10,
        });
    }
}
