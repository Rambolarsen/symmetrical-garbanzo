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
// Model capabilities & catalog
// ---------------------------------------------------------------------------

export interface ModelCapabilities {
  contextWindow: number;        // max input tokens
  maxOutputTokens: number;
  supportsToolUse: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  costPerInputToken: number;    // USD per token, 0 for local
  costPerOutputToken: number;   // USD per token, 0 for local
  isLocal: boolean;             // true for Ollama-backed models
  minComplexityScore?: number;  // reject tasks below this (optional floor)
  maxComplexityScore?: number;  // reject tasks above this (optional ceiling)
}

export interface ModelEntry extends ModelRef {
  instanceId: string;        // matches ProviderConfig.id — e.g. "anthropic", "ollama-local", "ollama-remote"
  capabilities: ModelCapabilities;
  displayName: string;
}

/**
 * Who is consuming the model call.
 * Drives dynamic adapter selection for Ollama — Claude Code requires
 * the Anthropic wire protocol; everything else uses OpenAI.
 */
export type ConsumerType = "general" | "claude-code" | "opencode" | "codex";

/**
 * Resolves which wire protocol to use for a given model entry and consumer.
 * For non-Ollama providers this is trivially the provider name.
 * For Ollama it depends on the consumer — Claude Code needs the Anthropic surface.
 */
export function resolveAdapter(
  entry: ModelEntry,
  consumer: ConsumerType
): "openai" | "anthropic" | "google" {
  if (entry.provider !== "ollama") {
    return entry.provider as "openai" | "anthropic" | "google";
  }

  // Rule: only Claude Code requires the Anthropic wire protocol.
  // opencode and codex are OpenAI-compatible by design.
  // All other consumers default to openai.
  return consumer === "claude-code" ? "anthropic" : "openai";
}

// For passing Ollama instance config to the discovery function
export interface OllamaInstanceConfig {
  instanceId: string;   // matches ProviderConfig.id
  baseUrl: string;
  priority: number;
  // No adapter field — adapter is resolved dynamically per ConsumerType
}

// ---------------------------------------------------------------------------
// Provider config (user-defined provider entries)
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  id: string;                    // uuid — used as instanceId in ModelEntry and DI key
  name: string;                  // display name, e.g. "Local Ollama", "Remote GPU Box"
  provider: ProviderName;        // "anthropic" | "openai" | "google" | "ollama"
  baseUrl?: string;              // override default endpoint
  apiKey?: string;               // stored encrypted in DB, never in code
  isLocal: boolean;
  enabled: boolean;
  priority: number;              // lower = higher priority within same provider type
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export type ModelTier = "fast" | "balanced" | "powerful";

export interface RoutingContext {
  complexityScore: number;
  requiresToolUse?: boolean;
  requiresVision?: boolean;
  estimatedInputTokens?: number;
  preferLocal?: boolean;
  excludeInstances?: string[];   // instanceIds already tried — prevents retry loops
  consumer?: ConsumerType;       // drives adapter selection for Ollama; defaults to "general"
  minTier?: ModelTier;           // floor — routing will never return a tier below this
}

/** Used internally by resolveModelForTask() to enforce minTier. */
export const TIER_RANK: Record<ModelTier, number> = {
  fast:     0,
  balanced: 1,
  powerful: 2,
};

// ---------------------------------------------------------------------------
// Cost tracking
// ---------------------------------------------------------------------------

export interface ProviderCallRecord {
  id: string;
  timestamp: Date;
  workPackageId?: string;
  phaseId?: string;
  instanceId: string;      // which specific instance handled this call
  provider: ProviderName;
  model: string;
  tier: ModelTier;
  consumer: ConsumerType;  // recorded for auditability
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  wasEscalated: boolean;   // true if a previous instance was tried and failed
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
