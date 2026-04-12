import type { ModelEntry, OllamaInstanceConfig } from "../../types/index.js";

// Models known to support tool/function calling via Ollama
const TOOL_CAPABLE_MODELS = ["qwen3.5", "glm-4", "kimi", "llama3.3", "mistral"];

function isToolCapable(name: string): boolean {
  return TOOL_CAPABLE_MODELS.some(m => name.toLowerCase().includes(m));
}

async function discoverInstance(config: OllamaInstanceConfig): Promise<ModelEntry[]> {
  try {
    const res = await fetch(`${config.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];

    const data = await res.json() as { models: Array<{ name: string }> };

    return data.models.map(m => ({
      instanceId: config.instanceId,
      provider: "ollama" as const,
      model: m.name,
      displayName: `${m.name} (${config.instanceId})`,
      capabilities: {
        contextWindow: 32768,        // conservative default; actual depends on OLLAMA_NUM_CTX
        maxOutputTokens: 8192,
        supportsToolUse: isToolCapable(m.name),
        supportsVision: false,
        supportsStreaming: true,
        costPerInputToken: 0,
        costPerOutputToken: 0,
        isLocal: config.instanceId === "ollama-local",
        maxComplexityScore: 40,
      },
    }));
  } catch {
    // Instance unreachable — degrade gracefully, do not throw
    return [];
  }
}

/**
 * Discover models across all configured Ollama instances concurrently.
 * Unreachable instances silently return empty arrays.
 */
export async function discoverAllOllamaModels(
  configs: OllamaInstanceConfig[]
): Promise<ModelEntry[]> {
  const results = await Promise.all(configs.map(discoverInstance));
  return results.flat();
}
