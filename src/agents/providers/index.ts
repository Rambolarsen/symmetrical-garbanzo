import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { createOllama } from "ollama-ai-provider-v2";
import type { LanguageModel } from "ai";
import type { ModelRef, ProviderName } from "../../types/index.js";

const ollama = createOllama();

/**
 * Resolve a ModelRef to a Vercel AI SDK LanguageModelV1 instance.
 * This is the single place where provider routing happens.
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
// Dynamic tier resolution — picks the best available provider at runtime
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
 * Priority-ordered model catalog per tier.
 * First entry whose provider is available wins.
 */
const CATALOG: Record<"fast" | "balanced" | "powerful", ModelRef[]> = {
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

function resolveTier(tier: keyof typeof CATALOG): ModelRef {
  const winner = CATALOG[tier].find(ref => isProviderAvailable(ref.provider));
  if (!winner) throw new Error(`No provider available for tier "${tier}". Set at least one API key or run Ollama.`);
  return winner;
}

// ---------------------------------------------------------------------------
// MODELS — convenience refs. fast/balanced/powerful resolve dynamically.
// Explicit named refs are always available for when you need a specific model.
// ---------------------------------------------------------------------------
export const MODELS = {
  // Tier-based: resolves to the best available provider at call time
  get fast()     { return resolveTier("fast"); },
  get balanced() { return resolveTier("balanced"); },
  get powerful() { return resolveTier("powerful"); },

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
