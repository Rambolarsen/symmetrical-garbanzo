# Chat 2: Three-Phase Architecture with Pre-Planning

## Purpose
Design the intelligent decision-making flow: Pre-Planning → Decision Gate → Development

## Context from Previous Chats
- You want transparency and human oversight
- Different tasks have different complexity levels
- Some tasks need detailed planning, others don't

## The Problem We're Solving
**Question**: Should every task go through a detailed planning phase?

**Answer**: NO - and here's why:
- Simple tasks (add a button): 30 min planning overhead for 1 hour of work = waste
- Complex tasks (rebuild auth): 45 min planning saves $30K in rework = brilliant

You need **intelligent scope analysis** to decide IF planning is needed.

## Three-Phase Architecture

```
USER TASK
   ↓
PHASE 0: PRE-PLANNING (2-5 min)
├─ Scope analysis
├─ Complexity scoring (0-100)
├─ Risk identification
└─ Recommendation: "needs planning" or "skip planning"
   ↓
HUMAN DECISION GATE
├─ Option A: Proceed with full planning
├─ Option B: Skip planning, go straight to dev
└─ Option C: Cancel with feedback
   ↓ (Option A)        ↓ (Option B)
PHASE 1: PLANNING     PHASE 2: DEVELOPMENT
(optional, conditional)  (uses pre-planning outputs)
   ↓
PHASE 2: DEVELOPMENT
```

## How Pre-Planning Works

### Input
```
Task: "Add password reset feature to login page"
```

### Analysis
Pre-planning agents analyze:
1. **Scope**: What files? What integrations? New APIs?
2. **Dependencies**: Database changes? Third-party services?
3. **Complexity Factors**:
   - Number of affected files
   - External integrations needed
   - Database changes
   - Testing scope
   - Team coordination needed
   - Rollback complexity
   - Timeline pressure
   - Technology familiarity

### Output
```json
{
  "complexity": {
    "level": "simple",
    "score": 32,  // 0-100 scale
    "factors": [
      { "description": "Single page update", "score": 10 },
      { "description": "Email integration", "score": 15 },
      { "description": "Using proven pattern", "score": 7 }
    ]
  },
  "decision": {
    "requires_full_planning": false,
    "reason": "Simple feature with minimal dependencies",
    "estimated_hours": 2,
    "estimated_cost": 1.50
  },
  "next_phase_inputs": {
    "constraints": ["Must work on mobile", "Support social logins"],
    "success_criteria": ["Works on all browsers", "Email sent within 30s"],
    "documentation_requirements": ["User guide for reset flow"]
  }
}
```

## Decision Gate: The Intelligence Layer

### Scenario A: Simple Task
```
Pre-Planning says: "Complexity: 28/100 - CAN SKIP PLANNING"

Options:
✅ [Skip Planning] → Go straight to development (saves $2 + 20 min)
→ Development uses pre-planning outputs as guidance
→ Fast, efficient, minimal overhead

✓ User chooses: Skip Planning
→ Saves time and money on low-risk work
```

### Scenario B: Complex Task
```
Pre-Planning says: "Complexity: 85/100 - REQUIRES PLANNING"

Options:
→ [Proceed with Planning] → Spend 45 min on detailed spec
→ Prevents $15K+ in rework
→ Catches architectural issues early
→ Creates audit trail

✓ User chooses: Proceed with Planning
→ Invests in planning to save on execution
```

### Scenario C: User Override
```
Pre-Planning says: "Complexity: 58/100 - RECOMMEND PLANNING"

Options:
✓ User chooses: Skip anyway (trusts their domain knowledge)
→ Saves 20 minutes
→ Accepts moderate risk
→ Uses pre-planning constraints as guidance
```

## Cost Comparison: When Planning Saves Money

### Example 1: Simple Task (Add Feature Flag)
```
Path A: WITH Planning
├─ Pre-Planning: $0.15 (2 min)
├─ Planning: $2.00 (20 min with architects)
├─ Development: $3.00 (implementation)
└─ Total: $5.15 | Time: 35 min

Path B: SKIP Planning
├─ Pre-Planning: $0.15 (2 min)
├─ Development: $3.50 (some exploration, rework)
└─ Total: $3.65 | Time: 20 min
└─ Saves: $1.50 + 15 min ✓ SKIP PLANNING
```

### Example 2: Complex Task (Rebuild Auth System)
```
Path A: WITH Planning
├─ Pre-Planning: $0.50 (5 min)
├─ Planning: $8.00 (30 min architects + analysts)
├─ Development: $25.00 (guided by spec, efficient)
└─ Total: $33.50 | Time: 3 hours

Path B: SKIP Planning (trial & error)
├─ Pre-Planning: $0.50 (5 min)
├─ Development: $45.00 (lots of rework, mistakes)
├─ Fixes/Rework: $18.00 (caught issues late)
└─ Total: $63.50 | Time: 5 hours + fixes
└─ Cost overrun: $30! ✓ REQUIRE PLANNING
```

## Decision Matrix

When does pre-planning recommend planning?

| Complexity | Scope | Dependencies | Decision |
|-----------|-------|--------------|----------|
| Trivial | Single file | None | **SKIP** |
| Simple | Single feature | None-Few | **SKIP** |
| Moderate | Multiple features | Medium | **RECOMMEND** |
| Complex | Multiple services | High | **REQUIRE** |
| Enterprise | Multi-domain | Critical | **REQUIRE** |

## Pre-Planning Agents

**Researcher Agent**:
- Gathers context about the task
- Identifies dependencies
- Researches best practices and patterns
- Flags unknowns

**Analyst Agent**:
- Scores complexity (0-100)
- Estimates effort and cost
- Identifies risks
- Makes recommendation

## What Gets Output to Next Phase

### If Developing Directly (Skip Planning)
```json
{
  "scope_id": "scope_12345",
  "constraints": ["Must support 10K users", "..."],
  "assumptions": ["Using PostgreSQL", "..."],
  "success_criteria": ["99.99% uptime", "..."],
  "estimated_hours": 40,
  "recommended_agents": ["coder", "tester", "reviewer"],
  "risks": [
    {
      "risk": "Third-party API integration",
      "severity": "high",
      "mitigation": "Add fallback mechanism"
    }
  ]
}
```

Development has **enough guidance** to start without detailed planning.

### If Going to Planning Phase
Same outputs become **inputs to the Planning agent**, who refines them into detailed specifications.

## Key Talking Points for This Chat

- [ ] Do you agree with skipping planning on simple tasks?
- [ ] What's your complexity scoring approach? (Better ideas?)
- [ ] Who decides: Planning recommends OR human always decides?
- [ ] Timeline: 2-5 min for pre-planning reasonable?
- [ ] Cost model: How do we calculate estimates?
- [ ] Should pre-planning be optional/skip-able for users who always want planning?

## References
**From Previous Work**:
- `DECISIONS.md` - Current implementation decisions and corrections
- `MASTER-INDEX.md` - Current status and roadmap

## Code Examples in This Chat
- Pre-planning agent prompts
- Complexity scoring algorithm
- Decision matrix implementation
- Cost comparison calculator

## Outcome
By the end of this chat:
✅ Pre-planning flow locked in
✅ Complexity scoring algorithm designed
✅ Decision gate UX sketched
✅ Cost models established
✅ Approval/rejection flow designed

---

## Next Chat
**Chat 3: Planning Phase with Task Decomposition (WBS)**
- How to break development work into manageable tasks
- 100% Rule, 8/80 Rule
- Work Breakdown Structure
