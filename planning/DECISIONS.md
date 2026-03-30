# Architecture Decisions

This file records decisions made during implementation, superseding or refining the original chat plans.

---

## Decision 1: Reject Ruflo as Execution Engine

**Status**: REJECTED (replaces Chat 4 recommendations)
**Date**: 2026-03-28

### What we found

`ruflo` (v3.5.48, npm) exists and is actively published, but the core commands the
platform was designed around — `hive-mind spawn`, `hive-mind init`, `hive-mind task` —
fail at runtime. The CLI surface is documented but the underlying MCP tools those commands
call do not exist. Three open, unresolved GitHub issues confirm this:

- #1028 `hive-mind init` fails on macOS (MCP tool not found)
- #1035 `hive-mind task` references non-existent MCP tool
- #1036 CLI commands reference non-existent `task_assign` and `hive-mind_task` tools

415 open issues total. Not suitable as a foundation.

### Decision

Build the orchestration engine ourselves. The 3-phase logic (pre-planning → planning →
development) is our core product, not a wrapper around someone else's framework.
Complexity of doing it ourselves is low: it is structured LLM API calls with state
management between phases.

---

## Decision 2: Hybrid Agent Stack

**Status**: IMPLEMENTED
**Date**: 2026-03-28
**Replaces**: Chat 4 (Ruflo), Chat 5 (Provider Abstraction)

### Stack

```
Provider Layer   →  Vercel AI SDK (ai v6) + @ai-sdk/* packages
Local LLMs       →  ollama-ai-provider-v2
Code Agents      →  @anthropic-ai/claude-agent-sdk (Claude Code)
Orchestration    →  Custom 3-phase engine (this codebase)
```

### Two agent kinds

**LLM agents** (`runLLMAgent`) — Vercel AI SDK, any provider:
- Use for: reasoning, planning, analysis, scoring, summarization
- Provider swap = one string change (`MODELS.fast`, `MODELS.balanced`, etc.)
- Supports: Claude, OpenAI, Gemini, Ollama (local), extensible to any AI SDK provider

**Claude Code agents** (`runCodeAgent`) — `@anthropic-ai/claude-agent-sdk`:
- Use for: file editing, bash execution, code implementation
- Built-in tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch
- No tool loop to implement — agent handles it internally
- Session persistence, subagent spawning, hooks system available

### Why not just one kind?

Claude Code agents are overkill for reasoning tasks (expensive, slow, subprocess overhead).
LLM agents can't safely run bash or edit files without implementing a full tool loop.
The split maps cleanly to the task types in Phase 1 (planning) vs Phase 2 (development).

### Provider routing defaults

| Alias              | Model                      | Use case                          |
|--------------------|----------------------------|-----------------------------------|
| `MODELS.fast`      | claude-haiku-4-5-20251001  | Pre-planning, cheap analysis      |
| `MODELS.balanced`  | claude-sonnet-4-6          | Planning, most reasoning tasks    |
| `MODELS.powerful`  | claude-opus-4-6            | Architecture, complex reasoning   |
| `MODELS.openai_fast` | gpt-4o-mini              | Cost-sensitive OpenAI tasks       |
| `MODELS.openai_balanced` | gpt-4o               | OpenAI alternative                |
| `MODELS.google_balanced` | gemini-2.5-pro       | Google alternative                |
| `MODELS.local`     | llama3.2 (Ollama)          | Air-gapped / no API cost          |

---

## Decision 3: Vercel AI SDK v6 API Notes

**Status**: REFERENCE
**Date**: 2026-03-28

Key v6 API changes vs. what earlier docs assumed:

| Old assumption         | Actual v6 API                          |
|------------------------|----------------------------------------|
| `maxSteps: N`          | `stopWhen: stepCountIs(N)`             |
| `parameters` in tool() | `inputSchema` in tool()                |
| `usage.promptTokens`   | `usage.inputTokens`                    |
| `usage.completionTokens` | `usage.outputTokens`                 |
| `onChunk` on generateText | `onChunk` is on `streamText` only   |
| `LanguageModelV1` type | `LanguageModel` type                   |
| `chunk.textDelta`      | `chunk.text` (text-delta chunks)       |

`@anthropic-ai/claude-agent-sdk` `canUseTool` signature:
```typescript
// Must be async, returns PermissionResult
async (toolName: string) => {
  if (allowed) return { behavior: 'allow' };
  return { behavior: 'deny', message: '...' };
}
```

---

## Decision 4: .NET as Primary Stack, TypeScript as Sidecar

**Status**: IMPLEMENTED
**Date**: 2026-03-28

Primary orchestration engine is .NET 9 / C#. TypeScript remains as the Claude Code agent sidecar only.

### .NET packages

| Role | Package | Version |
|---|---|---|
| Abstraction layer | `Microsoft.Extensions.AI` | 10.4.1 |
| Orchestration | `Microsoft.SemanticKernel` | 1.74.0 |
| Claude | `Anthropic.SDK` (unofficial, 1.5M DLs) | 5.10.0 |
| OpenAI | `OpenAI` | 2.9.1 |
| Ollama (local) | `OllamaSharp` | 5.4.25 |
| Gemini | `Microsoft.SemanticKernel.Connectors.Google` | 1.74.0-alpha |
| Aspire hosting | `Aspire.Hosting.JavaScript` | 13.2.0 |

Note: `Aspire.Hosting.NodeJs` is deprecated — use `Aspire.Hosting.JavaScript` instead.
Note: Native Claude SK connector doesn't exist; use `Anthropic.SDK` → `IChatClient` bridge.

### Aspire sidecar integration

```csharp
// AppHost wires the TypeScript sidecar as a JavaScript app resource
builder.AddJavaScriptApp("claude-code-sidecar", "../../")
    .WithHttpEndpoint(port: 3000, env: "PORT")
    .WithEnvironment("ANTHROPIC_API_KEY", ...);

// Api uses service discovery — Aspire injects the URL automatically
services.AddHttpClient<ClaudeCodeSidecarClient>(c =>
    c.BaseAddress = new Uri("http://claude-code-sidecar"));
```

---

## What Is Built (as of 2026-03-28)

```
dotnet/
├── Maestroid.sln
├── Maestroid.AppHost/
│   └── Program.cs                — Aspire wiring (sidecar + API)
├── Maestroid.Api/
│   ├── Program.cs                — ASP.NET Core entry point
│   └── Endpoints/
│       └── OrchestrationEndpoints.cs  — /orchestration/pre-plan, /code-agent
└── Maestroid.Core/
    ├── Agents/
    │   ├── AgentProviders.cs     — IChatClient registrations (Claude/OpenAI/Gemini/Ollama)
    │   └── ClaudeCodeSidecarClient.cs  — HTTP client for TS sidecar
    └── Orchestrator/
        └── PrePlanningService.cs — Phase 0 engine (C# port)

src/  (TypeScript sidecar)
├── server.ts                     — Express HTTP server (POST /agents/run, /health, /alive)
├── agents/
│   ├── claude-code/agent.ts      — Claude Code agent runner
│   └── providers/index.ts        — resolveModel() + MODELS
├── orchestrator/pre-planning.ts  — Phase 0 (TypeScript, now superseded by C#)
└── types/index.ts                — All shared types
│   ├── ProviderName, ModelRef
│   ├── ToolDefinition
│   ├── AgentKind, AgentRole
│   ├── PrePlanningResult, Risk
│   ├── WBSElement, WorkBreakdownStructure
│   ├── PlanningResult, ExecutionPhase
│   ├── GateDecision
│   └── Checkpoint
│
├── agents/
│   ├── providers/index.ts        — resolveModel(), MODELS defaults
│   ├── claude-code/agent.ts      — runClaudeCodeAgent()
│   └── agent-factory.ts          — runLLMAgent(), runCodeAgent()
│
└── orchestrator/
    └── pre-planning.ts           — runPrePlanning(), formatPrePlanningReport()
```

### Not yet built (remaining from original plan)

| Component              | Original chat | Status  |
|------------------------|---------------|---------|
| Phase 1: Planning (WBS generation) | Chat 3 | **DONE** (2026-03-29) |
| Human decision gate    | Chat 2, 7     | **DONE** (2026-03-29) |
| Web UI (Kanban board)  | Chat 7        | **DONE** (2026-03-29) |
| Phase 2: Development dispatcher | Chat 4 | TODO |
| State / checkpointing  | Chat 8        | TODO    |
| Cost tracking / ROI    | Chat 9        | TODO    |
| REST API               | Chat 11       | TODO    |
| CLI interface          | -             | TODO    |
| Testing                | Chat 10       | TODO    |

---

## Decision 5: Web UI — React/Vite Kanban Board

**Status**: IMPLEMENTED
**Date**: 2026-03-29

### Stack

```
web/
├── src/
│   ├── components/
│   │   ├── Board.tsx           — Main kanban board, drag logic, toast
│   │   ├── Column.tsx          — Drop target + task card list
│   │   ├── TaskCard.tsx        — Draggable card with loading/error states
│   │   ├── DecisionGateModal.tsx — Pre-planning review + approve/skip/cancel
│   │   └── AddTaskModal.tsx    — New task input
│   ├── store/tasks.ts          — useReducer-based task state
│   ├── api/client.ts           — fetch wrapper → /api/orchestration/*
│   └── types/index.ts          — Task, ColumnId, COLUMNS, result types
```

### Column flow

```
Backlog → Pre-Planning (drag, triggers API) → Decision Gate (click opens modal)
       → Planning (auto, triggers API)    → In Development (auto) → Done (drag)
```

Only two valid drag transitions exist:
- `backlog → pre-planning` (triggers `/orchestration/pre-plan`)
- `in-development → done` (no API call)

All other drops are ignored — card snaps back.

### Vite proxy

`/api/*` → `http://localhost:5001` (standalone API port).
No CORS needed. Aspire service discovery not used from frontend.

### Decision Gate modal

Click-triggered (not drag). Three actions:
- **Approve** → moves to `planning`, calls `/orchestration/plan`, then `in-development`
- **Skip Planning** → moves directly to `in-development`
- **Cancel** → returns to `backlog`

---

## Decision 6: Error Feedback — Toast + Card Error State

**Status**: IMPLEMENTED
**Date**: 2026-03-29

When an API call fails during a column transition:
1. Task is moved back to its origin column
2. `setError(taskId, msg)` stores the error on the task
3. `showToast(msg)` displays a fixed-position red toast (5s auto-dismiss)
4. `TaskCard` renders an error indicator when `task.error` is set

### Bug fixes required to make this work

**Bug 1 — Droppable area too small**: `setNodeRef` was on the inner cards-only div
inside `Column`, not the outer column div. Empty columns had near-zero droppable area.
Fix: move `setNodeRef` to the outer `<div>` in `Column.tsx`.

**Bug 2 — MOVE reducer clearing error**: The `MOVE` case used `{ ...t, column, error: undefined }`
which wiped the error set by `setError` in the same render batch.
Fix: remove `error: undefined` — MOVE only updates `column`.

---

## Decision 7: Multi-Provider Config Override

**Status**: IMPLEMENTED
**Date**: 2026-03-29

Config keys `Models:Fast` and `Models:Balanced` in `appsettings.json` let operators
override the auto-detected provider chain at startup.

Fallback chain (when config keys are empty):
- fast: `claude-haiku-4-5-20251001` → `gpt-4o-mini` → `llama3.2`
- balanced: `claude-sonnet-4-6` → `gpt-4o` → `llama3.2`

If a configured key is set but the provider for that model is not registered (no API key),
startup throws `InvalidOperationException` with a clear message — fast fail beats silent
fallback to a wrong model.

---

## Decision 8: Aspire Port Conflict — Web Dev Server on 5174

**Status**: RESOLVED
**Date**: 2026-03-29

Aspire DCP binds to port 5173 at startup. Vite's default port collides.
Solution: run web dev server on 5174 (`npm run dev -- --port 5174`).
Aspire AppHost doesn't manage the web dev server — it's run separately.
`ASPIRE_ALLOW_UNSECURED_TRANSPORT=true` required in `launchSettings.json`
because Aspire rejects HTTP-only config without it.

---

## What Is Built (as of 2026-03-29)

```
dotnet/
├── Maestroid.sln
├── Maestroid.AppHost/
│   ├── Program.cs                      — Aspire wiring (API + TS sidecar)
│   └── Properties/launchSettings.json  — ASPIRE_ALLOW_UNSECURED_TRANSPORT=true
├── Maestroid.Api/
│   ├── Program.cs                      — ASP.NET Core + DI + Aspire
│   ├── Agents/AgentProviders.cs        — Keyed IChatClient DI (fast/balanced)
│   └── Endpoints/OrchestrationEndpoints.cs  — /pre-plan, /plan
└── Maestroid.Core/
    └── Orchestrator/
        ├── PrePlanningService.cs       — Phase 0: complexity, risks, report
        └── PlanningService.cs          — Phase 1: WBS, agents, critical path

web/                                    — React/Vite frontend
├── src/
│   ├── components/
│   │   ├── Board.tsx
│   │   ├── Column.tsx
│   │   ├── TaskCard.tsx
│   │   ├── DecisionGateModal.tsx
│   │   └── AddTaskModal.tsx
│   ├── store/tasks.ts
│   ├── api/client.ts
│   └── types/index.ts
├── vite.config.ts                      — /api/* proxy → :5001
└── package.json

src/  (TypeScript sidecar — still present but NOT wired into any live flows)
└── server.ts, agents/, orchestrator/
```

### Outstanding / Known Issues

| Issue | Description |
|---|---|
| Toast not appearing in Safari | Safari may be serving old Board.tsx despite cache clearing. Debug: `fetch('/src/components/Board.tsx').then(r=>r.text()).then(t=>console.log(t.includes('[drag]')))` |
| Decision Gate not tested end-to-end | Modal exists; plan API endpoint exists; flow not verified with real API key |
| TS sidecar not called | `ClaudeCodeSidecarClient` exists in C# but no endpoint calls it yet |
| Phase 2 not started | Development dispatcher (execute WBS work packages via agents) not built |

---

## Decision 9: Immediate Build Order

**Status**: IMPLEMENTED AS ROADMAP
**Date**: 2026-03-29

The repo now has enough Phase 0 and Phase 1 functionality that the planning docs should prioritize execution and durability over additional architectural exploration.

### Build order

1. **Phase 2 execution**
   - Implement a backend development dispatcher that consumes `PlanningResult`
   - Execute work packages in dependency order
   - Use the existing `/orchestration/code-agent` path to run code agents

2. **Persistence and checkpointing**
   - Persist tasks, planning artifacts, execution state, logs, and failures
   - Support resume, retry, and cancel for long-running orchestration

3. **UI execution loop**
   - Turn the `in-development` column into a live execution view
   - Show package status, logs, failures, and retry controls

4. **Testing**
   - Add service, endpoint, and UI flow coverage before expanding scope

5. **Broader API / CLI**
   - Formalize the external API after the core workflow is stable
   - Add CLI support later, not before persistence and tests

### Why this order

The current codebase already proves out pre-planning, planning, provider selection, and the human decision gate. The missing product value is in actually executing planned work and doing so durably enough to survive refreshes, failures, and long-running sessions.
