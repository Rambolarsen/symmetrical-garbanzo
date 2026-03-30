# Current Repo Start Here

## What This Folder Is For

This folder began as a 17-chat architecture breakdown. It now doubles as the planning and reference area for the current repo.

If you want the current implementation truth, use this order:

1. `DECISIONS.md`
2. `MASTER-INDEX.md`
3. `README-CHAT-ORGANIZATION.md`
4. The chat docs only as supporting context

## Current State Summary

Implemented:

- Phase 0 pre-planning in C# (`PrePlanningService.cs`)
- Phase 1 planning/WBS in C# (`PlanningService.cs`)
- Human decision gate in the React UI
- Provider abstraction via keyed `IChatClient`
- TypeScript sidecar for code-agent execution

Not implemented yet:

- Phase 2 development dispatcher
- Persistence and checkpointing
- Comprehensive test coverage
- Broader REST / CLI surface

## Important Notes

- Ruflo is historical only. It was evaluated and rejected.
- .NET is the primary orchestration runtime.
- TypeScript is a sidecar, not the main orchestration engine.
- Some chat docs still describe the earlier design direction. Prefer `DECISIONS.md` when there is any conflict.

## Files That Reflect The Current Repo Best

Navigation:

- `README-CHAT-ORGANIZATION.md`
- `MASTER-INDEX.md`
- `DECISIONS.md`

Reference material still useful:

- `CHAT-01-introduction-architecture.md`
- `CHAT-02-three-phase-architecture.md`
- `CHAT-03-planning-wbs-decomposition.md`
- `planning-with-wbs-guide.md`
- `enhanced-planning-with-wbs.ts`

Historical only:

- `CHAT-04-ruflo-execution-engine.md`

## Recommended Next Work

1. Build Phase 2 execution from `PlanningResult`
2. Persist orchestration state and checkpoints
3. Surface real execution progress in the UI
4. Add backend and UI tests
