/**
 * ENHANCED PLANNING PHASE WITH WORK BREAKDOWN STRUCTURE (WBS)
 * 
 * The Planning phase now includes:
 * 1. Specification (what to build)
 * 2. Work Breakdown Structure (how to organize the work)
 * 3. Task Decomposition (break into manageable pieces)
 * 4. Execution Plan (sequence and dependencies)
 * 
 * WBS follows the 8/80 rule: work packages should be 8-80 hours of effort
 */

import { Anthropic } from "@anthropic-ai/sdk";

// ============================================================================
// TYPE DEFINITIONS FOR ENHANCED PLANNING
// ============================================================================

/**
 * Work Breakdown Structure Element
 * Hierarchical decomposition of project scope
 */
interface WBSElement {
  id: string; // e.g., "1", "1.1", "1.1.1"
  level: number; // 1 = top-level deliverable, 3+ = work packages
  title: string;
  description: string;
  
  // Parent-child relationships
  parent_id?: string;
  children_ids: string[];
  
  // At work package level (leaf nodes)
  is_work_package: boolean;
  estimated_hours?: number; // 8-80 hours is ideal
  estimated_cost?: number;
  assigned_agent?: string;
  prerequisites?: string[]; // IDs of work packages that must complete first
  
  // Status tracking
  status: "pending" | "in_progress" | "completed" | "blocked";
  completion_percentage?: number;
  
  // Deliverable
  deliverable?: string; // What this work produces
  success_criteria?: string[];
}

/**
 * Complete WBS for the project
 */
interface WorkBreakdownStructure {
  project_id: string;
  project_name: string;
  
  // The 100% rule: sum of all children = 100% of parent
  total_scope: {
    description: string;
    estimated_hours: number;
    estimated_cost: number;
    level_1_deliverables: string[];
  };
  
  // Hierarchical structure
  elements: WBSElement[];
  
  // Metadata
  created_at: string;
  created_by: string;
  
  // Statistics
  statistics: {
    total_work_packages: number;
    total_estimated_hours: number;
    total_estimated_cost: number;
    parallel_opportunities: number;
    critical_path_hours: number; // Longest sequential path
  };
}

/**
 * Individual Task (Work Package) ready for execution
 */
interface WorkPackageTask {
  task_id: string;
  wbs_id: string; // Reference to WBS element
  
  // Task definition
  title: string;
  description: string;
  deliverable: string;
  
  // Scope
  acceptance_criteria: string[];
  out_of_scope: string[];
  
  // Effort
  estimated_hours: number;
  estimated_cost: number;
  complexity: "trivial" | "simple" | "moderate" | "complex";
  
  // Dependencies
  depends_on: string[]; // task_ids that must complete first
  blocks: string[]; // task_ids that depend on this
  
  // Execution
  assigned_agent?: string;
  assigned_team?: string[];
  start_date?: string;
  due_date?: string;
  
  // Metadata
  priority: "low" | "medium" | "high" | "critical";
  risk_level: "low" | "medium" | "high";
  risks?: {
    risk: string;
    mitigation: string;
  }[];
  
  // Progress
  status: "not_started" | "in_progress" | "completed" | "blocked";
  progress_percentage: number;
  blockers?: string[];
  notes?: string[];
}

/**
 * Execution Plan derived from WBS
 */
interface ExecutionPlan {
  plan_id: string;
  wbs_id: string;
  
  // Phase-based execution
  phases: {
    phase_number: number;
    title: string;
    description: string;
    duration: string;
    
    // Tasks in this phase
    tasks: string[]; // task_ids
    
    // Gates
    entry_criteria: string[];
    exit_criteria: string[];
    deliverables: string[];
    
    // Resources
    required_agents: string[];
    estimated_hours: number;
    estimated_cost: number;
  }[];
  
  // Timeline
  total_duration: string;
  critical_path: {
    tasks: string[];
    total_hours: number;
  };
  
  // Dependencies and constraints
  dependencies: {
    from_task: string;
    to_task: string;
    dependency_type: "finish-to-start" | "start-to-start" | "finish-to-finish";
    lag_days: number;
  }[];
  
  // Resource allocation
  agent_allocations: {
    agent: string;
    capacity_percentage: number;
    assigned_tasks: string[];
    estimated_hours: number;
  }[];
  
  // Risk assessment
  risks: {
    risk: string;
    probability: "low" | "medium" | "high";
    impact: "low" | "medium" | "high";
    mitigation: string;
    owner: string;
  }[];
  
  // Metrics
  metrics: {
    total_tasks: number;
    total_hours: number;
    total_cost: number;
    average_task_size: number;
    parallelization_factor: number; // How many tasks can run in parallel
  };
}

// ============================================================================
// ENHANCED PLANNING ORCHESTRATOR WITH WBS
// ============================================================================

export class EnhancedPlanningOrchestrator {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Create Work Breakdown Structure from specification
   * This decomposes the project into hierarchical deliverables
   */
  async createWBS(specification: {
    problem_statement: string;
    solution_overview: string;
    constraints: string[];
    success_criteria: string[];
  }): Promise<WorkBreakdownStructure> {
    const prompt = `You are a project planner expert in creating Work Breakdown Structures (WBS).

Your task is to create a detailed WBS for this project:

PROBLEM: ${specification.problem_statement}

SOLUTION: ${specification.solution_overview}

CONSTRAINTS:
${specification.constraints.map((c) => `• ${c}`).join("\n")}

SUCCESS CRITERIA:
${specification.success_criteria.map((s) => `• ${s}`).join("\n")}

Create a hierarchical WBS following these rules:

1. **100% Rule**: The sum of all child elements = 100% of parent element
2. **Mutually Exclusive**: No overlapping work between elements
3. **3-4 Levels**: 
   - Level 1: Top-level deliverables (1-3 items)
   - Level 2: Major components (3-8 items each)
   - Level 3: Sub-components (3-8 items each)
   - Level 4: Work packages (8-80 hours each) - LEAF NODES
4. **8/80 Rule**: Work packages should be between 8-80 hours of effort
5. **Assignable**: Each work package can be assigned to one agent

Return as JSON with this structure:
{
  "project_name": "...",
  "level_1_deliverables": [
    {
      "id": "1",
      "title": "...",
      "description": "...",
      "estimated_hours": 0
    }
  ],
  "work_packages": [
    {
      "id": "1.2.3",
      "title": "...",
      "description": "...",
      "deliverable": "What this produces",
      "estimated_hours": 40,
      "estimated_cost": 25.00,
      "parent_id": "1.2",
      "prerequisite_work_packages": ["1.1.1", "1.1.2"]
    }
  ],
  "total_hours": 0,
  "total_cost": 0.00,
  "parallel_opportunities": 0,
  "critical_path_hours": 0
}`;

    const response = await this.client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 5000,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type");
    }

    const wbsData = JSON.parse(content.text);

    // Build hierarchical WBS
    const elements: WBSElement[] = [];

    // Add Level 1 deliverables
    wbsData.level_1_deliverables.forEach(
      (
        deliverable: {
          id: string;
          title: string;
          description: string;
          estimated_hours: number;
        },
        idx: number
      ) => {
        elements.push({
          id: deliverable.id,
          level: 1,
          title: deliverable.title,
          description: deliverable.description,
          children_ids: [],
          is_work_package: false,
          status: "pending",
        });
      }
    );

    // Add work packages (assume they're all at appropriate level)
    wbsData.work_packages.forEach(
      (pkg: {
        id: string;
        title: string;
        description: string;
        deliverable: string;
        estimated_hours: number;
        estimated_cost: number;
        parent_id: string;
        prerequisite_work_packages: string[];
      }) => {
        elements.push({
          id: pkg.id,
          level: pkg.id.split(".").length,
          title: pkg.title,
          description: pkg.description,
          parent_id: pkg.parent_id,
          children_ids: [],
          is_work_package: true,
          estimated_hours: pkg.estimated_hours,
          estimated_cost: pkg.estimated_cost,
          deliverable: pkg.deliverable,
          prerequisites: pkg.prerequisite_work_packages,
          status: "pending",
          completion_percentage: 0,
        });

        // Link parent to child
        const parent = elements.find((e) => e.id === pkg.parent_id);
        if (parent) {
          parent.children_ids.push(pkg.id);
        }
      }
    );

    return {
      project_id: `wbs_${Date.now()}`,
      project_name: wbsData.project_name,
      total_scope: {
        description: specification.solution_overview,
        estimated_hours: wbsData.total_hours,
        estimated_cost: wbsData.total_cost,
        level_1_deliverables: elements
          .filter((e) => e.level === 1)
          .map((e) => e.title),
      },
      elements,
      created_at: new Date().toISOString(),
      created_by: "planning_agent",
      statistics: {
        total_work_packages: elements.filter((e) => e.is_work_package).length,
        total_estimated_hours: wbsData.total_hours,
        total_estimated_cost: wbsData.total_cost,
        parallel_opportunities: wbsData.parallel_opportunities,
        critical_path_hours: wbsData.critical_path_hours,
      },
    };
  }

  /**
   * Convert WBS into executable work packages/tasks
   */
  async createWorkPackageTasks(
    wbs: WorkBreakdownStructure
  ): Promise<WorkPackageTask[]> {
    const prompt = `You are an execution planning expert.

Given this Work Breakdown Structure, create detailed work package tasks.

PROJECT: ${wbs.project_name}

WORK PACKAGES TO DETAIL:
${wbs.elements
  .filter((e) => e.is_work_package)
  .map(
    (pkg) => `
ID: ${pkg.id}
Title: ${pkg.title}
Description: ${pkg.description}
Estimated Hours: ${pkg.estimated_hours}
Deliverable: ${pkg.deliverable}
Prerequisites: ${pkg.prerequisites?.join(", ") || "None"}
`
  )
  .join("\n")}

For EACH work package, create a task with:
1. Clear acceptance criteria (how we know it's done)
2. Out of scope (what's NOT included)
3. Complexity assessment
4. Risk assessment
5. Dependencies (which tasks must finish first)

Return as JSON array of tasks:
[
  {
    "wbs_id": "1.2.3",
    "title": "...",
    "description": "...",
    "deliverable": "...",
    "acceptance_criteria": ["...", "..."],
    "out_of_scope": ["..."],
    "estimated_hours": 40,
    "complexity": "moderate",
    "priority": "high",
    "risk_level": "medium",
    "risks": [{ "risk": "...", "mitigation": "..." }],
    "depends_on": ["1.2.1", "1.2.2"],
    "blocks": ["1.3.1"]
  }
]`;

    const response = await this.client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type");
    }

    const tasksData = JSON.parse(content.text);

    return tasksData.map(
      (
        task: {
          wbs_id: string;
          title: string;
          description: string;
          deliverable: string;
          acceptance_criteria: string[];
          out_of_scope: string[];
          estimated_hours: number;
          complexity: string;
          priority: string;
          risk_level: string;
          risks: { risk: string; mitigation: string }[];
          depends_on: string[];
          blocks: string[];
        },
        idx: number
      ): WorkPackageTask => ({
        task_id: `task_${Date.now()}_${idx}`,
        wbs_id: task.wbs_id,
        title: task.title,
        description: task.description,
        deliverable: task.deliverable,
        acceptance_criteria: task.acceptance_criteria,
        out_of_scope: task.out_of_scope,
        estimated_hours: task.estimated_hours,
        estimated_cost: task.estimated_hours * 0.625, // Approximate cost per hour
        complexity: task.complexity as
          | "trivial"
          | "simple"
          | "moderate"
          | "complex",
        depends_on: task.depends_on,
        blocks: task.blocks,
        priority: task.priority as "low" | "medium" | "high" | "critical",
        risk_level: task.risk_level as "low" | "medium" | "high",
        risks: task.risks,
        status: "not_started",
        progress_percentage: 0,
      })
    );
  }

  /**
   * Create execution plan from WBS and work packages
   */
  async createExecutionPlan(
    wbs: WorkBreakdownStructure,
    tasks: WorkPackageTask[]
  ): Promise<ExecutionPlan> {
    const prompt = `You are a project execution planner.

Create an execution plan that phases the work in an efficient sequence.

TOTAL WORK: ${wbs.statistics.total_estimated_hours} hours
WORK PACKAGES: ${wbs.statistics.total_work_packages}
CRITICAL PATH: ${wbs.statistics.critical_path_hours} hours
PARALLELIZATION FACTOR: ${wbs.statistics.parallel_opportunities}

TASKS TO SEQUENCE:
${tasks
  .map(
    (t) => `
Task: ${t.title}
Duration: ${t.estimated_hours} hours
Dependencies: ${t.depends_on.join(", ") || "None"}
Can be parallel: ${!t.depends_on || t.depends_on.length === 0}
`
  )
  .join("\n")}

Create phases that:
1. Respect dependencies
2. Maximize parallelization
3. Keep phases to 1-2 weeks each
4. Have clear entry/exit criteria
5. Include gate reviews

Return as JSON:
{
  "phases": [
    {
      "phase_number": 1,
      "title": "...",
      "description": "...",
      "duration": "1-2 weeks",
      "tasks": ["task_id_1", "task_id_2"],
      "entry_criteria": ["...", "..."],
      "exit_criteria": ["..."],
      "deliverables": ["..."],
      "required_agents": ["coder", "tester"],
      "estimated_hours": 80,
      "estimated_cost": 50.00
    }
  ],
  "total_duration": "4-5 weeks",
  "critical_path": {
    "tasks": ["task_id_1", "task_id_2"],
    "total_hours": 120
  },
  "dependencies": [
    {
      "from_task": "task_id_1",
      "to_task": "task_id_2",
      "dependency_type": "finish-to-start",
      "lag_days": 0
    }
  ]
}`;

    const response = await this.client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type");
    }

    const planData = JSON.parse(content.text);

    return {
      plan_id: `plan_${Date.now()}`,
      wbs_id: wbs.project_id,
      phases: planData.phases,
      total_duration: planData.total_duration,
      critical_path: planData.critical_path,
      dependencies: planData.dependencies,
      agent_allocations: [], // Populated from task assignments
      risks: [], // From individual tasks
      metrics: {
        total_tasks: tasks.length,
        total_hours: wbs.statistics.total_estimated_hours,
        total_cost: wbs.statistics.total_estimated_cost,
        average_task_size: Math.round(
          wbs.statistics.total_estimated_hours / tasks.length
        ),
        parallelization_factor: wbs.statistics.parallel_opportunities,
      },
    };
  }

  /**
   * Generate human-readable planning document
   */
  generatePlanningDocument(
    wbs: WorkBreakdownStructure,
    tasks: WorkPackageTask[],
    executionPlan: ExecutionPlan
  ): string {
    return `
╔════════════════════════════════════════════════════════════════╗
║                  PROJECT EXECUTION PLAN                        ║
║              (Work Breakdown Structure + Task Details)         ║
╚════════════════════════════════════════════════════════════════╝

📋 PROJECT OVERVIEW
${wbs.project_name}
Total Scope: ${wbs.statistics.total_estimated_hours} hours
Total Cost: $${wbs.statistics.total_estimated_cost.toFixed(2)}

────────────────────────────────────────────────────────────────

🏗️  WORK BREAKDOWN STRUCTURE

Level 1 Deliverables:
${wbs.elements
  .filter((e) => e.level === 1)
  .map(
    (e) => `
  ${e.id}. ${e.title}
     ${e.description}
     Children: ${e.children_ids.length}
`
  )
  .join("\n")}

Work Packages (${wbs.statistics.total_work_packages} total):
${wbs.elements
  .filter((e) => e.is_work_package)
  .map(
    (e) => `
  ${e.id}. ${e.title}
     Deliverable: ${e.deliverable}
     Estimate: ${e.estimated_hours} hours
     Cost: $${e.estimated_cost?.toFixed(2)}
     Prerequisites: ${e.prerequisites?.join(", ") || "None"}
`
  )
  .join("\n")}

────────────────────────────────────────────────────────────────

📋 EXECUTION TASKS (Detailed)

${tasks
  .map(
    (task) => `
TASK: ${task.title} (${task.task_id})
───────────────────────────────────────
Description: ${task.description}
Deliverable: ${task.deliverable}

📊 EFFORT
  Estimated: ${task.estimated_hours} hours
  Cost: $${task.estimated_cost?.toFixed(2)}
  Complexity: ${task.complexity}

✅ ACCEPTANCE CRITERIA
${task.acceptance_criteria.map((c) => `  • ${c}`).join("\n")}

❌ OUT OF SCOPE
${task.out_of_scope.map((o) => `  • ${o}`).join("\n")}

🔗 DEPENDENCIES
  Depends On: ${task.depends_on.join(", ") || "None"}
  Blocks: ${task.blocks.join(", ") || "None"}

⚠️  RISK
  Level: ${task.risk_level}
${
  task.risks
    ? task.risks
        .map(
          (r) => `
  Risk: ${r.risk}
  Mitigation: ${r.mitigation}`
        )
        .join("\n")
    : "  No identified risks"
}

📌 PRIORITY: ${task.priority}
`
  )
  .join("\n")}

────────────────────────────────────────────────────────────────

📅 EXECUTION PHASES

${executionPlan.phases
  .map(
    (phase) => `
PHASE ${phase.phase_number}: ${phase.title} (${phase.duration})
──────────────────────────────────────────────
${phase.description}

📌 Entry Criteria:
${phase.entry_criteria.map((c) => `  ✓ ${c}`).join("\n")}

📋 Tasks in this Phase: ${phase.tasks.length}
${phase.tasks.map((t) => `  • ${t}`).join("\n")}

📤 Deliverables:
${phase.deliverables.map((d) => `  ✓ ${d}`).join("\n")}

🤖 Required Agents: ${phase.required_agents.join(", ")}
⏱️  Estimated: ${phase.estimated_hours} hours
💰 Estimated Cost: $${phase.estimated_cost.toFixed(2)}

✅ Exit Criteria:
${phase.exit_criteria.map((c) => `  ✓ ${c}`).join("\n")}
`
  )
  .join("\n")}

────────────────────────────────────────────────────────────────

⏱️  TIMELINE & DEPENDENCIES

Total Duration: ${executionPlan.total_duration}
Critical Path: ${executionPlan.critical_path.tasks.join(" → ")} (${executionPlan.critical_path.total_hours} hours)

Dependencies:
${executionPlan.dependencies
  .map(
    (d) =>
      `  ${d.from_task} ──[${d.dependency_type}]──> ${d.to_task}`
  )
  .join("\n")}

────────────────────────────────────────────────────────────────

📊 METRICS

Total Tasks: ${executionPlan.metrics.total_tasks}
Total Effort: ${executionPlan.metrics.total_hours} hours
Average Task Size: ${executionPlan.metrics.average_task_size} hours
Parallelization Opportunities: ${executionPlan.metrics.parallelization_factor}

This means:
• If executed sequentially: ${executionPlan.metrics.total_hours} hours
• With maximum parallelization: ~${Math.ceil(executionPlan.metrics.total_hours / executionPlan.metrics.parallelization_factor)} hours

════════════════════════════════════════════════════════════════

✅ READY FOR EXECUTION

This plan is now ready to be passed to the Development phase.
Each task can be assigned to an agent with clear scope and success
criteria. The execution plan ensures dependencies are respected and
work is properly sequenced.

All work is traceable back to WBS elements and to the original
specification, ensuring 100% scope coverage.
`;
  }
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable not set");
  }

  const planner = new EnhancedPlanningOrchestrator(apiKey);

  // Example specification from pre-planning
  const specification = {
    problem_statement:
      "Build a user authentication system with JWT tokens and refresh token rotation",
    solution_overview:
      "Implement secure authentication endpoints, token management, and session handling",
    constraints: [
      "Must support 10K concurrent users",
      "Maximum 100ms auth latency",
      "Must support OAuth2 for external IDPs",
    ],
    success_criteria: [
      "All auth endpoints tested and passing",
      "Token refresh works seamlessly",
      "Security audit passes",
      "Documentation complete",
    ],
  };

  try {
    console.log("📐 PHASE 1: PLANNING - Creating Work Breakdown Structure\n");

    // Step 1: Create WBS
    const wbs = await planner.createWBS(specification);
    console.log(`✅ WBS Created with ${wbs.statistics.total_work_packages} work packages`);
    console.log(`   Total Effort: ${wbs.statistics.total_estimated_hours} hours`);
    console.log(
      `   Parallelization: ${wbs.statistics.parallel_opportunities} opportunities\n`
    );

    // Step 2: Create work package tasks
    const tasks = await planner.createWorkPackageTasks(wbs);
    console.log(`✅ Created ${tasks.length} detailed work package tasks\n`);

    // Step 3: Create execution plan
    const executionPlan = await planner.createExecutionPlan(wbs, tasks);
    console.log(`✅ Execution plan created with ${executionPlan.phases.length} phases\n`);

    // Step 4: Generate planning document
    const planningDoc = planner.generatePlanningDocument(wbs, tasks, executionPlan);
    console.log(planningDoc);

    // Save outputs
    const fs = require("fs");
    fs.writeFileSync(`wbs_${wbs.project_id}.json`, JSON.stringify(wbs, null, 2));
    fs.writeFileSync(`tasks_${wbs.project_id}.json`, JSON.stringify(tasks, null, 2));
    fs.writeFileSync(`plan_${wbs.project_id}.json`, JSON.stringify(executionPlan, null, 2));

    console.log("\n📁 FILES GENERATED:");
    console.log(`  • wbs_${wbs.project_id}.json - WBS hierarchy`);
    console.log(`  • tasks_${wbs.project_id}.json - Work package tasks`);
    console.log(`  • plan_${wbs.project_id}.json - Execution plan`);
  } catch (error) {
    console.error("Planning failed:", error);
    process.exit(1);
  }
}

main().catch(console.error);
