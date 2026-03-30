# Visual Guide: Current Repo Reading Path

## The Current Path

```text
START HERE
   ↓
DECISIONS.md
(what was actually implemented and what was rejected)
   ↓
MASTER-INDEX.md
(current status + roadmap)
   ↓
README-CHAT-ORGANIZATION.md
(how to interpret the rest of planning/)
   ↓
BACKGROUND CHATS
├─ Chat 1: Architecture
├─ Chat 2: Pre-Planning
├─ Chat 3: WBS / Planning
└─ Chat 4: Historical only
   ↓
IMPLEMENT NEXT
├─ Phase 2 execution
├─ Persistence / checkpoints
├─ UI execution loop
└─ Testing
```

## What To Read For What

If you want the current architecture:

- `DECISIONS.md`
- `MASTER-INDEX.md`
- `CHAT-01` to `CHAT-03`

If you want the current implementation roadmap:

- `MASTER-INDEX.md`
- `README-CHAT-ORGANIZATION.md`

If you want historical design context:

- `CHAT-04-ruflo-execution-engine.md`
- `CHAT-05-17-remaining-topics.md`

## Dependency View

```text
Chat 1
  ↓
Chat 2
  ↓
Chat 3
  ↓
Decision log replaces old Chat 4 execution plan
  ↓
Phase 2 implementation work
```

## Current File Map

Repo-current docs:

- `DECISIONS.md`
- `MASTER-INDEX.md`
- `README-CHAT-ORGANIZATION.md`
- `START-HERE.md`

Useful implementation references:

- `planning-with-wbs-guide.md`
- `enhanced-planning-with-wbs.ts`

Historical chat docs:

- `CHAT-01-introduction-architecture.md`
- `CHAT-02-three-phase-architecture.md`
- `CHAT-03-planning-wbs-decomposition.md`
- `CHAT-04-ruflo-execution-engine.md`
- `CHAT-05-17-remaining-topics.md`

## Quick Guidance

- Use Chats 1-3 for concepts.
- Do not use Chat 4 as the execution plan.
- Do not assume every “done” item in older chat docs reflects the repo.
- When in doubt, trust `DECISIONS.md` over every other planning document.
