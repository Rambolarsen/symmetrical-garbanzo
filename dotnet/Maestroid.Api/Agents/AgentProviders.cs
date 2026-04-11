using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.SemanticKernel;
using Anthropic.SDK;
using OllamaSharp;
using System.Net.Http.Json;

namespace Maestroid.Api.Agents;

public static class Models
{
    public const string Fast           = "claude-haiku-4-5-20251001";
    public const string Balanced       = "claude-sonnet-4-6";
    public const string Powerful       = "claude-opus-4-6";
    public const string OpenAiFast     = "gpt-4o-mini";
    public const string OpenAiBalanced = "gpt-4o";

    /// <summary>
    /// Default local model name. Resolved at startup from config key "Models:Local".
    /// Defaults to "llama3.2" if not set.
    /// </summary>
    public static string Local { get; internal set; } = "llama3.2";
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

        var available = new List<string>();

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
                available.Add(m);
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

            available.Add(Models.OpenAiFast);
            available.Add(Models.OpenAiBalanced);
        }

        // ------------------------------------------------------------------
        // Ollama (local) — auto-discover models from /api/tags at startup.
        // Falls back to Models:Local / Models:LocalModels config if Ollama
        // is offline at boot (models will be registered lazily, connecting
        // only on first request).
        // ------------------------------------------------------------------
        var configuredLocal = config["Models:Local"];
        if (!string.IsNullOrWhiteSpace(configuredLocal))
            Models.Local = configuredLocal;

        var localModels = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var discovered = DiscoverOllamaModels(ollamaUri);
        foreach (var m in discovered)
            localModels.Add(m);

        localModels.Add(Models.Local);
        var extraModels = config["Models:LocalModels"];
        if (!string.IsNullOrWhiteSpace(extraModels))
        {
            foreach (var m in extraModels.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                localModels.Add(m);
        }

        if (string.IsNullOrWhiteSpace(configuredLocal) && discovered.Count > 0)
            Models.Local = discovered[0];

        // OllamaApiClient uses a shared HttpClient with a generous timeout.
        // The default 100s HttpClient timeout causes TaskCanceledException (→ 499)
        // when local models take longer on large prompts like planning.
        var ollamaHttp = new HttpClient { BaseAddress = ollamaUri, Timeout = TimeSpan.FromMinutes(10) };

        foreach (var localModel in localModels)
        {
            var m = localModel;
            services.AddKeyedSingleton<IChatClient>(m, new OllamaApiClient(ollamaHttp, m));
            available.Add(m);
        }

        // ------------------------------------------------------------------
        // ModelSelectionService — determines initial fast/balanced defaults,
        // then lets the UI override them at runtime.
        // ------------------------------------------------------------------
        var configuredFast     = config["Models:Fast"];
        var configuredBalanced = config["Models:Balanced"];

        var initialFast     = ResolveInitialKey(configuredFast,     available, [Models.Fast,     Models.OpenAiFast,     Models.Local]);
        var initialBalanced = ResolveInitialKey(configuredBalanced, available, [Models.Balanced, Models.OpenAiBalanced, Models.Local]);

        services.AddSingleton(new ModelSelectionService(initialFast, initialBalanced, available.AsReadOnly()));

        // ------------------------------------------------------------------
        // Stable aliases: "fast" and "balanced"
        // Singleton DynamicTierChatClient delegates to whichever model
        // ModelSelectionService currently points to — resolved per call,
        // not per registration. Singleton avoids DI disposing the underlying
        // provider clients (which are also singletons) at scope end.
        // ------------------------------------------------------------------
        services.AddKeyedSingleton<IChatClient>("fast", (sp, _) =>
            new DynamicTierChatClient("fast", sp.GetRequiredService<ModelSelectionService>(), sp));

        services.AddKeyedSingleton<IChatClient>("balanced", (sp, _) =>
            new DynamicTierChatClient("balanced", sp.GetRequiredService<ModelSelectionService>(), sp));

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
    /// Resolves an initial model key for a tier. Uses the configured value if it's in the available
    /// list, otherwise walks the candidate priority list.
    /// </summary>
    private static string ResolveInitialKey(string? configured, List<string> available, string[] candidates)
    {
        if (!string.IsNullOrWhiteSpace(configured) && available.Contains(configured))
            return configured;
        return candidates.FirstOrDefault(available.Contains)
            ?? available.FirstOrDefault()
            ?? Models.Local;
    }

    /// <summary>
    /// Synchronously queries Ollama's /api/tags and returns the list of available model names.
    /// Returns an empty list if Ollama is unreachable or returns an unexpected response.
    /// </summary>
    private static List<string> DiscoverOllamaModels(Uri ollamaUri)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
            var url = $"{ollamaUri.ToString().TrimEnd('/')}/api/tags";
            var response = http.GetAsync(url).GetAwaiter().GetResult();
            if (!response.IsSuccessStatusCode) return [];

            var body = response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>()
                .GetAwaiter().GetResult();

            if (!body.TryGetProperty("models", out var arr)) return [];

            return [.. arr.EnumerateArray()
                .Select(m => m.TryGetProperty("name", out var n) ? n.GetString() : null)
                .Where(n => !string.IsNullOrWhiteSpace(n))
                .Select(n => n!)];
        }
        catch
        {
            return [];
        }
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

/// <summary>
/// Singleton alias client for a tier ("fast" or "balanced").
/// Resolves the backing IChatClient from ModelSelectionService on every call
/// so that runtime model changes take effect without restarting.
/// Being a singleton prevents DI from disposing the underlying provider clients.
/// </summary>
internal sealed class DynamicTierChatClient(
    string tier,
    ModelSelectionService selection,
    IServiceProvider services) : IChatClient
{
    private IChatClient Current
    {
        get
        {
            var key = tier == "fast" ? selection.Fast : selection.Balanced;
            return (services as IKeyedServiceProvider)!.GetRequiredKeyedService<IChatClient>(key);
        }
    }

    public Task<ChatResponse> GetResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken ct = default)
        => Current.GetResponseAsync(messages, options, ct);

    public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken ct = default)
        => Current.GetStreamingResponseAsync(messages, options, ct);

    public object? GetService(Type serviceType, object? key = null)
        => Current.GetService(serviceType, key);

    public void Dispose() { }
}
