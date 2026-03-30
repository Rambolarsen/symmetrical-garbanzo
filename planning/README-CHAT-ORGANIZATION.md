# Planning Folder Guide

## What This Folder Is Now

This folder started as a 17-chat architecture breakdown. It is now also the live planning area for the repo.

For the current codebase, do not treat every chat file as the source of truth. Use this order instead:

1. `DECISIONS.md` for implemented architectural choices
2. `MASTER-INDEX.md` for current status and roadmap
3. Chat files as background design context

## Current Repo State

As of 2026-03-30, the repo has:

- Phase 0 pre-planning implemented in C# (`PrePlanningService.cs`)
- Phase 1 planning/WBS implemented in C# (`PlanningService.cs`)
- Human decision gate implemented in the React UI
- Provider abstraction implemented via keyed `IChatClient`
- TypeScript sidecar still present for code-agent execution

Still pending:

- Phase 2 development dispatcher
- Persistence and checkpointing
- Tests
- Broader API / CLI surface

## Important Corrections vs. Older Chat Docs

- Ruflo is not the execution engine. That path was rejected.
- .NET is the primary orchestration runtime.
- TypeScript is a sidecar for code-agent execution, not the main orchestrator.
- The current build priority is execution durability, not more architecture exploration.

## How To Use The Chat Files

Use the chat docs when you need extra design context:

- `CHAT-01` to `CHAT-03`: still useful background for architecture, pre-planning, and WBS
- `CHAT-04`: historical only; superseded by `DECISIONS.md`
- `CHAT-05-17`: selective reference material for later roadmap areas

## Recommended Next Work

If you're using this repo as the source of truth, the next implementation focus should be:

1. Build Phase 2 execution from `PlanningResult`
2. Persist orchestration state and checkpoints
3. Show real execution progress in the UI
4. Add backend and UI tests
