---
title: Plan and review
description: Turn project intent into durable specifications, task contracts, isolated worktree lanes, verification, and review evidence.
editUrl: https://github.com/bildhaus/wheeljack/edit/main/docs/guides/plan-and-review.md
---

Plan keeps intent, execution, and proof attached to the same project. Its Floor,
Board, and Spec views are different projections of one durable local plan.

## Establish project documents

Plan can read and manage three project-level documents:

- **PRD:** the user-visible outcome, workflow, constraints, and acceptance criteria.
- **TDD:** architecture, boundaries, implementation strategy, and verification.
- **Kanban:** implementation-ready tasks and their current state.

You can create templates manually or ask a verified structured agent to propose
one document or a coherent bundle. Agent output is staged for review before it
overwrites project files. If files changed on disk during generation, wheeljack
surfaces the conflict instead of silently replacing newer content.

## Write a task contract

A ready task should state:

- the concrete outcome and relevant context;
- constraints and expected files;
- dependencies on other tasks;
- acceptance criteria; and
- exact verification commands or evidence.

Tasks without a complete contract can remain in backlog but should not be routed
as autonomous implementation work.

## Choose an execution lane

For Git repositories, wheeljack can create an isolated task worktree and record
its project-relative lane. This keeps concurrent agents from editing the same
checkout by default. Non-Git projects run in the shared project folder and are
marked as shared rather than pretending isolation exists.

:::caution
A worktree reduces filesystem overlap; it does not make two tasks logically
independent. Declare dependencies and avoid concurrent changes to shared
contracts, migrations, generated files, or release metadata.
:::

## Follow work on Floor and Board

- **Floor** shows active agents, coordination, attention, and the current run graph.
- **Board** organizes backlog, active, review, blocked, and completed task state.
- **Spec** keeps PRD and TDD context close to the tasks derived from them.

Agent coordination requests—message, child task, handoff, or review—flow through
the configured autonomy policy and are recorded in history.

## Verify before review

Run the task's verification commands in its assigned lane. wheeljack records the
run status, output summary, and interruption or failure. A failed or interrupted
verification remains visible and cannot be represented as passing evidence.

## Review evidence

Review compares the implementation against its contract using changed files,
handoff notes, acceptance criteria, and verification results. A reviewer returns
an explicit approve or request-changes verdict. Only completed proof and an
acceptable review should move a task to delivery.

When the lane is no longer needed, use **Remove worktree** from the task menu or
task inspector. Clean lanes close immediately. If the lane has local changes,
wheeljack assigns the existing or a fresh task agent to preserve valuable work
on the task branch and make the lane clean before removal. Delete and archive
requests use the same cleanup queue, so they do not require a separate manual
worktree step.

The **Git** utility panel lists registered worktrees, their branch, path, clean
or dirty state, and any linked Plan task. It also surfaces task lanes whose Git
registration is already missing; reconciling one only detaches stale Plan
metadata and leaves the unregistered filesystem path untouched.
