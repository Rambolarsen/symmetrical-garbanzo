# Chat 3: Planning Phase with Work Breakdown Structure (WBS)

## Purpose
Design how to decompose complex work into clear, manageable, executable tasks that development agents can work on autonomously.

## Context from Previous Chats
- Pre-planning identified complexity level
- Decision gate determined if planning is needed
- Now: IF planning phase executes, how does it structure work?

## The Problem We're Solving

**Without task decomposition**:
```
Development: "Build authentication system"
Problem: ❌ Vague, 200+ hours, scope creep, budget overruns
```

**With WBS task decomposition**:
```
Development receives:
✅ 40 clear work packages (8-80 hours each)
✅ Each has: acceptance criteria, deliverable, estimate
✅ Dependencies tracked: task A blocks task B
✅ Parallel opportunities identified
✅ Progress tracked: 8/40 done = 20%
✅ Budget controlled: $X actual vs. $X estimated
```

## Work Breakdown Structure (WBS) Principles

### The 100% Rule
**Sum of all children = 100% of parent. No more, no less.**

Example:
```
Authentication System (TOTAL: 144 hours)
├─ 1. Core Authentication (84 hours)
│  ├─ 1.1 Database Schema (24 hours)
│  ├─ 1.2 JWT Implementation (36 hours)
│  └─ 1.3 Login Endpoint (24 hours) ✓ = 84
├─ 2. Token Refresh (28 hours)
│  ├─ 2.1 Redis Setup (12 hours)
│  └─ 2.2 Refresh Endpoint (16 hours) ✓ = 28
└─ 3. Security & Testing (32 hours)
   ├─ 3.1 Security Review (8 hours)
   └─ 3.2 Integration Tests (24 hours) ✓ = 32
                                       TOTAL = 144 ✓
```

Why this matters:
- **No forgotten work**: If the math doesn't add up, something is missing
- **Scope control**: Can't add features without changing the structure
- **Budget accuracy**: Actual cost should match WBS

### The 8/80 Rule
**Work packages should be 8-80 hours of effort.**

Why?
```
4 hours
├─ Too small ❌
├─ Can't estimate accurately
├─ Management overhead > actual work
└─ Example: "Write unit test for JWT function"

16 hours
├─ Perfect ✓
├─ One person can own it
├─ Can be estimated accurately
├─ Takes 2-5 working days
└─ Example: "Design user database schema"

120 hours
├─ Too big ❌
├─ Hard to track progress
├─ Scope creep within the task
├─ Hard to estimate accurately
└─ Example: "Build entire payment system"
```

## WBS Hierarchy (4 Levels)

```
LEVEL 1: Top-level deliverables (1-3 items)
├─ Authentication System
├─ Payment Processing
└─ Admin Dashboard

LEVEL 2: Major components (3-8 items each)
├─ Core Authentication
├─ Token Refresh
└─ Security & Testing

LEVEL 3: Sub-components (3-8 items each)
├─ User Database Schema
├─ JWT Implementation
└─ Login Endpoint

LEVEL 4: Work packages (LEAF NODES - 8-80 hours)
├─ Design user table (16 hours) ← Assignable to one agent
├─ Implement JWT generation (20 hours) ← Assignable to one agent
└─ Build POST /login endpoint (24 hours) ← Assignable to one agent
```

## Work Package Task Definition

### What Each Task Contains

```json
{
  "task_id": "task_auth_001",
  "wbs_id": "1.2.1",
  "title": "Implement JWT Token Generation",
  
  "deliverable": "generateToken.ts + unit tests",
  
  "description": "Create JWT generation with standard claims (iss, sub, iat, exp), support custom claims, 15-min expiration, HS256/RS256 algorithms",
  
  "acceptance_criteria": [
    "✓ Generates valid JWT with standard claims",
    "✓ Supports custom payload claims",
    "✓ Token expires after 15 minutes",
    "✓ Token signature verifies correctly",
    "✓ All edge cases handled",
    "✓ 100% unit test coverage"
  ],
  
  "out_of_scope": [
    "✗ Token refresh (separate task)",
    "✗ Token storage",
    "✗ Refresh token generation"
  ],
  
  "estimated_hours": 20,
  "estimated_cost": 12.50,
  "complexity": "moderate",
  "priority": "critical",
  
  "depends_on": ["task_auth_005"],  // Database schema must finish first
  "blocks": ["task_auth_003"],      // Login endpoint depends on this
  
  "risk_level": "low",
  "risks": [
    {
      "risk": "JWT library has breaking changes",
      "mitigation": "Pin version, read changelog before upgrade"
    }
  ]
}
```

### Why This Format Works for Development

Development knows:
1. ✅ **What to build**: "generateToken.ts with these features"
2. ✅ **How to know it's done**: Acceptance criteria checklist
3. ✅ **What NOT to build**: Out of scope prevents scope creep
4. ✅ **How long it takes**: 20 hours (can break into days)
5. ✅ **What's already done**: Depends on this task
6. ✅ **What it unblocks**: This task blocks other work

## Execution Plan: Phases with Dependencies

After WBS is created, create an execution plan:

```
PHASE 1: Foundation (Week 1)
├─ Database Design (task_auth_005) - 16 hours
├─ Database Setup (parallel) (task_auth_006) - 12 hours
└─ JWT Library Integration (task_auth_002) - 8 hours
Exit Criteria: Database ready, all dependencies available

PHASE 2: Core Authentication (Week 2)
├─ JWT Generation (task_auth_001) - 20 hours
├─ Token Validation (task_auth_004) - 16 hours
└─ Login Endpoint (parallel) (task_auth_003) - 24 hours
Exit Criteria: Auth endpoints working, manual tests pass

PHASE 3: Token Refresh (Week 3)
├─ Redis Setup (task_auth_007) - 12 hours
├─ Refresh Endpoint (task_auth_008) - 16 hours
└─ Integration (task_auth_009) - 8 hours
Exit Criteria: Token refresh end-to-end working

PHASE 4: Security & Testing (Week 4)
├─ Security Audit (task_auth_010) - 8 hours
├─ Integration Tests (task_auth_011) - 24 hours
└─ Load Testing (task_auth_012) - 12 hours
Exit Criteria: All tests pass, security approved
```

Metrics:
- Total Duration: 4 weeks
- Critical Path: Phase 1 → Phase 2 → Phase 4 (64 hours sequentially)
- With Parallelization: ~3 weeks (tasks in same phase run in parallel)
- Average Task: 15 hours

## Cost Tracking Through WBS

### Planning Phase Estimate
```
Work Package 1.2.1: JWT Generation
  Hours: 20
  Rate: $0.625/hour (using Claude Opus)
  Cost: $12.50

Work Package 1.2.2: Token Validation
  Hours: 16
  Cost: $10.00

Work Package 1.3.1: Login Endpoint
  Hours: 24
  Cost: $15.00

... (all packages)
─────────────────────
TOTAL ESTIMATED: $90.00
```

### Development Phase Actual
```
Work Package 1.2.1: JWT Generation
  Estimated: 20 hours = $12.50
  Actual: 14 hours = $8.75
  Savings: $3.75 ✓

Work Package 1.2.2: Token Validation
  Estimated: 16 hours = $10.00
  Actual: 19 hours = $11.88
  Overrun: $1.88 ⚠️

Total Actual: $92.13
Total Estimate: $90.00
Variance: +2.4% (acceptable)
```

## Planning Phase Deliverables

When planning finishes, it produces:

```
OUTPUTS FROM PLANNING PHASE:
├─ specification.md                 # What to build (high-level)
├─ work-breakdown-structure.json    # Hierarchical scope (100% rule verified)
├─ work-packages.json               # 40-100 detailed tasks
├─ execution-plan.json              # Phases with dependencies
├─ wbs-dictionary.md                # Detailed specs for each task
├─ timeline.md                      # Gantt-ready schedule
├─ dependencies.md                  # Task dependency map
├─ risk-register.json               # Identified risks
├─ resource-plan.md                 # Agent allocation
└─ cost-estimate.json               # $X per phase, total budget

TOTAL WORK DEFINED: Usually 30-100 tasks depending on complexity
AVERAGE TASK SIZE: 15-25 hours
CLEAR SUCCESS CRITERIA: ✓ For each task
BUDGET: Precise, down to task level
TIMELINE: Defendable, with critical path identified
```

Development receives **everything needed to execute successfully**.

## Key Talking Points for This Chat

- [ ] 8/80 rule: does 8-80 hours feel right? (too big? too small?)
- [ ] Hierarchy depth: 4 levels enough? Or need 5?
- [ ] Task assignment: one agent per 20-hour task realistic?
- [ ] Parallelization: how many tasks can realistically run in parallel?
- [ ] Estimation accuracy: how confident can we be in 20-hour estimates?
- [ ] Risk: is identifying risks per-task enough or need higher-level risk management?
- [ ] Cost model: should rates vary by agent type (coder vs. reviewer)?

## References
**From Previous Work**:
- `enhanced-planning-with-wbs.ts` - Working WBS implementation
- `planning-with-wbs-guide.md` - Complete WBS guide with examples

## Code You'll See
- WBS generation from specification
- Work package task creation
- Execution plan with dependency ordering
- Cost rollup from tasks to phases to total
- WBS Dictionary generation

## Outcome
By the end of this chat:
✅ WBS structure locked in (hierarchy, 100% rule, 8/80 rule)
✅ Task template designed (what each task contains)
✅ Execution plan approach validated
✅ Cost tracking through WBS
✅ Decision on how many phases (usually 3-4)
✅ Parallelization strategy identified

---

## Next Chat
**Next for the current repo**: `DECISIONS.md` and `MASTER-INDEX.md`
- The original Chat 4 is historical only
- Current execution should follow the custom engine direction, not Ruflo
