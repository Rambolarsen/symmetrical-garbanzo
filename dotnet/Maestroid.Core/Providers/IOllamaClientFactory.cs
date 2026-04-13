using Microsoft.Extensions.AI;

namespace Maestroid.Core.Providers;

public interface IOllamaClientFactory
{
    /// <summary>
    /// Builds an IChatClient for the given Ollama instance,
    /// using the correct wire protocol for the consumer.
    ///
    /// - ConsumerType.ClaudeCode → Anthropic wire protocol
    /// - All others              → OpenAI wire protocol
    /// </summary>
    IChatClient Create(string instanceId, ConsumerType consumer);
}
