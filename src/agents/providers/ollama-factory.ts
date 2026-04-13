import { createOllama } from "ollama-ai-provider-v2";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import type { ConsumerType, ModelEntry, ProviderConfig } from "../../types/index.js";
import { resolveAdapter } from "../../types/index.js";

/**
 * Build a Vercel AI SDK LanguageModel for an Ollama instance.
 *
 * Adapter selection is dynamic — the same instance serves both:
 *   - General inference (OpenAI wire protocol)
 *   - Claude Code workers (Anthropic wire protocol)
 *
 * The ConsumerType drives the decision at call time, not at config time.
 */
export function buildOllamaModel(
  entry: ModelEntry,
  consumer: ConsumerType,
  configs: ProviderConfig[]
): LanguageModel {
  const config = configs.find(c => c.id === entry.instanceId);
  if (!config?.baseUrl) {
    throw new Error(`No config found for instanceId: ${entry.instanceId}`);
  }

  const adapter = resolveAdapter(entry, consumer);

  if (adapter === "anthropic") {
    // Anthropic-compatible path — used by Claude Code workers.
    // Ollama ignores the API key value; the SDK requires the field.
    const client = createAnthropic({
      baseURL: config.baseUrl,
      apiKey: "ollama",
    });
    return client(entry.model);
  }

  // OpenAI-compatible path — default for general inference
  const client = createOllama({ baseURL: `${config.baseUrl}/v1` });
  return client(entry.model);
}
