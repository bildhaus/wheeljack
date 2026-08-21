import {
  applyOpsOrchestration,
  parseOpsState,
  rollbackOptimisticOpsAgentStart,
} from "./App";

test("moves a task immediately while its fresh agent starts and rolls back a failed launch", () => {
  const before = parseOpsState({
    version: 2,
    cards: [{
      id: "task-1",
      title: "Start optimistically",
      detail: "The board should not wait for process startup.",
      columnId: "queued",
    }],
  });
  const timestamp = "2026-08-20T12:00:00Z";
  const nodeId = "node-starting";
  const eventId = `manual:assign:${timestamp}:${nodeId}`;

  const starting = applyOpsOrchestration(before, "task-1", "assign", nodeId, "Codex 1", timestamp);
  expect(starting.cards[0]).toMatchObject({
    columnId: "active",
    assignee: "Codex 1",
    assigneeIds: [nodeId],
  });

  const rolledBack = rollbackOptimisticOpsAgentStart(starting, before.cards[0], nodeId, eventId, "worker");
  expect(rolledBack.cards[0]).toEqual(before.cards[0]);
});

test("does not roll back a newer card transition after an agent launch fails", () => {
  const before = parseOpsState({
    version: 2,
    cards: [{ id: "task-1", title: "Keep newer state", columnId: "queued" }],
  });
  const timestamp = "2026-08-20T12:00:00Z";
  const nodeId = "node-starting";
  const eventId = `manual:assign:${timestamp}:${nodeId}`;
  const starting = applyOpsOrchestration(before, "task-1", "assign", nodeId, "Codex 1", timestamp);
  const movedAgain = applyOpsOrchestration(starting, "task-1", "review", undefined, undefined, "2026-08-20T12:00:01Z");

  expect(rollbackOptimisticOpsAgentStart(movedAgain, before.cards[0], nodeId, eventId, "worker")).toEqual(movedAgain);
});

test("preserves a task lane created while an optimistic agent launch was pending", () => {
  const before = parseOpsState({
    version: 2,
    cards: [{ id: "task-1", title: "Create a lane", columnId: "queued" }],
  });
  const timestamp = "2026-08-20T12:00:00Z";
  const nodeId = "node-starting";
  const eventId = `manual:assign:${timestamp}:${nodeId}`;
  const starting = applyOpsOrchestration(before, "task-1", "assign", nodeId, "Codex 1", timestamp);
  const withLane = {
    ...starting,
    cards: starting.cards.map((card) => card.id === "task-1" ? {
      ...card,
      taskLane: {
        kind: "git-worktree" as const,
        worktreePath: "C:\\repo-task",
        cwd: "C:\\repo-task",
        branch: "wheeljack/task-1",
        baseCommit: "a".repeat(40),
      },
      events: [...(card.events ?? []), {
        id: "manual:task-lane:2026-08-20T12:00:01Z",
        kind: "update" as const,
        timestamp: "2026-08-20T12:00:01Z",
        message: "Created task worktree wheeljack/task-1",
      }],
    } : card),
  };

  const rolledBack = rollbackOptimisticOpsAgentStart(withLane, before.cards[0], nodeId, eventId, "worker");
  expect(rolledBack.cards[0]).toMatchObject({
    columnId: "queued",
    assignee: "Unassigned",
    assigneeIds: [],
    taskLane: { branch: "wheeljack/task-1" },
  });
  expect(rolledBack.cards[0].events?.map((event) => event.id)).toEqual([
    "manual:task-lane:2026-08-20T12:00:01Z",
  ]);
});
