using Microsoft.Extensions.AI;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Maestroid.Core.Providers;

/// <summary>
/// Routes task execution to the most appropriate IChatClient based on
/// complexity score, capabilities, consumer type, and provider availability.
///
/// Two-level routing:
///   Level 1 — provider priority (anthropic → openai → google → ollama)
///   Level 2 — within ollama, instance priority (remote → local)
/// </summary>
public class ProviderRegistry : IProviderRegistry
{
    private readonly IServiceProvider _serviceProvider;
    private readonly IOllamaClientFactory _ollamaFactory;
    private readonly IConfiguration _config;

    // Tier catalog: ordered list of ModelEntry candidates per tier.
    // Cloud provider entries use instanceId = provider name ("anthropic", "openai", "google").
    // Ollama entries use instance-specific IDs. Rebuilt after ProviderConfigs are loaded from DB.
    private IReadOnlyDictionary<ModelTier, IReadOnlyList<ModelEntry>> _catalog;

    public ProviderRegistry(
        IServiceProvider serviceProvider,
        IOllamaClientFactory ollamaFactory,
        IConfiguration config)
    {
        _serviceProvider = serviceProvider;
        _ollamaFactory   = ollamaFactory;
        _config          = config;
        _catalog         = BuildDefaultCatalog();
    }

    /// <summary>
    /// Replace the in-memory catalog after Ollama instances and user configs are loaded from DB.
    /// Call this once at startup after migrations complete.
    /// </summary>
    public void SetCatalog(IReadOnlyDictionary<ModelTier, IReadOnlyList<ModelEntry>> catalog)
    {
        _catalog = catalog;
    }

    public IChatClient ResolveForTask(RoutingContext ctx)
    {
        var tier       = AssignTier(ctx.ComplexityScore);
        var candidates = _catalog[tier];
        var excluded   = ctx.ExcludeInstances?.ToHashSet() ?? [];

        foreach (var entry in candidates)
        {
            if (excluded.Contains(entry.InstanceId)) continue;
            if (!IsInstanceAvailable(entry.InstanceId)) continue;

            var caps = entry.Capabilities;
            if (ctx.RequiresToolUse && !caps.SupportsToolUse) continue;
            if (ctx.RequiresVision && !caps.SupportsVision) continue;
            if (ctx.EstimatedInputTokens.HasValue && ctx.EstimatedInputTokens > caps.ContextWindow) continue;
            if (caps.MinComplexityScore.HasValue && ctx.ComplexityScore < caps.MinComplexityScore) continue;
            if (caps.MaxComplexityScore.HasValue && ctx.ComplexityScore > caps.MaxComplexityScore) continue;
            if (ctx.PreferLocal && !caps.IsLocal) continue;

            return BuildClient(entry, ctx.Consumer);
        }

        // preferLocal failed — retry without the local constraint
        if (ctx.PreferLocal)
            return ResolveForTask(ctx with { PreferLocal = false });

        throw new InvalidOperationException(
            $"No suitable provider for complexity={ctx.ComplexityScore}, tier={tier}");
    }

    public bool IsInstanceAvailable(string instanceId) => instanceId switch
    {
        "anthropic"                         => !string.IsNullOrEmpty(_config["ANTHROPIC_API_KEY"]),
        "openai"                            => !string.IsNullOrEmpty(_config["OPENAI_API_KEY"]),
        "google"                            => !string.IsNullOrEmpty(_config["GOOGLE_API_KEY"]),
        var id when id.StartsWith("ollama") => true,  // reachability confirmed at call time
        _                                   => false,
    };

    public IReadOnlyList<string> AvailableInstances()
    {
        var all = new[] { "anthropic", "openai", "google" };
        return [.. all.Where(IsInstanceAvailable)];
    }

    // ---------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------

    private static ModelTier AssignTier(int score) => score switch
    {
        < 30 => ModelTier.Fast,
        < 65 => ModelTier.Balanced,
        _    => ModelTier.Powerful,
    };

    private IChatClient BuildClient(ModelEntry entry, ConsumerType consumer)
    {
        // Ollama: dynamic adapter via factory
        if (entry.Provider == "ollama")
            return _ollamaFactory.Create(entry.InstanceId, consumer);

        // Cloud providers: DI keys are model IDs (e.g. "claude-haiku-4-5-20251001"),
        // matching the registration pattern in AgentProviders.AddAgentProviders().
        if (_serviceProvider is IKeyedServiceProvider keyed)
            return keyed.GetRequiredKeyedService<IChatClient>(entry.Model);

        throw new InvalidOperationException(
            $"IServiceProvider does not support keyed services. Cannot resolve model '{entry.Model}'.");
    }

    // ---------------------------------------------------------------------------
    // Default catalog — cloud providers only, built before DB configs are loaded
    // ---------------------------------------------------------------------------

    private static IReadOnlyDictionary<ModelTier, IReadOnlyList<ModelEntry>> BuildDefaultCatalog()
    {
        var haiku = new ModelCapabilities(
            ContextWindow: 200_000, MaxOutputTokens: 8_192,
            SupportsToolUse: true, SupportsVision: true,
            CostPerInputToken: 0.0000008m, CostPerOutputToken: 0.000004m,
            IsLocal: false, MaxComplexityScore: 50);

        var sonnet = new ModelCapabilities(
            ContextWindow: 200_000, MaxOutputTokens: 64_000,
            SupportsToolUse: true, SupportsVision: true,
            CostPerInputToken: 0.000003m, CostPerOutputToken: 0.000015m,
            IsLocal: false);

        var opus = new ModelCapabilities(
            ContextWindow: 200_000, MaxOutputTokens: 32_000,
            SupportsToolUse: true, SupportsVision: true,
            CostPerInputToken: 0.000015m, CostPerOutputToken: 0.000075m,
            IsLocal: false, MinComplexityScore: 60);

        var gptMini = new ModelCapabilities(
            ContextWindow: 128_000, MaxOutputTokens: 16_384,
            SupportsToolUse: true, SupportsVision: true,
            CostPerInputToken: 0.0000004m, CostPerOutputToken: 0.0000016m,
            IsLocal: false, MaxComplexityScore: 50);

        var gpt41 = new ModelCapabilities(
            ContextWindow: 128_000, MaxOutputTokens: 32_768,
            SupportsToolUse: true, SupportsVision: true,
            CostPerInputToken: 0.000002m, CostPerOutputToken: 0.000008m,
            IsLocal: false);

        var geminiFlash = new ModelCapabilities(
            ContextWindow: 1_000_000, MaxOutputTokens: 8_192,
            SupportsToolUse: true, SupportsVision: true,
            CostPerInputToken: 0.0000001m, CostPerOutputToken: 0.0000004m,
            IsLocal: false, MaxComplexityScore: 50);

        var geminiPro = new ModelCapabilities(
            ContextWindow: 1_000_000, MaxOutputTokens: 65_536,
            SupportsToolUse: true, SupportsVision: true,
            CostPerInputToken: 0.00000125m, CostPerOutputToken: 0.00001m,
            IsLocal: false);

        return new Dictionary<ModelTier, IReadOnlyList<ModelEntry>>
        {
            [ModelTier.Fast] =
            [
                new("anthropic", "anthropic", "claude-haiku-4-5-20251001", haiku),
                new("openai",    "openai",    "gpt-4.1-mini",              gptMini),
                new("google",    "google",    "gemini-2.0-flash",          geminiFlash),
            ],
            [ModelTier.Balanced] =
            [
                new("anthropic", "anthropic", "claude-sonnet-4-6", sonnet),
                new("openai",    "openai",    "gpt-4.1",           gpt41),
                new("google",    "google",    "gemini-2.5-pro",    geminiPro),
            ],
            [ModelTier.Powerful] =
            [
                new("anthropic", "anthropic", "claude-opus-4-6",  opus),
                new("openai",    "openai",    "gpt-4.1",          gpt41),
                new("google",    "google",    "gemini-2.5-pro",   geminiPro),
            ],
        };
    }
}
