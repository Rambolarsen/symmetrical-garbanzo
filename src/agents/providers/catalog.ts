import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { ModelEntry } from "../../types/index.js";

const _dirname = dirname(fileURLToPath(import.meta.url));

// Load the bundled JSON at module init time (synchronous, file is small)
const _rawCatalog = JSON.parse(
  readFileSync(join(_dirname, "model-catalog.json"), "utf-8")
) as { models: ModelEntry[] };

let _catalog: Map<string, ModelEntry> | null = null;

/**
 * Set of all instanceIds whose provider is "ollama", populated by loadCatalog().
 * Used by isOllamaInstance() so UUID-based IDs from the DB are recognised.
 */
let _ollamaInstanceIds = new Set<string>();

/**
 * Catalog key: `instanceId/model`
 * e.g. "ollama-remote/qwen3.5", "anthropic/claude-sonnet-4-6"
 *
 * Using instanceId as the key prefix lets the same model on two different
 * Ollama instances coexist as distinct entries.
 */
function catalogKey(entry: ModelEntry): string {
  return `${entry.instanceId}/${entry.model}`;
}

/**
 * Load and merge the three-layer catalog. Call once at startup; cached in-process.
 *
 * Layer 1 (lowest):  Bundled JSON file — ships with the app
 * Layer 2:           Ollama runtime discovery — local models discovered at startup
 * Layer 3 (highest): User DB entries — per-user overrides and custom endpoints
 *
 * @param ollamaModels  Layer 2 — discovered at runtime, per Ollama instance
 * @param userModels    Layer 3 — fetched from backend DB
 */
export function loadCatalog(
  ollamaModels: ModelEntry[] = [],
  userModels: ModelEntry[] = []
): Map<string, ModelEntry> {
  const catalog = new Map<string, ModelEntry>();

  // Layer 1: bundled defaults (cloud providers)
  for (const entry of _rawCatalog.models) {
    catalog.set(catalogKey(entry), entry);
  }

  // Layer 2: Ollama runtime discovery, one entry per instance/model combination
  for (const entry of ollamaModels) {
    catalog.set(catalogKey(entry), entry);
  }

  // Layer 3: user DB entries win over everything
  for (const entry of userModels) {
    catalog.set(catalogKey(entry), entry);
  }

  _catalog = catalog;

  // Track all Ollama instanceIds so UUID-based IDs from the DB are recognised
  // by isOllamaInstance() even when the id doesn't start with "ollama".
  _ollamaInstanceIds = new Set(
    [...catalog.values()]
      .filter(e => e.provider === "ollama")
      .map(e => e.instanceId)
  );

  return catalog;
}

export function getCatalog(): Map<string, ModelEntry> {
  if (!_catalog) throw new Error("Catalog not loaded. Call loadCatalog() at startup.");
  return _catalog;
}

/** Invalidate cache — call after user updates a DB entry */
export function invalidateCatalog(): void {
  _catalog = null;
  _ollamaInstanceIds = new Set();
}

/**
 * Returns true if the given instanceId is an Ollama instance.
 * Checks both the catalog (which handles UUID-based IDs from the DB) and
 * falls back to a name heuristic for instances not yet in the catalog.
 */
export function isOllamaInstance(instanceId: string): boolean {
  return _ollamaInstanceIds.has(instanceId) || instanceId.startsWith("ollama");
}
