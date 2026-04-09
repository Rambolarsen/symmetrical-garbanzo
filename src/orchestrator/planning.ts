import { generateObject } from "ai";
import { z } from "zod";
import { resolveModel, MODELS } from "../agents/providers/index.js";
import type { PlanningResult, PrePlanningResult, ModelRef, WBSElement, WorkBreakdownStructure, ExecutionPhase } from "../types/index.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const AgentSchema = z.object({
  name: z.string(),
  instructions: z.string(),
});

const ElementSchema = z.object({
  id: z.string(),
  level: z.number().int().min(1).max(4),
  title: z.string(),
  description: z.string(),
  parentId: z.string().nullable(),
  childrenIds: z.array(z.string()),
  isWorkPackage: z.boolean(),
  estimatedHours: z.number().nullable(),
  assignedAgent: AgentSchema.nullable(),
  prerequisites: z.array(z.string()),
  deliverable: z.string().nullable(),
  successCriteria: z.array(z.string()),
});

const PlanningSchema = z.object({
  specification: z.string(),
  elements: z.array(ElementSchema),
  executionPhases: z.array(z.object({
    phaseNumber: z.number().int(),
    name: z.string(),
    workPackageIds: z.array(z.string()),
    canParallelize: z.boolean(),
  })),
});

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const PLANNER_SYSTEM = `You are a project planning agent. Decompose the given task into a Work Breakdown Structure (WBS).

Rules:
- 100% Rule: children hours must sum to parent hours exactly
- 8/80 Rule: work packages (leaf nodes) must be 8–80 hours each
- Max 4 levels of hierarchy
- Each work package needs: deliverable, successCriteria, assignedAgent, prerequisites
- Prerequisites reference other element IDs ("1.1.1", "2.3", etc.)
- Group work packages into sequential execution phases respecting dependencies
- Parallel tasks within a phase are fine (canParallelize: true)

Work package quality bar:
- description must explain the exact file/class/function being changed and why
- assignedAgent.instructions must be step-by-step actions an agent can execute directly
- deliverable must name the exact file(s) changed or created
- successCriteria must be concrete and observable

Specification quality bar:
- the specification field is an implementation brief for the coding agent, not a stakeholder summary
- name exact files, classes, functions, endpoints, schemas, and tests to change or create
- describe the implementation sequence concretely: what to edit first, what logic to add, and how the pieces fit together
- call out dependency order and any prerequisite work
- include validation guidance: what to test, run, or manually verify afterward
- avoid vague phrases like "update the relevant component" or "make necessary changes"

Use the pre-planning context (risks, constraints, recommendedAgents) to inform agent assignments.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function estimateCost(hours: number): number {
  // Sonnet pricing: ~$0.625/agent-hour
  return hours * 0.625;
}

function computeCriticalPath(elements: WBSElement[]): number {
  const byId = new Map(elements.map(e => [e.id, e]));
  const memo = new Map<string, number>();

  function longest(id: string): number {
    if (memo.has(id)) return memo.get(id)!;
    const el = byId.get(id);
    if (!el) return 0;
    const selfHours = el.isWorkPackage ? (el.estimatedHours ?? 0) : 0;
    const prereqMax = el.prerequisites.length > 0
      ? Math.max(...el.prerequisites.map(longest))
      : 0;
    const result = selfHours + prereqMax;
    memo.set(id, result);
    return result;
  }

  const workPackages = elements.filter(e => e.isWorkPackage);
  return workPackages.length > 0 ? Math.max(...workPackages.map(e => longest(e.id))) : 0;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface PlanningOptions {
  model?: ModelRef;
}

export interface PlanningRun {
  result: PlanningResult;
  cost: number;
  durationMs: number;
}

/**
 * Phase 1: Planning
 *
 * Decomposes a task into a Work Breakdown Structure following the 8/80 rule.
 * Optionally takes a PrePlanningResult from Phase 0 as context.
 *
 * Uses the balanced model by default (Sonnet) for higher-quality decomposition.
 */
export async function runPlanning(
  task: string,
  prePlanning?: PrePlanningResult,
  options: PlanningOptions = {}
): Promise<PlanningRun> {
  const { model = MODELS.balanced } = options;

  const prompt = buildPrompt(task, prePlanning);
  const start = Date.now();

  const { object, usage } = await generateObject({
    model: resolveModel(model),
    system: PLANNER_SYSTEM,
    prompt,
    schema: PlanningSchema,
  });

  // Sonnet pricing: $3/M input, $15/M output
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const llmCost = ((inputTokens / 1_000_000) * 3) + ((outputTokens / 1_000_000) * 15);

  const scopeId = prePlanning?.scopeId ?? `scope_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const elements: WBSElement[] = object.elements.map(e => ({
    id: e.id,
    level: e.level,
    title: e.title,
    description: e.description,
    parentId: e.parentId ?? undefined,
    childrenIds: e.childrenIds,
    isWorkPackage: e.isWorkPackage,
    estimatedHours: e.estimatedHours ?? undefined,
    estimatedCost: e.estimatedHours != null ? estimateCost(e.estimatedHours) : undefined,
    assignedAgent: e.assignedAgent ?? undefined,
    prerequisites: e.prerequisites,
    status: "pending" as const,
    deliverable: e.deliverable ?? undefined,
    successCriteria: e.successCriteria,
  }));

  const workPackages = elements.filter(e => e.isWorkPackage);
  const totalHours = workPackages.reduce((s, e) => s + (e.estimatedHours ?? 0), 0);
  const totalCost = workPackages.reduce((s, e) => s + (e.estimatedCost ?? 0), 0);
  const criticalPathHours = computeCriticalPath(elements);

  const wbs: WorkBreakdownStructure = {
    projectId: scopeId,
    totalEstimatedHours: totalHours,
    totalEstimatedCost: totalCost,
    elements,
    criticalPathHours,
    parallelOpportunities: Math.max(0, workPackages.length - object.executionPhases.length),
  };

  const executionPlan: ExecutionPhase[] = object.executionPhases.map(p => ({
    phaseNumber: p.phaseNumber,
    name: p.name,
    workPackageIds: p.workPackageIds,
    canParallelize: p.canParallelize,
  }));

  const result: PlanningResult = {
    specification: object.specification,
    wbs,
    executionPlan,
  };

  return { result, cost: llmCost, durationMs: Date.now() - start };
}

/**
 * Format a planning result for display to the human at the decision gate.
 */
export function formatPlanningReport(run: PlanningRun): string {
  const { result, cost, durationMs } = run;
  const { wbs, executionPlan } = result;
  const workPackages = wbs.elements.filter(e => e.isWorkPackage);

  const lines: string[] = [
    `━━━ Planning Report ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Specification: ${result.specification}`,
    ``,
    `Work packages:  ${workPackages.length}`,
    `Total hours:    ${wbs.totalEstimatedHours.toFixed(0)}h`,
    `Critical path:  ${wbs.criticalPathHours.toFixed(0)}h`,
    `Parallel saves: ~${(wbs.totalEstimatedHours - wbs.criticalPathHours).toFixed(0)}h`,
    `Est. cost:      ~$${wbs.totalEstimatedCost.toFixed(2)}`,
    `Planning cost:  $${cost.toFixed(4)}  (${durationMs}ms)`,
    ``,
  ];

  for (const phase of executionPlan) {
    lines.push(`Phase ${phase.phaseNumber}: ${phase.name}${phase.canParallelize ? " (parallelizable)" : ""}`);
    for (const id of phase.workPackageIds) {
      const el = wbs.elements.find(e => e.id === id);
      if (el) lines.push(`  ${id.padEnd(8)} ${el.title}  (${el.estimatedHours}h)`);
    }
    lines.push(``);
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function buildPrompt(task: string, pre?: PrePlanningResult): string {
  if (!pre) return `Task: ${task}`;

  const lines = [
    `Task: ${task}`,
    ``,
    `Pre-planning context:`,
    `  Complexity: ${pre.complexityScore}/100 (${pre.complexityLevel})`,
    `  Estimated hours: ${pre.estimatedHours}h`,
  ];

  if (pre.constraints.length > 0) {
    lines.push(`  Constraints:`);
    pre.constraints.forEach(c => lines.push(`    - ${c}`));
  }

  if (pre.risks.length > 0) {
    lines.push(`  Risks:`);
    pre.risks.forEach(r => lines.push(`    - [${r.severity}] ${r.description}`));
  }

  if (pre.recommendedAgents.length > 0) {
    lines.push(`  Recommended agents:`);
    pre.recommendedAgents.forEach(a => lines.push(`    - ${a.name}: ${a.instructions}`));
  }

  return lines.join("\n");
}
