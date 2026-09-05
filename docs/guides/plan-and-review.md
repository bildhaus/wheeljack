---
title: Plan and reconcile
description: Turn project intent into autonomous execution, durable task reports, and safely reconciled worktree changes.
editUrl: https://github.com/bildhaus/wheeljack/edit/main/docs/guides/plan-and-review.md
---

:::note
The workflow improvements described here apply to wheeljack 0.1.14 and later.
:::

wheeljack keeps intent, execution, and proof attached to the same project. **Run**
is the operational view of the swarm; **Plan** is the durable task model; and
**Spec** keeps the PRD and TDD beside the work derived from them.

## Establish project documents

Plan can read and manage three project-level documents:

- **PRD:** the user-visible outcome, workflow, constraints, and acceptance criteria.
- **TDD:** architecture, boundaries, implementation strategy, and verification.
- **Plan:** implementation-ready tasks, relationships, and their current state.

You can create templates manually or ask a verified structured agent to propose
one document or a coherent bundle. Agent output is staged for review before it
overwrites project files. If files changed on disk during generation, wheeljack
surfaces the conflict instead of silently replacing newer content.

**Add starter tasks** inserts a small set of generic checklist cards without
deriving them from the PRD/TDD. Repeating the action does not add duplicate starter
cards. Edit these into complete task contracts or ask an agent for document-specific
proposals before assigning implementation work.

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

## Operate the swarm from Run

- **Run** shows active agents, current execution, reconciliation, and exceptions
  that actually need intervention.
- **Plan** organizes planned, running, reconciling, intervention, and completed
  task state. Its default list emphasizes outcomes rather than card shuffling;
  the status projection is available when you need it.
- **Spec** keeps PRD and TDD context close to the tasks derived from them.

Agent coordination requests—messages, child tasks, and handoffs—flow through the
configured autonomy policy and are recorded in history. Relationships are soft
by default, so they share context without serializing work. Mark a relationship
hard only when the downstream task truly cannot start first.

## Report and reconcile

Each worker is responsible for checking its own work and reporting the commands,
evidence, risks, and outcome it produced. That report is durable task evidence;
it does not automatically create a second verification or reviewer task.

The reconciler then advances the result:

- shared-checkout or no-change work can complete directly from the report;
- committed task-worktree changes are integrated idempotently into the opened
  project branch;
- uncommitted source changes or integration conflicts are returned to a worker
  for autonomous repair; and
- target-checkout changes, exhausted recovery, or explicit human-acceptance
  policy appear as an intervention instead of stalling the entire swarm.

Failed agents and temporary launch errors retry only their own task with bounded
backoff. Other eligible work continues to run.

After integration, wheeljack automatically removes the clean task worktree while
preserving its branch. If a lane is still dirty, it assigns the existing or a
fresh task agent to preserve valuable work and make the lane safe to remove.
Delete and archive requests use the same cleanup queue, so they do not require a
separate manual worktree step.

The **Git** utility panel lists registered worktrees, their branch, path, clean
or dirty state, and any linked Plan task. It also surfaces task lanes whose Git
registration is already missing; reconciling one only detaches stale Plan
metadata and leaves the unregistered filesystem path untouched.
