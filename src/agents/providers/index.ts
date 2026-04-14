import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { createOllama } from "ollama-ai-provider-v2";
import type { LanguageModel } from "ai";
import type {
  ModelRef,
  ModelEntry,
  ModelTier,
  ProviderName,
  ProviderConfig,
  RoutingContext,
} from "../../types/index.js";
import { TIER_RANK } from "../../types/index.js";
import { getCatalog, isOllamaInstance } from "./catalog.js";

const ollama = createOllama();

/**
 * Resolve a ModelRef to a Vercel AI SDK LanguageModelV1 instance.
 * This is the single place where provider routing happens for non-Ollama models.
 * For Ollama models with consumer-specific adapter needs, use buildOllamaModel().
 */
export function resolveModel(ref: ModelRef): LanguageModel {
  switch (ref.provider) {
    case "anthropic":
      return anthropic(ref.model);
    case "openai":
      return openai(ref.model);
    case "google":
      return google(ref.model);
    case "ollama":
      return ollama(ref.model);
    default:
      throw new Error(`Unknown provider: ${(ref as ModelRef).provider}`);
  }
}

// ---------------------------------------------------------------------------
// Provider availability
// ---------------------------------------------------------------------------

/** Returns true if the provider has its credentials configured. */
export function isProviderAvailable(provider: ProviderName): boolean {
  switch (provider) {
    case "anthropic": return !!process.env.ANTHROPIC_API_KEY;
    case "openai":    return !!process.env.OPENAI_API_KEY;
    case "google":    return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    case "ollama":    return true; // no key needed
  }
}

/** Returns the list of currently configured providers, in priority order. */
export function availableProviders(): ProviderName[] {
  const all: ProviderName[] = ["anthropic", "openai", "google", "ollama"];
  return all.filter(isProviderAvailable);
}

/**
 * Check whether a given instanceId is currently reachable/configured.
 * Cloud providers: checks for the corresponding API key env var.
 * Ollama instances: assumed reachable (actual reachability checked at call time).
 */
export function isInstanceAvailable(instanceId: string): boolean {
  switch (instanceId) {
    case "anthropic": return !!process.env.ANTHROPIC_API_KEY;
    case "openai":    return !!process.env.OPENAI_API_KEY;
    case "google":    return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    default:
      // Ollama instances are assumed reachable — actual network reachability is
      // confirmed on the call attempt. Use isOllamaInstance() so UUID-based IDs
      // from the DB (e.g. "00000000-0000-0000-0000-000000000001") are recognised
      // as well as human-readable names like "ollama-local".
      return isOllamaInstance(instanceId);
  }
}

// ---------------------------------------------------------------------------
// Tier thresholds & assignment
// ---------------------------------------------------------------------------

export type { ModelTier };

export const TIER_THRESHOLDS = {
  fast:     { min: 0,  max: 29  },
  balanced: { min: 30, max: 64  },
  powerful: { min: 65, max: 100 },
} as const;

export function assignTier(complexityScore: number): ModelTier {
  if (complexityScore < 30) return "fast";
  if (complexityScore < 65) return "balanced";
  return "powerful";
}

/**
 * Returns the effective tier after applying the minTier floor from the routing context.
 * Use this (not assignTier) when recording telemetry so the logged tier matches
 * the model that was actually used.
 */
export function effectiveTierFromCtx(ctx: RoutingContext): ModelTier {
  const assigned = assignTier(ctx.complexityScore);
  return ctx.minTier !== undefined && TIER_RANK[assigned] < TIER_RANK[ctx.minTier]
    ? ctx.minTier
    : assigned;
}

// ---------------------------------------------------------------------------
// Tier catalog — ordered list of { instanceId, model } refs per tier.
// Built at startup after ProviderConfigs and Ollama discovery complete.
// ---------------------------------------------------------------------------

type TierRef = { instanceId: string; model: string };

// Default static tier catalog for cloud providers only (no Ollama).
// Used before buildTierCatalog() is called.
const DEFAULT_TIER_CATALOG: Record<ModelTier, TierRef[]> = {
  fast: [
    { instanceId: "anthropic", model: "claude-haiku-4-5-20251001" },
    { instanceId: "openai",    model: "gpt-4.1-mini" },
    { instanceId: "google",    model: "gemini-2.0-flash" },
  ],
  balanced: [
    { instanceId: "anthropic", model: "claude-sonnet-4-6" },
    { instanceId: "openai",    model: "gpt-4.1" },
    { instanceId: "google",    model: "gemini-2.5-pro" },
  ],
  powerful: [
    { instanceId: "anthropic", model: "claude-opus-4-6" },
    { instanceId: "openai",    model: "gpt-4.1" },
    { instanceId: "google",    model: "gemini-2.5-pro" },
  ],
};

let _tierCatalog: Record<ModelTier, TierRef[]> = DEFAULT_TIER_CATALOG;

/**
 * Build and store the tier catalog after startup.
 * Cloud providers appear first (fixed priority), then Ollama instances
 * sorted by priority ascending (lower number = higher priority).
 * Each Ollama instance contributes all models discovered for that instance.
 */
export function buildTierCatalog(
  providerConfigs: ProviderConfig[]
): Record<ModelTier, TierRef[]> {
  const catalog = getCatalog();

  // Collect all catalog entries grouped by instanceId
  const byInstance = new Map<string, TierRef[]>();
  for (const entry of catalog.values()) {
    if (!byInstance.has(entry.instanceId)) {
      byInstance.set(entry.instanceId, []);
    }
    byInstance.get(entry.instanceId)!.push({ instanceId: entry.instanceId, model: entry.model });
  }

  // Sort Ollama configs by priority (ascending = higher priority first)
  const ollamaConfigs = providerConfigs
    .filter(c => c.provider === "ollama" && c.enabled)
    .sort((a, b) => a.priority - b.priority);

  const tiers: ModelTier[] = ["fast", "balanced", "powerful"];
  const result = {} as Record<ModelTier, TierRef[]>;

  for (const tier of tiers) {
    const refs: TierRef[] = [...DEFAULT_TIER_CATALOG[tier]];

    // Append Ollama instances after cloud providers
    for (const cfg of ollamaConfigs) {
      const instanceRefs = byInstance.get(cfg.id) ?? [];
      refs.push(...instanceRefs);
    }

    result[tier] = refs;
  }

  _tierCatalog = result;
  return result;
}

// ---------------------------------------------------------------------------
// Capability-aware model selection
// ---------------------------------------------------------------------------

/**
 * Two-level routing:
 *   Level 1 — provider priority (anthropic → openai → google → ollama)
 *   Level 2 — within ollama, instance priority (remote → local)
 *
 * Returns a resolved ModelEntry. For Ollama entries, callers should pass this
 * to resolveAdapter() alongside their ConsumerType to get the correct wire protocol.
 */
export function resolveModelForTask(ctx: RoutingContext): ModelEntry {
  const assignedTier = assignTier(ctx.complexityScore);
  const effectiveTier: ModelTier =
    ctx.minTier !== undefined && TIER_RANK[assignedTier] < TIER_RANK[ctx.minTier]
      ? ctx.minTier
      : assignedTier;
  const candidates = _tierCatalog[effectiveTier];
  const catalog = getCatalog();
  const excluded = new Set(ctx.excludeInstances ?? []);

  for (const ref of candidates) {
    if (excluded.has(ref.instanceId)) continue;
    if (!isInstanceAvailable(ref.instanceId)) continue;

    const entry = catalog.get(`${ref.instanceId}/${ref.model}`);
    if (!entry) continue;

    const caps = entry.capabilities;
    if (ctx.requiresToolUse && !caps.supportsToolUse) continue;
    if (ctx.requiresVision && !caps.supportsVision) continue;
    if (ctx.estimatedInputTokens && ctx.estimatedInputTokens > caps.contextWindow) continue;
    if (caps.minComplexityScore !== undefined && ctx.complexityScore < caps.minComplexityScore) continue;
    if (caps.maxComplexityScore !== undefined && ctx.complexityScore > caps.maxComplexityScore) continue;
    if (ctx.preferLocal && !caps.isLocal) continue;

    return entry;
  }

  // preferLocal failed — retry without the local constraint
  if (ctx.preferLocal) {
    return resolveModelForTask({ ...ctx, preferLocal: false });
  }

  throw new Error(`No suitable model found for complexity=${ctx.complexityScore}, tier=${effectiveTier}`);
}

// ---------------------------------------------------------------------------
// Fallback / escalation wrapper
// ---------------------------------------------------------------------------

/**
 * Execute fn with automatic provider fallback on failure.
 * Each attempt picks the best available model excluding previously failed instances.
 */
export async function withProviderFallback<T>(
  ctx: RoutingContext,
  fn: (entry: ModelEntry) => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  const excluded: string[] = [...(ctx.excludeInstances ?? [])];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const entry = resolveModelForTask({ ...ctx, excludeInstances: excluded });
    try {
      return await fn(entry);
    } catch (err) {
      excluded.push(entry.instanceId);
      if (attempt + 1 >= maxAttempts) throw err;
      // Next iteration will naturally pick the next available instance.
    }
  }

  throw new Error("All fallback attempts exhausted");
}

// ---------------------------------------------------------------------------
// Legacy MODELS convenience object — kept for backward compatibility.
// New code should use resolveModelForTask() instead.
// ---------------------------------------------------------------------------

function resolveTierLegacy(tier: "fast" | "balanced" | "powerful"): ModelRef {
  const candidates: Record<string, ModelRef[]> = {
    fast: [
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
      { provider: "openai",    model: "gpt-4.1-mini" },
      { provider: "google",    model: "gemini-2.0-flash" },
      { provider: "ollama",    model: "llama3.2" },
    ],
    balanced: [
      { provider: "anthropic", model: "claude-sonnet-4-6" },
      { provider: "openai",    model: "gpt-4.1" },
      { provider: "google",    model: "gemini-2.5-pro" },
      { provider: "ollama",    model: "llama3.2" },
    ],
    powerful: [
      { provider: "anthropic", model: "claude-opus-4-6" },
      { provider: "openai",    model: "o3" },
      { provider: "google",    model: "gemini-2.5-pro" },
      { provider: "ollama",    model: "llama3.2" },
    ],
  };
  const winner = candidates[tier].find(ref => isProviderAvailable(ref.provider));
  if (!winner) throw new Error(`No provider available for tier "${tier}". Set at least one API key or run Ollama.`);
  return winner;
}

export const MODELS = {
  // Tier-based: resolves to the best available provider at call time
  get fast()     { return resolveTierLegacy("fast"); },
  get balanced() { return resolveTierLegacy("balanced"); },
  get powerful() { return resolveTierLegacy("powerful"); },

  // Anthropic (requires ANTHROPIC_API_KEY)
  anthropic_fast:     { provider: "anthropic", model: "claude-haiku-4-5-20251001" } as ModelRef,
  anthropic_balanced: { provider: "anthropic", model: "claude-sonnet-4-6" } as ModelRef,
  anthropic_powerful: { provider: "anthropic", model: "claude-opus-4-6" } as ModelRef,

  // OpenAI (requires OPENAI_API_KEY)
  openai_fast:     { provider: "openai", model: "gpt-4.1-mini" } as ModelRef,
  openai_balanced: { provider: "openai", model: "gpt-4.1" } as ModelRef,
  openai_powerful: { provider: "openai", model: "o3" } as ModelRef,

  // Google (requires GOOGLE_GENERATIVE_AI_API_KEY)
  google_fast:     { provider: "google", model: "gemini-2.0-flash" } as ModelRef,
  google_balanced: { provider: "google", model: "gemini-2.5-pro" } as ModelRef,

  // Local — no API cost, explicit Ollama ref
  local: { provider: "ollama", model: "llama3.2" } as ModelRef,
};
