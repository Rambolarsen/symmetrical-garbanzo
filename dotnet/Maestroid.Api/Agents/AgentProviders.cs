using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.SemanticKernel;
using Anthropic.SDK;
using OllamaSharp;

namespace Maestroid.Api.Agents;

public static class Models
{
    public const string Fast           = "claude-haiku-4-5-20251001";
    public const string Balanced       = "claude-sonnet-4-6";
    public const string Powerful       = "claude-opus-4-6";
    public const string OpenAiFast     = "gpt-4o-mini";
    public const string OpenAiBalanced = "gpt-4o";
    public const string Local          = "llama3.2";
}

public static class AgentProviderExtensions
{
    public static IServiceCollection AddAgentProviders(
        this IServiceCollection services,
        IConfiguration config)
    {
        var anthropicKey = config["ANTHROPIC_API_KEY"];
        var openAiKey    = config["OPENAI_API_KEY"];
        var ollamaUri    = new Uri(config["OLLAMA_HOST"] ?? "http://localhost:11434");

        // ------------------------------------------------------------------
        // Anthropic — MessagesEndpoint implements IChatClient directly.
        // Only registered when key is present.
        // ------------------------------------------------------------------
        if (!string.IsNullOrEmpty(anthropicKey))
        {
            var anthropicMessages = new AnthropicClient(new APIAuthentication(anthropicKey)).Messages;
            IChatClient anthropicBase = (IChatClient)anthropicMessages;

            foreach (var model in new[] { Models.Fast, Models.Balanced, Models.Powerful })
            {
                var m = model;
                services.AddKeyedSingleton<IChatClient>(m,
                    new ModelBoundChatClient(anthropicBase, m)
                        .AsBuilder()
                        .UseFunctionInvocation()
                        .Build());
            }
        }

        // ------------------------------------------------------------------
        // OpenAI — only registered when key is present
        // ------------------------------------------------------------------
        if (!string.IsNullOrEmpty(openAiKey))
        {
            var openAiClient = new OpenAI.OpenAIClient(openAiKey);

            services.AddKeyedSingleton<IChatClient>(Models.OpenAiFast,
                openAiClient.GetChatClient(Models.OpenAiFast)
                    .AsIChatClient()
                    .AsBuilder()
                    .UseFunctionInvocation()
                    .Build());

            services.AddKeyedSingleton<IChatClient>(Models.OpenAiBalanced,
                openAiClient.GetChatClient(Models.OpenAiBalanced)
                    .AsIChatClient()
                    .AsBuilder()
                    .UseFunctionInvocation()
                    .Build());
        }

        // ------------------------------------------------------------------
        // Ollama (local) — OllamaSharp directly implements IChatClient.
        // Registered unconditionally: OllamaApiClient is a lazy HTTP wrapper
        // that only connects on first request, so startup reachability gating
        // is unnecessary. This allows Ollama to be started after app boot.
        // ------------------------------------------------------------------
        services.AddKeyedSingleton<IChatClient>(Models.Local,
            new OllamaApiClient(ollamaUri, Models.Local));

        // ------------------------------------------------------------------
        // Stable aliases: "fast" and "balanced"
        // If Models:Fast / Models:Balanced is set in config, that model key is
        // used directly. Otherwise falls back through the priority chain.
        // ------------------------------------------------------------------
        var configuredFast     = config["Models:Fast"];
        var configuredBalanced = config["Models:Balanced"];

        services.AddKeyedSingleton<IChatClient>("fast", (sp, _) =>
        {
            if (!string.IsNullOrWhiteSpace(configuredFast))
            {
                var client = (sp as IKeyedServiceProvider)?.GetKeyedService<IChatClient>(configuredFast);
                if (client is not null) return client;
                throw new InvalidOperationException(
                    $"Model '{configuredFast}' is configured as Models:Fast but its provider is not registered. " +
                    "Check that the corresponding API key is set.");
            }
            return ResolveFast(sp) ?? throw new InvalidOperationException(
                "No fast model available. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or start Ollama.");
        });

        services.AddKeyedSingleton<IChatClient>("balanced", (sp, _) =>
        {
            if (!string.IsNullOrWhiteSpace(configuredBalanced))
            {
                var client = (sp as IKeyedServiceProvider)?.GetKeyedService<IChatClient>(configuredBalanced);
                if (client is not null) return client;
                throw new InvalidOperationException(
                    $"Model '{configuredBalanced}' is configured as Models:Balanced but its provider is not registered. " +
                    "Check that the corresponding API key is set.");
            }
            return ResolveBalanced(sp) ?? throw new InvalidOperationException(
                "No balanced model available. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or start Ollama.");
        });

        // ------------------------------------------------------------------
        // Semantic Kernel — only built when at least one key is configured
        // ------------------------------------------------------------------
        if (!string.IsNullOrEmpty(openAiKey))
        {
            services.AddSingleton(_ =>
                Kernel.CreateBuilder()
                    .AddOpenAIChatCompletion(Models.OpenAiBalanced, openAiKey, serviceId: "openai")
                    .Build());
        }

        return services;
    }

    /// <summary>
    /// Returns the first available IChatClient from an ordered list of model keys.
    /// Falls back through Anthropic → OpenAI → Ollama depending on what keys are configured.
    /// </summary>
    public static IChatClient? ResolveFirst(IServiceProvider services, params string[] modelKeys)
    {
        if (services is not IKeyedServiceProvider keyed) return null;
        foreach (var key in modelKeys)
        {
            var client = keyed.GetKeyedService<IChatClient>(key);
            if (client is not null) return client;
        }
        return null;
    }

    /// <summary>Ordered fast model candidates: haiku → gpt-4o-mini → llama3.2</summary>
    public static IChatClient? ResolveFast(IServiceProvider services) =>
        ResolveFirst(services, Models.Fast, Models.OpenAiFast, Models.Local);

    /// <summary>Ordered balanced model candidates: sonnet → gpt-4o → llama3.2</summary>
    public static IChatClient? ResolveBalanced(IServiceProvider services) =>
        ResolveFirst(services, Models.Balanced, Models.OpenAiBalanced, Models.Local);

}

/// <summary>
/// Wraps a shared IChatClient and pins a specific model ID into ChatOptions,
/// so keyed DI registrations can select different Anthropic models.
/// </summary>
internal sealed class ModelBoundChatClient(IChatClient inner, string modelId) : IChatClient
{
    public Task<ChatResponse> GetResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken ct = default)
    {
        var opts = options ?? new ChatOptions();
        opts.ModelId ??= modelId;
        return inner.GetResponseAsync(messages, opts, ct);
    }

    public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken ct = default)
    {
        var opts = options ?? new ChatOptions();
        opts.ModelId ??= modelId;
        return inner.GetStreamingResponseAsync(messages, opts, ct);
    }

    public object? GetService(Type serviceType, object? key = null)
        => inner.GetService(serviceType, key);

    public void Dispose() { }
}
