using Microsoft.Extensions.AI;

namespace Maestroid.Core.Providers;

public enum ConsumerType { General, ClaudeCode, OpenCode, Codex }

public record RoutingContext(
    int ComplexityScore,
    bool RequiresToolUse = false,
    bool RequiresVision = false,
    int? EstimatedInputTokens = null,
    bool PreferLocal = false,
    IReadOnlyList<string>? ExcludeInstances = null,
    ConsumerType Consumer = ConsumerType.General,
    ModelTier? MinTier = null   // floor — null means no floor
);

public interface IProviderRegistry
{
    IChatClient ResolveForTask(RoutingContext ctx);
    bool IsInstanceAvailable(string instanceId);
    IReadOnlyList<string> AvailableInstances();
}
