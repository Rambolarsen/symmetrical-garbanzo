import { generateText } from "ai";
import type {
  ModelEntry,
  ProviderCallRecord,
  RoutingContext,
  ProviderConfig,
} from "../../types/index.js";
import { resolveModel, effectiveTierFromCtx } from "./index.js";
import { buildOllamaModel } from "./ollama-factory.js";
import { calculateCallCost } from "./catalog.js";

/**
 * Execute a generateText call with cost/usage tracking.
 *
 * All agent calls should use this instead of raw generateText() so that
 * token usage and cost are consistently recorded.
 *
 * @param entry           Resolved model entry from resolveModelForTask()
 * @param ctx             Routing context (complexityScore, consumer, etc.)
 * @param params          generateText parameters excluding "model"
 * @param providerConfigs Active ProviderConfig list (needed for Ollama instances)
 * @param onRecord        Callback to persist the ProviderCallRecord (e.g. POST to backend)
 */
export async function trackedGenerate(
  entry: ModelEntry,
  ctx: RoutingContext,
  params: Omit<Parameters<typeof generateText>[0], "model">,
  providerConfigs: ProviderConfig[],
  onRecord: (record: ProviderCallRecord) => Promise<void>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Awaited<ReturnType<typeof generateText<any, any>>>> {
  const start = Date.now();
  const consumer = ctx.consumer ?? "general";

  const model = entry.provider === "ollama"
    ? buildOllamaModel(entry, consumer, providerConfigs)
    : resolveModel({ provider: entry.provider, model: entry.model });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await generateText({ ...params, model } as any);
  const usage = result.usage;
  const caps = entry.capabilities;

  await onRecord({
    id: crypto.randomUUID(),
    timestamp: new Date(),
    instanceId: entry.instanceId,
    provider: entry.provider,
    model: entry.model,
    tier: effectiveTierFromCtx(ctx),
    consumer,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    costUsd: calculateCallCost(entry, usage.inputTokens ?? 0, usage.outputTokens ?? 0),
    durationMs: Date.now() - start,
    wasEscalated: (ctx.excludeInstances?.length ?? 0) > 0,
  });

  return result;
}
