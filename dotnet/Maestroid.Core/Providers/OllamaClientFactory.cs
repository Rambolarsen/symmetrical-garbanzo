using Microsoft.Extensions.AI;
using Maestroid.Core.Data;

namespace Maestroid.Core.Providers;

/// <summary>
/// Builds IChatClient instances for Ollama on demand.
///
/// Ollama clients cannot be registered statically in DI because the wire
/// protocol (OpenAI vs Anthropic) varies per ConsumerType. This factory
/// resolves the correct adapter at call time.
/// </summary>
public class OllamaClientFactory : IOllamaClientFactory
{
    private readonly IEnumerable<ProviderConfigEntity> _configs;

    public OllamaClientFactory(IEnumerable<ProviderConfigEntity> configs)
    {
        _configs = configs;
    }

    public IChatClient Create(string instanceId, ConsumerType consumer)
    {
        var config = _configs.FirstOrDefault(c => c.Id.ToString() == instanceId
                                                   || c.Name.Equals(instanceId, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException($"No Ollama config for instanceId: {instanceId}");

        var adapter = consumer == ConsumerType.ClaudeCode ? "anthropic" : "openai";

        return adapter switch
        {
            "anthropic" => BuildAnthropicCompatibleClient(config),
            _           => BuildOpenAiCompatibleClient(config),
        };
    }

    private static IChatClient BuildAnthropicCompatibleClient(ProviderConfigEntity config)
    {
        // Wire to Anthropic IChatClient with baseUrl pointing at Ollama.
        // apiKey = "ollama" (Ollama ignores it; SDK requires a value).
        // TODO: implement when Anthropic.SDK supports baseUrl override via IChatClient
        throw new NotImplementedException(
            $"Anthropic-compatible Ollama client not yet wired for instance '{config.Name}'. " +
            "Use the TS sidecar for Claude Code consumers in the meantime.");
    }

    private static IChatClient BuildOpenAiCompatibleClient(ProviderConfigEntity config)
    {
        // Wire to OpenAI IChatClient pointed at Ollama's /v1 endpoint.
        // TODO: implement using OpenAI SDK or OllamaSharp
        throw new NotImplementedException(
            $"OpenAI-compatible Ollama client not yet wired for instance '{config.Name}'.");
    }
}
