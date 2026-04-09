// ---------------------------------------------------------------------------
// Kanban columns
// ---------------------------------------------------------------------------

export type ColumnId =
  | 'backlog'
  | 'pre-planning'
  | 'planning'
  | 'in-development'
  | 'verification'
  | 'done';

export const COLUMNS: { id: ColumnId; label: string; accent: string; headerBg: string }[] = [
  { id: 'backlog',        label: 'Backlog',          accent: 'border-slate-500',  headerBg: 'bg-slate-700'  },
  { id: 'pre-planning',   label: 'Pre-Planning',     accent: 'border-blue-500',   headerBg: 'bg-blue-900'   },
  { id: 'planning',       label: 'Planning',         accent: 'border-purple-500', headerBg: 'bg-purple-900' },
  { id: 'in-development', label: 'In Development',   accent: 'border-green-500',  headerBg: 'bg-green-900'  },
  { id: 'verification',   label: 'Verification',     accent: 'border-teal-500',   headerBg: 'bg-teal-900'   },
  { id: 'done',           label: 'Done',             accent: 'border-slate-400',  headerBg: 'bg-slate-600'  },
];

// ---------------------------------------------------------------------------
// Project context
// ---------------------------------------------------------------------------

export interface ProjectContext {
  name: string
  source: string           // GitHub URL or absolute local path
  githubToken?: string     // PAT for private repos
  generatedContext: string // extracted context string, ready to pass to AI
}

// ---------------------------------------------------------------------------
// API response types (mirrors Maestroid.Core / src/types)
// ---------------------------------------------------------------------------

export interface Risk {
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mitigation: string;
}

export interface AgentRole {
  name: string;
  instructions: string;
}

export interface ScoreFactor {
  description: string;
  score: number;
  rationale: string;
}

export interface PrePlanningResult {
  scopeId: string;
  isTaskCoherent: boolean;
  coherenceNotes: string;
  complexityScore: number;
  complexityLevel: 'trivial' | 'simple' | 'moderate' | 'complex' | 'enterprise';
  requiresPlanning: boolean;
  recommendsPlanning: boolean;
  estimatedHours: number;
  estimatedCost: number;
  scoreRationale: string;
  specification: string;
  scoreBreakdown: ScoreFactor[];
  risks: Risk[];
  constraints: string[];
  assumptions: string[];
  successCriteria: string[];
  recommendedAgents: AgentRole[];
}

export interface WBSElement {
  id: string;
  level: number;
  title: string;
  description: string;
  parentId?: string;
  childrenIds: string[];
  isWorkPackage: boolean;
  estimatedHours?: number;
  estimatedCost?: number;
  assignedAgent?: AgentRole;
  prerequisites: string[];
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

export interface ExecutionPhase {
  phaseNumber: number;
  name: string;
  workPackageIds: string[];
  canParallelize: boolean;
}

export interface PlanningResult {
  scopeId: string;
  specification: string;
  wbs: WorkBreakdownStructure;
  executionPlan: ExecutionPhase[];
}

// ---------------------------------------------------------------------------
// SSE execution streaming
// ---------------------------------------------------------------------------

export type ExecutionStreamEvent =
  | { type: 'progress'; message: string; timestamp: string }
  | { type: 'tool_call'; toolName: string; inputPreview: string; timestamp: string }
  | { type: 'clarification_needed'; requestId: string; question: string; context: string; options?: string[] }
  | { type: 'complete'; output: string; cost: number; durationMs: number }
  | { type: 'error'; message: string }

export interface ClarificationRequest {
  requestId: string;
  question: string;
  context: string;
  options?: string[];
}

export interface CriterionCheck {
  criterion: string;
  passed: boolean;
  evidence: string;
  confidence: number; // 0–1
}

export interface VerificationResult {
  overallPassed: boolean;
  criteriaChecks: CriterionCheck[];
  summary: string;
  recommendations?: string[];
}

// ---------------------------------------------------------------------------
// Kanban task state
// ---------------------------------------------------------------------------

export interface Task {
  id: string;
  title: string;
  spec: string;                          // living markdown document (starts as user prompt)
  parentId?: string;                     // set on promoted work package cards
  derivedFromId?: string;                // set when a child is split to a standalone task
  column: ColumnId;
  loading: boolean;
  error?: string;
  prePlanningResult?: PrePlanningResult;
  planningResult?: PlanningResult;
  executionOutput?: string;              // accumulated SSE stream text
  pendingClarification?: ClarificationRequest;
  verificationResult?: VerificationResult;
  createdAt: string;
}
