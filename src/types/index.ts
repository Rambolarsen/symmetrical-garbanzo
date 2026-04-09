import type { z } from "zod";

// ---------------------------------------------------------------------------
// Provider types
// ---------------------------------------------------------------------------

export type ProviderName = "anthropic" | "openai" | "google" | "ollama";

export interface ModelRef {
  provider: ProviderName;
  model: string;
}

// ---------------------------------------------------------------------------
// Tool definition (provider-agnostic)
// ---------------------------------------------------------------------------

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  execute: (input: TInput) => Promise<TOutput>;
}

// ---------------------------------------------------------------------------
// Agent types
// ---------------------------------------------------------------------------

export type AgentKind =
  | "llm"          // Vercel AI SDK — any provider
  | "claude-code"; // @anthropic-ai/claude-agent-sdk

export interface AgentRole {
  name: string;        // e.g. "researcher", "coder", "analyst"
  instructions: string;
}

// ---------------------------------------------------------------------------
// Orchestration phases
// ---------------------------------------------------------------------------

export type PhaseStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";

export interface PrePlanningResult {
  scopeId: string;
  isTaskCoherent: boolean;
  coherenceNotes: string;
  complexityScore: number;        // 0-100
  complexityLevel: "trivial" | "simple" | "moderate" | "complex" | "enterprise";
  requiresPlanning: boolean;
  recommendsPlanning: boolean;
  estimatedHours: number;
  estimatedCost: number;
  scoreRationale: string;
  scoreBreakdown: ScoreFactor[];
  risks: Risk[];
  constraints: string[];
  assumptions: string[];
  successCriteria: string[];
  recommendedAgents: AgentRole[];
}

export interface Risk {
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  mitigation: string;
}

export interface ScoreFactor {
  description: string;
  score: number;
  rationale: string;
}

export interface WBSElement {
  id: string;                      // e.g. "1", "1.1", "1.2.3"
  level: number;
  title: string;
  description: string;
  parentId?: string;
  childrenIds: string[];
  isWorkPackage: boolean;
  estimatedHours?: number;         // 8-80 per the 8/80 rule
  estimatedCost?: number;
  assignedAgent?: AgentRole;
  prerequisites: string[];         // WBS element IDs
  status: PhaseStatus;
  deliverable?: string;
  successCriteria: string[];
}

export interface WorkBreakdownStructure {
  projectId: string;
  totalEstimatedHours: number;
  totalEstimatedCost: number;
  elements: WBSElement[];
  criticalPathHours: number;
  parallelOpportunities: number;
}

export interface PlanningResult {
  specification: string;
  wbs: WorkBreakdownStructure;
  executionPlan: ExecutionPhase[];
}

export interface ExecutionPhase {
  phaseNumber: number;
  name: string;
  workPackageIds: string[];        // WBS element IDs to execute in this phase
  canParallelize: boolean;
}

// ---------------------------------------------------------------------------
// Human gate decisions
// ---------------------------------------------------------------------------

export type GateDecision =
  | { action: "approve" }
  | { action: "approve_with_changes"; changes: string }
  | { action: "skip_planning" }
  | { action: "cancel"; feedback: string };

// ---------------------------------------------------------------------------
// Checkpoint / state
// ---------------------------------------------------------------------------

export interface Checkpoint {
  id: string;
  createdAt: string;
  phase: "pre-planning" | "planning" | "development" | "validation";
  prePlanningResult?: PrePlanningResult;
  planningResult?: PlanningResult;
  completedWorkPackages: string[];
  totalCostActual: number;
  totalCostEstimated: number;
}

// ---------------------------------------------------------------------------
// SSE execution streaming
// ---------------------------------------------------------------------------

export type ExecutionStreamEvent =
  | { type: "progress"; message: string; timestamp: string }
  | { type: "tool_call"; toolName: string; inputPreview: string; timestamp: string }
  | { type: "clarification_needed"; requestId: string; question: string; context: string; options?: string[] }
  | { type: "complete"; output: string; cost: number; durationMs: number }
  | { type: "error"; message: string };

export interface ClarificationRequest {
  requestId: string;
  question: string;
  context: string;
  options?: string[];
}

export interface ExecutionResult {
  output: string;
  cost: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface CriterionCheck {
  criterion: string;
  passed: boolean;
  evidence: string;     // what the agent found (or didn't)
  confidence: number;   // 0–1
}

export interface VerificationResult {
  overallPassed: boolean;
  criteriaChecks: CriterionCheck[];
  summary: string;
  recommendations?: string[];
}
