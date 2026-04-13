import { generateObject } from "ai";
import type {
  ModelEntry,
  ProviderCallRecord,
  RoutingContext,
  ProviderConfig,
} from "../../types/index.js";
import { resolveModel } from "./index.js";
import { buildOllamaModel } from "./ollama-factory.js";
import { assignTier } from "./index.js";
import { calculateCallCost } from "./catalog.js";

/**
 * Execute a generateObject call with cost/usage tracking.
 *
 * Mirrors trackedGenerate() but wraps generateObject() for structured-output
 * phases (pre-planning, planning, verification) that use Zod schemas.
 *
 * Returns the full generateObject result augmented with `llmCostUsd` so
 * orchestrators can include the phase cost in their return value without
 * an additional calculateCallCost() call.
 *
 * @param entry           Resolved model entry from resolveModelForTask()
 * @param ctx             Routing context (complexityScore, consumer, etc.)
 * @param params          generateObject parameters excluding "model"
 * @param providerConfigs Active ProviderConfig list (needed for Ollama instances)
 * @param onRecord        Callback to persist the ProviderCallRecord (e.g. POST to backend)
 */
export async function trackedGenerateObject(
  entry: ModelEntry,
  ctx: RoutingContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: Omit<Parameters<typeof generateObject>[0], "model">,
  providerConfigs: ProviderConfig[],
  onRecord: (record: ProviderCallRecord) => Promise<void>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Awaited<ReturnType<typeof generateObject<any, any>>> & { llmCostUsd: number }> {
  const start = Date.now();
  const consumer = ctx.consumer ?? "general";

  const model = entry.provider === "ollama"
    ? buildOllamaModel(entry, consumer, providerConfigs)
    : resolveModel({ provider: entry.provider, model: entry.model });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await generateObject({ ...params, model } as any);
  const usage = result.usage;

  const llmCostUsd = calculateCallCost(entry, usage.inputTokens ?? 0, usage.outputTokens ?? 0);

  await onRecord({
    id: crypto.randomUUID(),
    timestamp: new Date(),
    instanceId: entry.instanceId,
    provider: entry.provider,
    model: entry.model,
    tier: assignTier(ctx.complexityScore),
    consumer,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    costUsd: llmCostUsd,
    durationMs: Date.now() - start,
    wasEscalated: (ctx.excludeInstances?.length ?? 0) > 0,
  });

  return { ...result, llmCostUsd };
}
