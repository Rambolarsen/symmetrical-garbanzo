# Structured Planning Phase: Task Decomposition with Work Breakdown Structure

## Overview

The Planning phase now has **three deliverables**:

1. **Work Breakdown Structure (WBS)** - Hierarchical decomposition of scope
2. **Work Package Tasks** - Detailed, executable tasks with clear acceptance criteria
3. **Execution Plan** - Sequencing, phases, and dependencies

This ensures development has **clear, manageable work**.

---

## The Three Planning Deliverables

### 1. Work Breakdown Structure (WBS)

**What it is**: A hierarchical decomposition of the entire project scope into increasingly detailed components.

**Structure**:
```
Project (Total Scope)
├─ Level 1: Major Deliverables (1-3 items)
│  ├─ Level 2: Components (3-8 items)
│  │  ├─ Level 3: Sub-components (3-8 items)
│  │  │  └─ Level 4: Work Packages (LEAF NODES)
```

**Example: Building Authentication System**

```
Authentication System
├─ 1. Core Authentication
│  ├─ 1.1 User Database Schema
│  │  └─ 1.1.1 Design user table (16 hours)
│  │  └─ 1.1.2 Add auth columns (8 hours)
│  ├─ 1.2 JWT Implementation
│  │  └─ 1.2.1 Implement JWT generation (20 hours)
│  │  └─ 1.2.2 Token validation logic (16 hours)
│  └─ 1.3 Login Endpoint
│     └─ 1.3.1 Build POST /login (24 hours)
│
├─ 2. Token Refresh
│  ├─ 2.1 Refresh Token Storage
│  │  └─ 2.1.1 Redis setup (12 hours)
│  └─ 2.2 Refresh Endpoint
│     └─ 2.2.1 Build POST /refresh (16 hours)
│
└─ 3. Security & Testing
   ├─ 3.1 Security Review (8 hours)
   └─ 3.2 Integration Tests (24 hours)
```

**The 100% Rule**: Sum of all children = 100% of parent
```
1. Core Auth = 1.1 + 1.2 + 1.3 = (8+16) + (20+16) + (24) = 84 hours
2. Token Refresh = 2.1 + 2.2 = (12) + (16) = 28 hours
3. Security & Testing = 3.1 + 3.2 = (8) + (24) = 32 hours
─────────────────────────────────
Total Project = 84 + 28 + 32 = 144 hours ✓
```

**The 8/80 Rule**: Work packages should be 8-80 hours
- ✓ 16 hours - Good (middle of range)
- ✓ 24 hours - Good (middle of range)
- ✗ 4 hours - Too small (can't assess accurately)
- ✗ 120 hours - Too large (hard to assign, track, estimate)

---

### 2. Work Package Tasks

**What it is**: Detailed task specifications for each work package with:
- Clear acceptance criteria (how we know it's done)
- Deliverables
- Dependencies
- Risk assessment
- Effort estimate

**Example Task**:

```json
{
  "task_id": "task_auth_001",
  "wbs_id": "1.2.1",
  "title": "Implement JWT Generation",
  "description": "Create JWT token generation with standard claims and custom attributes",
  
  "deliverable": "JWT token generation function (generateToken.ts)",
  
  "acceptance_criteria": [
    "✓ Generates valid JWT with standard claims (iss, sub, iat, exp)",
    "✓ Supports custom claims in token payload",
    "✓ Token expires after 15 minutes",
    "✓ Token signature verifies correctly",
    "✓ All edge cases handled (no payload, huge payload, etc)",
    "✓ Unit tests pass with 100% coverage"
  ],
  
  "out_of_scope": [
    "✗ Token refresh logic (separate task)",
    "✗ Token storage mechanism",
    "✗ Refresh token generation"
  ],
  
  "estimated_hours": 20,
  "estimated_cost": 12.50,
  "complexity": "moderate",
  "priority": "critical",
  
  "depends_on": [
    "task_auth_005"  // Database setup must complete first
  ],
  "blocks": [
    "task_auth_003"  // Login endpoint depends on this
  ],
  
  "risk_level": "low",
  "risks": [
    {
      "risk": "JWT library has breaking changes",
      "mitigation": "Pin to tested version, read changelog first"
    },
    {
      "risk": "Token payload too large for URLs",
      "mitigation": "Implement size validation, document limits"
    }
  ]
}
```

**What makes a good work package**:
- ✅ Assignable to one person/agent
- ✅ Clear success criteria
- ✅ Defined dependencies
- ✅ 8-80 hours of effort
- ✅ Produces a specific deliverable
- ✅ Can be estimated accurately
- ✅ Can be completed in 1-2 weeks

---

### 3. Execution Plan

**What it is**: A phased approach to executing all work packages while respecting dependencies.

**Example Execution Plan**:

```
PHASE 1: Foundation (Week 1 - 2)
├─ Database Design (task_auth_005) - 16 hours
├─ Database Setup (parallel) (task_auth_006) - 12 hours
└─ JWT Library Integration (task_auth_002) - 8 hours
Exit Criteria: Database ready, dependencies available, JWT working

PHASE 2: Core Auth (Week 2-3)
├─ JWT Generation (task_auth_001) - 20 hours
├─ Token Validation (task_auth_004) - 16 hours
└─ Login Endpoint (parallel to above) (task_auth_003) - 24 hours
Exit Criteria: Auth endpoints functional, manual testing passed

PHASE 3: Token Refresh (Week 3)
├─ Redis Setup (task_auth_007) - 12 hours
├─ Refresh Endpoint (task_auth_008) - 16 hours
└─ Refresh Integration (task_auth_009) - 8 hours
Exit Criteria: Token refresh working end-to-end

PHASE 4: Security & Testing (Week 4)
├─ Security Audit (task_auth_010) - 8 hours
├─ Integration Tests (task_auth_011) - 24 hours
└─ Load Testing (task_auth_012) - 12 hours
Exit Criteria: All tests pass, security review approved
```

**Metrics**:
- Total Duration: 4 weeks
- Critical Path: Foundation → Core Auth → Security (64 hours sequentially)
- With Parallelization: Can do in ~3 weeks (multiple tasks in same phase)
- Average Task Size: 15 hours

---

## How Tasks Flow to Development Phase

### Input to Development

When development begins, they receive:

```json
{
  "phase": 1,
  "title": "Foundation",
  "tasks": [
    {
      "task_id": "task_auth_005",
      "title": "Design User Database Schema",
      "deliverable": "schema.sql",
      "acceptance_criteria": [
        "✓ Users table with proper indexes",
        "✓ Password hashing schema",
        "✓ Token blacklist table",
        "✓ Queries perform <100ms"
      ],
      "estimated_hours": 16,
      "assigned_agent": "coder",
      "depends_on": [],
      "blocks": ["task_auth_001", "task_auth_003", "task_auth_004"]
    },
    {
      "task_id": "task_auth_006",
      "title": "Set Up Database",
      "deliverable": "Running PostgreSQL instance with schema",
      "acceptance_criteria": [
        "✓ Database running locally",
        "✓ Schema loaded from schema.sql",
        "✓ Migrations working",
        "✓ Seed data loaded"
      ],
      "estimated_hours": 12,
      "assigned_agent": "coder",
      "depends_on": ["task_auth_005"],
      "blocks": ["task_auth_001"]
    }
  ]
}
```

### Development Executes Tasks

For each task, development:
1. **Understands the scope** - Clear description
2. **Knows what to build** - Specific deliverable
3. **Knows when it's done** - Acceptance criteria
4. **Knows dependencies** - What must finish first
5. **Knows estimate** - Hours provided
6. **Has acceptance test** - Clear success metrics

### Task Completion Report

When task completes, development returns:

```json
{
  "task_id": "task_auth_005",
  "status": "completed",
  "actual_hours": 14,
  "deliverable": "schema.sql",
  "acceptance_results": {
    "users_table_with_indexes": "✓ PASS",
    "password_hashing_schema": "✓ PASS",
    "token_blacklist_table": "✓ PASS",
    "query_performance": "✓ PASS (avg 45ms)"
  },
  "deviations": "Finished 2 hours early due to reusing existing schema patterns",
  "issues": [],
  "ready_for_next": true
}
```

---

## WBS Dictionary

For each work package, create a WBS Dictionary entry:

```
WBS ID: 1.2.1
Task: Implement JWT Generation
Assigned To: Coder Agent

DESCRIPTION:
Create the core JWT token generation function with support for:
- Standard JWT claims (iss, sub, iat, exp)
- Custom payload claims
- Configurable expiration (default 15 min)
- HS256 or RS256 signing algorithms

DELIVERABLES:
- generateToken.ts (function implementation)
- generateToken.test.ts (unit tests)
- IMPLEMENTATION.md (code documentation)

EFFORT ESTIMATE: 20 hours

DEPENDENCIES:
- Task 1.1.1: Database schema (for user ID storage)
- Library selection (already completed in pre-planning)

RISKS:
- Library breaking changes → Pin version
- Token too large → Validate payload size

SUCCESS CRITERIA:
1. Function generates valid, verifiable JWT
2. All standard claims present
3. Custom claims preserved
4. Expiration enforced
5. 100% unit test coverage
6. Performance: <5ms to generate token

RESOURCES NEEDED:
- JWT library (jsonwebtoken)
- Testing framework (Jest)
- Cryptography knowledge (moderate)
```

---

## Benefits of This Approach

### For Planning
✅ **Clear Scope** - Every deliverable explicitly defined
✅ **Accurate Estimates** - 8-80 hour rule enables better estimation
✅ **Risk Visibility** - Risks identified per task
✅ **100% Coverage** - 100% rule ensures nothing is missed

### For Development
✅ **No Ambiguity** - Clear acceptance criteria
✅ **Manageable Chunks** - 8-80 hours is perfect for assignment
✅ **Trackable Progress** - Can mark tasks complete
✅ **Dependency Clarity** - Knows what must finish first
✅ **Autonomous Execution** - Agents can work independently

### For Monitoring
✅ **Early Detection** - See issues when tasks slip
✅ **Accurate Tracking** - Know exactly what's done
✅ **Risk Adjustment** - Can respond to emerging risks
✅ **Progress Visibility** - Clear metrics: 45/120 tasks done

---

## Decision Rules for WBS Decomposition

**When is decomposition complete?**

Ask: "Would further breaking this down make it MORE manageable?"

| Work Package | Hours | Decision |
|-------------|-------|----------|
| Design entire auth system | 240 | ❌ Too big - Decompose |
| Implement JWT | 45 | ✓ Good |
| Write JWT unit tests | 12 | ✓ Good |
| Verify JWT signature works | 3 | ❌ Too small - Combine |

---

## Cost Tracking through WBS

**Pre-Planning**: Estimates cost at high level
```
Task: "Build authentication system"
Estimate: $500-2000
Reason: Too vague
```

**Planning (with WBS)**: Estimates cost per work package
```
Work Package 1.2.1: Implement JWT Generation
  Hours: 20
  Rate: $0.625/hour (claude-opus)
  Cost: $12.50
  
Work Package 1.2.2: Token Validation
  Hours: 16
  Rate: $0.625/hour
  Cost: $10.00
  
... (all work packages)
─────────────────────
Total: $90.00 ± 5%
```

**Development**: Tracks actual vs. estimated
```
Work Package 1.2.1: Implement JWT Generation
  Estimated: 20 hours → $12.50
  Actual: 14 hours → $8.75
  Savings: $3.75
  
Work Package 1.2.2: Token Validation
  Estimated: 16 hours → $10.00
  Actual: 19 hours → $11.88
  Overage: $1.88
```

---

## Example: Complete Planning Output

Here's what Planning phase delivers to Development:

```
DELIVERABLES FROM PLANNING PHASE:
├─ specification.md         # What to build
├─ work-breakdown-structure.json   # Hierarchical scope
├─ work-packages.json       # Detailed tasks (100+)
├─ execution-plan.json      # Phases and sequencing
├─ wbs-dictionary.md        # Detailed specs for each task
├─ timeline.md              # Gantt data
├─ dependencies.md          # Task dependencies
├─ risk-register.json       # Identified risks
├─ resource-plan.md         # Agent allocation
└─ cost-estimate.json       # Budget by phase

TOTAL TASKS TO DEVELOP: Usually 30-100 depending on project size
AVERAGE TASK SIZE: 15-25 hours
CLEAR ACCEPTANCE CRITERIA: ✓ For each task
ESTIMATED COST: Detailed, down to task level
```

Development receives **everything needed to execute successfully**.

---

## Next: Transition to Development Phase

After Planning delivers these, humans review:

✅ **Can we deliver in estimated time?** (Check critical path)
✅ **Are resources sufficient?** (Check agent allocation)
✅ **Are risks acceptable?** (Review risk register)
✅ **Is budget approved?** (Check cost estimate)

Once approved → Development Phase begins with clear work items.
