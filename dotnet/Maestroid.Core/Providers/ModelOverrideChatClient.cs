using Microsoft.Extensions.AI;

namespace Maestroid.Core.Providers;

/// <summary>
/// Wraps a shared IChatClient and overrides the model ID on every call.
///
/// Used by ProviderRegistry.BuildClient() so an instanceId-keyed transport client
/// (e.g. "anthropic", "openai") can serve any specific model in the catalog
/// without requiring a separate DI registration per model name.
///
/// The model ID from the resolved ModelEntry always wins — this is authoritative
/// routing, not a hint.
/// </summary>
internal sealed class ModelOverrideChatClient(IChatClient inner, string modelId) : IChatClient
{
    public Task<ChatResponse> GetResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken ct = default)
    {
        var opts = options ?? new ChatOptions();
        opts.ModelId = modelId;
        return inner.GetResponseAsync(messages, opts, ct);
    }

    public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken ct = default)
    {
        var opts = options ?? new ChatOptions();
        opts.ModelId = modelId;
        return inner.GetStreamingResponseAsync(messages, opts, ct);
    }

    public object? GetService(Type serviceType, object? key = null)
        => inner.GetService(serviceType, key);

    public void Dispose() { }
}
