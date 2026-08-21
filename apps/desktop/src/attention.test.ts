import { deriveAttention, needsAttention, pendingAgentInteraction } from "./attention";
import type { ActivityEvent, OpsState, PaneRuntime } from "./types";

const runtime = (nodeId: string, status: string): PaneRuntime => ({
  nodeId,
  sessionId: `session-${nodeId}`,
  historySessionId: `session-${nodeId}`,
  adapterId: "codex-cli",
  structured: true,
  status,
  transcript: "",
  structuredLines: [],
  messages: [],
});

const opsState: OpsState = {
  version: 2,
  columns: [
    { id: "queued", title: "Ready", role: "queued" },
    { id: "active", title: "Running", role: "active" },
    { id: "review", title: "Verifying", role: "review" },
    { id: "done", title: "Done", role: "done" },
  ],
  cards: [
    {
      id: "task-runtime",
      columnId: "active",
      title: "Fix streaming",
      detail: "",
      assignee: "Codex",
      priority: "normal",
      assigneeIds: ["node-1"],
      agentStatuses: { "node-1": "needs_input" },
      expectedFiles: [],
      lastNote: "",
    },
    {
      id: "task-review",
      columnId: "review",
      title: "Review release",
      detail: "",
      assignee: "Codex",
      priority: "normal",
      assigneeIds: ["node-2"],
      agentStatuses: { "node-2": "completed" },
      expectedFiles: [],
      lastNote: "",
    },
  ],
  prd: "",
  tdd: "",
  eventCursors: {},
};

test("deduplicates runtime and activity attention by its exact destination", () => {
  const runtimes = [runtime("node-1", "needs_input"), runtime("node-2", "completed")];
  runtimes[0].statusSummary = "Answer required";
  const activity: ActivityEvent[] = [{
    id: 1,
    sessionId: "session-node-1",
    seq: 1,
    kind: "agent",
    status: "needs_input",
    message: "Agent asked a question",
    payload: { nodeId: "node-1", taskId: "task-runtime" },
    isRead: false,
    createdAt: "2026-07-29T10:00:00Z",
    nodeId: "node-1",
  }];

  const items = deriveAttention({ runtimes, activity, opsState });

  expect(items).toHaveLength(2);
  expect(items.find((item) => item.title === "Fix streaming")).toMatchObject({
    id: "ops:task-runtime",
    sources: expect.arrayContaining(["ops", "runtime", "activity"]),
    runtimeNodeId: "node-1",
    activityIds: [1],
    target: { kind: "ops", cardId: "task-runtime" },
  });
  expect(items.find((item) => item.title === "Review release")).toMatchObject({
    id: "review:task-review",
    sources: expect.arrayContaining(["ops", "review"]),
    target: { kind: "review", cardId: "task-review" },
  });
});

test("keeps live file-conflict coordination out of the attention inbox", () => {
  const coordinatingState: OpsState = {
    ...opsState,
    cards: [
      { ...opsState.cards[0], id: "task-one", assigneeIds: ["node-1"], expectedFiles: ["src/App.tsx"] },
      { ...opsState.cards[0], id: "task-two", assigneeIds: ["node-2"], expectedFiles: ["src/App.tsx"] },
    ],
  };

  expect(deriveAttention({
    runtimes: [runtime("node-1", "running"), runtime("node-2", "running")],
    activity: [],
    opsState: coordinatingState,
  })).toEqual([]);

  expect(deriveAttention({
    runtimes: [runtime("node-1", "needs_input"), runtime("node-2", "running")],
    activity: [],
    opsState: coordinatingState,
  }).map((item) => item.title)).toEqual(["Fix streaming"]);
});

test("recognizes every actionable status used by the shell", () => {
  expect(["needs_input", "failed", "disconnected", "blocked", "review"].every(needsAttention)).toBe(true);
  expect(needsAttention("completed")).toBe(false);
});

test("finds only the unresolved interaction in the current turn", () => {
  const previous = { id: "old", role: "system", kind: "approval", text: "old" } as const;
  const current = { id: "new", role: "system", kind: "question", text: "new" } as const;
  expect(pendingAgentInteraction([
    previous,
    { id: "answer", role: "user", kind: "message", text: "done" },
    current,
  ])).toEqual(current);
  expect(pendingAgentInteraction([
    previous,
    { id: "answer", role: "user", kind: "message", text: "done" },
    { ...current, interactionState: "answered" },
  ])).toBeUndefined();
});

test("keeps concurrent interactions visible across recorded responses", () => {
  const previous = { id: "first", role: "system", kind: "approval", text: "first" } as const;
  expect(pendingAgentInteraction([
    previous,
    { id: "second", role: "system", kind: "approval", text: "second", interactionState: "approved" },
    { id: "response", role: "user", kind: "interaction_response", text: "Approved" },
  ])).toEqual(previous);
});

test("keeps the owning session on historical pane attention", () => {
  const items = deriveAttention({
    runtimes: [],
    opsState: { ...opsState, cards: [] },
    activity: [{
      id: 2,
      sessionId: "session-other-project",
      seq: 1,
      kind: "agent",
      status: "needs_input",
      message: "Answer required",
      payload: { nodeId: "node-other-project" },
      isRead: false,
      createdAt: "2026-07-29T11:00:00Z",
      nodeId: "node-other-project",
    }],
  });

  expect(items[0]?.target).toEqual({
    kind: "pane",
    nodeId: "node-other-project",
    sessionId: "session-other-project",
  });
});
