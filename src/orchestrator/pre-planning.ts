import { z } from "zod";
import { resolveModelForTask } from "../agents/providers/index.js";
import { trackedGenerateObject } from "../agents/providers/tracked-generate-object.js";
import type { PrePlanningResult, RoutingContext, ProviderCallRecord, ProviderConfig } from "../types/index.js";

const PrePlanningSchema = z.object({
  isTaskCoherent: z.boolean(),
  coherenceNotes: z.string(),
  complexityScore: z.number().min(0).max(100),
  complexityLevel: z.enum(["trivial", "simple", "moderate", "complex", "enterprise"]),
  requiresPlanning: z.boolean(),
  recommendsPlanning: z.boolean(),
  estimatedHours: z.number(),
  estimatedCostUsd: z.number(),
  scoreRationale: z.string(),
  scoreBreakdown: z.array(z.object({
    description: z.string(),
    score: z.number().int().min(0).max(100),
    rationale: z.string(),
  })),
  risks: z.array(z.object({
    description: z.string(),
    severity: z.enum(["low", "medium", "high", "critical"]),
    mitigation: z.string(),
  })),
  constraints: z.array(z.string()),
  assumptions: z.array(z.string()),
  successCriteria: z.array(z.string()),
  recommendedAgents: z.array(z.object({
    name: z.string(),
    instructions: z.string(),
  })),
  reasoning: z.string(),
});

const RESEARCHER_SYSTEM = `You are a scope analysis agent. Your job is to analyze a task and produce a structured assessment.

Be concise and honest. Do not pad estimates. Do not recommend planning when it is not needed.

First determine whether the task is coherent and actionable.
If the task is nonsensical, self-contradictory, pure gibberish, or too vague to scope, set isTaskCoherent=false.

Complexity scoring guide:
  0-20:  Trivial   — single file, no dependencies, routine change
  21-40: Simple    — small feature, known pattern, minimal deps
  41-60: Moderate  — multiple components, some integration work
  61-80: Complex   — cross-cutting concerns, significant risk
  81-100: Enterprise — multi-system, compliance, high stakes

Planning recommendation thresholds:
  - requiresPlanning: complexity >= 70 (you MUST recommend planning)
  - recommendsPlanning: complexity >= 45 (planning would help but user can skip)
  - Below 45: skip planning, go straight to development

If isTaskCoherent is false:
  - set complexityScore=0, complexityLevel=trivial, requiresPlanning=false, recommendsPlanning=false
  - set estimatedHours=0 and estimatedCostUsd=0
  - return an empty scoreBreakdown
  - explain why the task cannot be scored in coherenceNotes and scoreRationale

If isTaskCoherent is true:
  - provide 2-5 scoreBreakdown factors
  - scoreBreakdown scores must sum exactly to complexityScore
  - explain the total score in scoreRationale`;

async function noopRecord(_record: ProviderCallRecord): Promise<void> {}

export interface PrePlanningOptions {
  routingContext?: Partial<RoutingContext>;  // override defaults if needed
  context?: string;                          // optional extra context (e.g. codebase summary)
  providerConfigs?: ProviderConfig[];
  onRecord?: (record: ProviderCallRecord) => Promise<void>;
}

export interface PrePlanningRun {
  result: PrePlanningResult;
  llmCostUsd: number;
  durationMs: number;
}

/**
 * Phase 0: Pre-Planning
 *
 * Analyzes the task and returns a complexity score + recommendation on whether
 * full planning (Phase 1 / WBS) is needed before development.
 *
 * Uses complexityScore: 0 (bootstrapping convention) — the score doesn't exist
 * yet, so we deliberately use the cheapest tier. This is not a hardcode; it is
 * the routing system expressing "I don't know the complexity yet."
 */
export async function runPrePlanning(
  task: string,
  options: PrePlanningOptions = {}
): Promise<PrePlanningRun> {
  const ctx: RoutingContext = {
    complexityScore: 0,       // bootstrapping convention — see spec section 2
    requiresToolUse: false,
    consumer: "general",
    ...options.routingContext,
  };

  const entry = resolveModelForTask(ctx);

  const prompt = options.context
    ? `Task: ${task}\n\nAdditional context:\n${options.context}`
    : `Task: ${task}`;

  const start = Date.now();

  const { object, llmCostUsd } = await trackedGenerateObject(
    entry,
    ctx,
    {
      system: RESEARCHER_SYSTEM,
      prompt,
      schema: PrePlanningSchema,
    },
    options.providerConfigs ?? [],
    options.onRecord ?? noopRecord
  );

  const scopeId = `scope_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const result: PrePlanningResult = {
    scopeId,
    isTaskCoherent: object.isTaskCoherent,
    coherenceNotes: object.coherenceNotes,
    complexityScore: object.complexityScore,
    complexityLevel: object.complexityLevel,
    requiresPlanning: object.requiresPlanning,
    recommendsPlanning: object.recommendsPlanning,
    estimatedHours: object.estimatedHours,
    estimatedCost: object.estimatedCostUsd,
    scoreRationale: object.scoreRationale,
    scoreBreakdown: object.scoreBreakdown,
    risks: object.risks,
    constraints: object.constraints,
    assumptions: object.assumptions,
    successCriteria: object.successCriteria,
    recommendedAgents: object.recommendedAgents,
  };

  return { result, llmCostUsd, durationMs: Date.now() - start };
}

/**
 * Format a pre-planning result for display to the human at the decision gate.
 */
export function formatPrePlanningReport(run: PrePlanningRun): string {
  const { result, llmCostUsd, durationMs } = run;
  const bar = "█".repeat(Math.round(result.complexityScore / 5)).padEnd(20, "░");

  const lines: string[] = [
    `━━━ Pre-Planning Report ━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    result.isTaskCoherent
      ? `Task quality: coherent`
      : `Task quality: needs clarification — ${result.coherenceNotes}`,
    `Complexity: ${bar} ${result.complexityScore}/100 (${result.complexityLevel})`,
    `Estimated:  ${result.estimatedHours}h  ~$${result.estimatedCost.toFixed(2)}`,
    `Pre-planning cost: $${llmCostUsd.toFixed(4)}  (${durationMs}ms)`,
    ``,
    result.requiresPlanning
      ? `⚠  PLANNING REQUIRED — complexity too high to skip safely`
      : result.recommendsPlanning
      ? `→  Planning recommended — but you can skip if you know the domain`
      : `✓  Skip planning — straightforward task`,
    ``,
  ];

  if (result.scoreRationale) {
    lines.push(`Why this score:`);
    lines.push(`  ${result.scoreRationale}`);
    lines.push(``);
  }

  if (result.scoreBreakdown.length > 0) {
    lines.push(`Score breakdown:`);
    for (const factor of result.scoreBreakdown) {
      lines.push(`  [${factor.score}] ${factor.description}`);
      lines.push(`         → ${factor.rationale}`);
    }
    lines.push(``);
  }

  if (result.risks.length > 0) {
    lines.push(`Risks:`);
    for (const r of result.risks) {
      lines.push(`  [${r.severity.toUpperCase()}] ${r.description}`);
      lines.push(`         → ${r.mitigation}`);
    }
    lines.push(``);
  }

  if (result.successCriteria.length > 0) {
    lines.push(`Success criteria:`);
    for (const c of result.successCriteria) lines.push(`  • ${c}`);
    lines.push(``);
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  return lines.join("\n");
}
