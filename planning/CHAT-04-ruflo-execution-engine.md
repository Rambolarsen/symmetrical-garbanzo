# Chat 4: Ruflo as the Execution Engine - Two-Phase Agent Swarms

> ⚠️ **SUPERSEDED** — Ruflo was evaluated and rejected. See `DECISIONS.md` → Decision 1.
> The hybrid stack (Vercel AI SDK + Claude Code agent SDK) replaced this. The rest of
> this file is kept for historical reference only.

---

## Purpose
Evaluate Ruflo as your agent orchestration platform and design how to use it for planning and development phases.

## Context from Previous Chats
- Pre-Planning decides if full planning is needed
- Planning creates WBS and work packages
- Development executes work packages
- NOW: How do agents actually do this work?

## What is Ruflo?

**Ruflo** (formerly Claude Flow) is a multi-agent orchestration framework designed for AI-driven workflows.

### Key Facts
- **Self-learning**: Uses Q-Learning router to improve over time
- **60+ agents**: Specialized agents (researcher, coder, tester, architect, etc.)
- **Multi-provider**: Claude-optimized but supports GPT, Gemini, Cohere, local LLMs
- **Vector search**: HNSW indexing for pattern matching
- **ReasoningBank**: Learns from past successful workflows
- **Agent Booster (WASM)**: Simple transforms 352x faster without LLM calls
- **Hive Mind**: Hierarchical queen-led agent coordination

### Strengths
✅ Designed for multi-agent orchestration
✅ Cost optimization (routes to cheapest viable model)
✅ Specialized agents for different roles
✅ Self-learning improves with usage
✅ Good state management
✅ Stream-JSON for agent chaining

### Limitations
❌ Autonomous by default (doesn't have built-in human approval gates)
❌ Optimized for speed/cost (not for transparency)
❌ Self-learning is opaque (you can't see why agents made decisions)
❌ Documentation generation not built-in

## Your Solution: Wrap Ruflo with Your Spec System

```
┌─────────────────────────────────────────────────────┐
│     YOUR ORCHESTRATION LAYER                        │
│  (Transparency + Human Gatekeeping)                 │
├─────────────────────────────────────────────────────┤
│                                                     │
│  PHASE 0: Pre-Planning                             │
│  ├─ Researcher agent (analyze scope)              │
│  └─ Analyst agent (complexity scoring)             │
│                                                     │
│  ↓ HUMAN DECISION GATE ↓                           │
│                                                     │
│  PHASE 1: Planning (OPTIONAL)                       │
│  ├─ Use Ruflo's planning swarm                     │
│  ├─ Architect + Analyst + Researcher agents        │
│  └─ Output: Specification for human review         │
│                                                     │
│  ↓ HUMAN APPROVAL GATE ↓                           │
│                                                     │
│  PHASE 2: Development                              │
│  ├─ Use Ruflo's development swarm                  │
│  ├─ Coder + Tester + Reviewer agents               │
│  └─ Execute work packages with tracking            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

Your spec system provides:
- Human approval gates
- Documentation generation
- Transparency/audit trails
- Cost tracking

Ruflo provides:
- Multi-agent coordination
- Specialized agents
- Cost optimization
- State management

## Two-Phase Ruflo Workflow

### Phase 1: Planning Swarm

**When it runs**: After human decides to do full planning

**Agents spawned**:
- **System Architect**: Design high-level solution
- **Analyst**: Break down into work packages
- **Researcher**: Identify dependencies and risks

**Process**:
```
YOUR SPEC SYSTEM → Calls Ruflo
                   └─ Creates planning swarm
                      ├─ Researcher analyzes scope
                      ├─ Architect designs solution
                      ├─ Analyst breaks into tasks
                      └─ Returns: WBS + Tasks + Execution Plan
                   ← Returns to YOUR SPEC SYSTEM
                   → Displays spec for human review
                   → Human approves/modifies/rejects
```

**CLI Command**:
```bash
npx ruflo hive-mind spawn "Plan Authentication System" \
  --agents system-architect,analyst,researcher \
  --topology hierarchical \
  --queen-type strategic \
  --output-format json
```

**Output** (passed to human review):
```json
{
  "wbs": { ... },
  "work_packages": [ ... ],
  "execution_plan": { ... },
  "specification": "...",
  "documentation": "...",
  "estimated_hours": 144,
  "estimated_cost": 90.00
}
```

### Phase 2: Development Swarm

**When it runs**: After human approves plan (or after pre-planning if skipping planning)

**Agents spawned**:
- **Coder**: Implementation
- **Tester**: Quality assurance
- **Reviewer**: Code review and security
- **Documenter**: Update documentation

**Process**:
```
YOUR SPEC SYSTEM → Loads approved specification
                → For each phase in execution plan:
                   ├─ Calls Ruflo with work packages
                   └─ Creates development swarm
                      ├─ Coders implement tasks in parallel
                      ├─ Testers verify each task
                      ├─ Reviewers audit code
                      └─ Documenters update docs
                   → Tracks progress (8/40 tasks done)
                   → Tracks cost (actual vs. estimated)
                   → Monitors for deviations
```

**CLI Command** (for Phase 1 of execution plan):
```bash
npx ruflo hive-mind spawn "Implement from Spec" \
  --agents coder,coder,tester,reviewer,documenter \
  --topology hierarchical \
  --spec-input ./approved-spec.json \
  --phase 1 \
  --track-cost true
```

**Output** (tracks work):
```json
{
  "phase": 1,
  "tasks_started": 3,
  "tasks_completed": 2,
  "progress": "67%",
  "actual_hours_used": 14,
  "estimated_hours": 16,
  "variance": "-2 hours (12% savings)",
  "cost_actual": 8.75,
  "cost_estimated": 10.00
}
```

## YAML Workflow Definition

Define the entire flow once, execute many times:

```yaml
name: specification-driven-development

metadata:
  version: "1.0"
  author: "your-name"
  description: "Multi-phase spec-driven development with human gates"

phases:
  # PHASE 0: Pre-Planning (always runs)
  - name: pre-planning
    agents:
      - type: researcher
        name: "Scope Analyzer"
      - type: analyst
        name: "Complexity Scorer"
    coordination: parallel
    approval: none  # No approval needed, just info gathering
    outputs:
      - scope_report
      - complexity_score
      - recommendation

  # PHASE 1: Planning (conditional on complexity)
  - name: planning
    depends_on: pre-planning
    condition: |
      if (pre-planning.complexity_score > 60) {
        skip = false
      } else {
        skip = ${USER_CHOICE}  // Ask user
      }
    agents:
      - type: system-architect
        name: "Architecture Designer"
      - type: analyst
        name: "Work Package Analyst"
      - type: researcher
        name: "Dependency Researcher"
    coordination: hierarchical
    approval: required  // ← Human must approve spec
    approval_fields:
      - specification
      - work_packages
      - cost_estimate
      - timeline
    outputs:
      - wbs
      - work_packages
      - execution_plan
      - specification_document

  # PHASE 2: Development (executes approved work)
  - name: development
    depends_on: planning  // Or pre-planning if planning skipped
    agents:
      - type: coder
        count: 3
        allocation: "primary"
      - type: tester
        count: 1
        allocation: "quality-gate"
      - type: reviewer
        count: 1
        allocation: "security-audit"
      - type: documenter
        count: 1
        allocation: "knowledge-mgmt"
    coordination: hierarchical
    execution_mode: "phased"  // Execute phases sequentially
    tracking:
      cost: true
      progress: true
      deviations: true
    outputs:
      - implementation
      - test_results
      - documentation
      - cost_report

  # PHASE 3: Validation (post-development checks)
  - name: validation
    depends_on: development
    agents:
      - type: reviewer
        name: "Final Auditor"
    approval: required  // Human final review
    outputs:
      - validation_report
      - release_readiness
```

**How it's used**:
```bash
# Run the entire workflow
npx ruflo workflow run ./spec-driven-dev.yaml \
  --input "Build user authentication system" \
  --interactive-gates

# Run just the planning phase
npx ruflo workflow run ./spec-driven-dev.yaml \
  --input "Build user authentication system" \
  --phases planning

# Resume from checkpoint
npx ruflo workflow run ./spec-driven-dev.yaml \
  --checkpoint spec_approved_2024_03_28 \
  --phases development,validation
```

## Agent Roles & Responsibilities

### Planning Swarm

| Agent | Role | Responsibility |
|-------|------|-----------------|
| Researcher | Information gathering | Find patterns, dependencies, risks |
| Analyst | Decomposition | Break into work packages (8-80h rule) |
| Architect | Design | High-level solution architecture |
| Planner | Sequencing | Create execution phases, critical path |

**Outputs**: WBS, work packages, execution plan, risks, cost estimate

### Development Swarm

| Agent | Role | Responsibility |
|-------|------|-----------------|
| Coder | Implementation | Write code to acceptance criteria |
| Tester | Verification | Run tests, verify acceptance criteria |
| Reviewer | Quality | Code review, security, performance |
| Documenter | Knowledge | Update docs, guides, runbooks |

**Outputs**: Working code, test results, documentation, deployment artifacts

## Cost Optimization Through Provider Selection

Ruflo can route tasks to optimal providers:

```
Task: "Design database schema"
├─ Cost optimization: Claude 3.5 Sonnet (cheaper, good enough)
├─ Estimated tokens: 2000
├─ Cost: $0.50
└─ Coder complexity: Low (schema design template-based)

Task: "Implement complex auth flow"
├─ Cost optimization: Claude Opus (best for complex reasoning)
├─ Estimated tokens: 8000
├─ Cost: $5.00
└─ Coder complexity: High (needs architectural thinking)

Task: "Write unit tests"
├─ Cost optimization: GPT-4o (cheaper, good for testing)
├─ Estimated tokens: 4000
├─ Cost: $1.20
└─ Tester complexity: Medium
```

Ruflo automatically routes based on:
- Task complexity
- Cost vs. quality tradeoff
- Provider availability
- Model capabilities

## State Management & Checkpointing

Ruflo handles state across phases:

```
PHASE 0: Pre-Planning ✓ Complete
  └─ State saved: scope_report.json

↓ HUMAN DECISION

PHASE 1: Planning ✓ Complete
  ├─ Specification approved
  └─ State saved: approved_spec.json + checkpoint

↓ HUMAN APPROVAL

PHASE 2: Development (IN PROGRESS)
  ├─ Task 1.1: Complete
  ├─ Task 1.2: Complete
  ├─ Task 1.3: In progress
  └─ State checkpoint: before_task_1_4.json

[System crashes or pauses]

RESUME: Load from checkpoint
  ├─ Restore state
  ├─ Verify spec hasn't changed (checksum)
  └─ Continue from task 1.4
```

## Key Talking Points for This Chat

- [ ] Is wrapping Ruflo with your spec system the right approach?
- [ ] Should planning and development use different Ruflo swarms?
- [ ] How granular should phases be? (3 phases? 4?)
- [ ] What triggers human approvals? (Spec only? Cost overruns? Timeline slips?)
- [ ] Cost tracking: track per-task or per-phase?
- [ ] Agent count: How many coders/testers per phase?
- [ ] Can we use Ruflo's self-learning to improve estimates over time?

## References
**Ruflo Documentation**:
- GitHub: https://github.com/ruvnet/ruflo
- Wiki: https://github.com/ruvnet/ruflo/wiki
- Agent types: 60+ specialized agents available

**Your Previous Work**:
- `DECISIONS.md` - Current decision that superseded this path
- `planning-with-wbs-guide.md` - Task decomposition

## Outcome
By the end of this chat:
✅ Decided: Wrap Ruflo or use different orchestration?
✅ Designed: Planning swarm composition
✅ Designed: Development swarm composition
✅ Designed: Human approval gates in Ruflo workflow
✅ Designed: Cost tracking through Ruflo
✅ Designed: State management and checkpointing

---

## Next Chat
**Chat 5: Provider Abstraction & Multi-LLM Support**
- How to support Claude, OpenAI, Gemini, local LLMs
- Intelligent provider routing
- Cost vs. quality tradeoffs
