import { describe, expect, test } from "vitest";
import type { AttentionItem } from "./attention";
import { deriveOpsRunGraphModel } from "./opsRunGraph";
import type { OpsCard, OpsState, PaneRuntime } from "./types";

const columns: OpsState["columns"] = [
  { id: "ready", title: "Ready", role: "queued" },
  { id: "active", title: "Active", role: "active" },
  { id: "review", title: "Review", role: "review" },
  { id: "done", title: "Done", role: "done" },
];

function card(id: string, patch: Partial<OpsCard> = {}): OpsCard {
  return {
    id,
    columnId: "active",
    title: id,
    detail: "",
    assignee: "Unassigned",
    priority: "normal",
    assigneeIds: [],
    agentStatuses: {},
    expectedFiles: [],
    lastNote: "",
    ...patch,
  };
}

function state(cards: OpsCard[]): OpsState {
  return { version: 2, columns, cards, prd: "", tdd: "", eventCursors: {} };
}

function runtime(nodeId: string, status = "running", patch: Partial<PaneRuntime> = {}): PaneRuntime {
  return {
    nodeId,
    sessionId: `session-${nodeId}`,
    historySessionId: `history-${nodeId}`,
    adapterId: "codex",
    structured: true,
    status,
    transcript: "",
    structuredLines: [],
    messages: [],
    ...patch,
  };
}

const now = Date.parse("2026-08-11T12:00:00Z");

describe("deriveOpsRunGraphModel", () => {
  test("clips recorded segments to the range and extends only a matching live run", () => {
    const active = card("active", {
      assigneeIds: ["beacon"],
      runProgress: { runId: "run-live", updatedAt: "2026-08-11T11:58:00Z", steps: [] },
      events: [
        { id: "before", kind: "assignment", timestamp: "2026-08-11T11:47:00Z", message: "Assigned", callsign: "beacon", runId: "run-live", status: "running" },
      ],
    });
    const isolated = card("isolated", {
      assigneeIds: ["osprey"],
      events: [
        { id: "point", kind: "update", timestamp: "2026-08-11T11:57:00Z", message: "Looked around", callsign: "osprey", runId: "run-point", status: "paused" },
      ],
    });
    const model = deriveOpsRunGraphModel({
      state: state([active, isolated]),
      runtimes: [runtime("beacon"), runtime("osprey", "completed")],
      attentionItems: [],
      conflicts: [],
      now,
      range: "10m",
    });

    expect(model.segments).toEqual([
      expect.objectContaining({ taskId: "active", startedAt: now - 10 * 60_000, endedAt: now, active: true, clippedStart: true }),
    ]);
    expect(model.nodes.map((node) => node.taskId)).toEqual(["isolated"]);
    expect(model.segments.some((segment) => segment.taskId === "isolated")).toBe(false);
  });

  test("keeps interleaved agents with the same run id in separate truthful lanes", () => {
    const task = card("pair", {
      assigneeIds: ["beacon", "osprey"],
      events: [
        { id: "b1", kind: "update", timestamp: "2026-08-11T11:30:00Z", message: "Beacon started", callsign: "beacon", runId: "shared", status: "running" },
        { id: "o1", kind: "update", timestamp: "2026-08-11T11:31:00Z", message: "Osprey started", callsign: "osprey", runId: "shared", status: "running" },
        { id: "b2", kind: "pause", timestamp: "2026-08-11T11:34:00Z", message: "Beacon paused", callsign: "beacon", runId: "shared", status: "paused" },
        { id: "o2", kind: "completion", timestamp: "2026-08-11T11:38:00Z", message: "Osprey done", callsign: "osprey", runId: "shared", status: "completed" },
      ],
    });
    const model = deriveOpsRunGraphModel({ state: state([task]), runtimes: [], attentionItems: [], conflicts: [], now, range: "40m" });

    expect(model.segments.map((segment) => [segment.laneId, segment.recordedStartedAt, segment.recordedEndedAt])).toEqual([
      ["beacon", Date.parse("2026-08-11T11:30:00Z"), Date.parse("2026-08-11T11:34:00Z")],
      ["osprey", Date.parse("2026-08-11T11:31:00Z"), Date.parse("2026-08-11T11:38:00Z")],
    ]);
    expect(model.lanes.map((lane) => lane.id)).toEqual(["osprey", "beacon"]);
  });

  test("derives only explicit handoffs, dependency stitches, verification nodes, and current signals", () => {
    const prerequisite = card("prerequisite", {
      assigneeIds: ["beacon"],
      columnId: "done",
      events: [
        { id: "dep-done", kind: "completion", timestamp: "2026-08-11T11:25:00Z", message: "Completed", callsign: "beacon", runId: "dep-run", status: "completed" },
      ],
    });
    const dependent = card("dependent", {
      assigneeIds: ["osprey"],
      dependencyIds: ["prerequisite"],
      events: [
        { id: "start", kind: "assignment", timestamp: "2026-08-11T11:28:00Z", message: "Started", callsign: "osprey", runId: "task-run", status: "running" },
        { id: "handoff", kind: "handoff", timestamp: "2026-08-11T11:35:00Z", message: "Transferred", callsign: "osprey", targetId: "wren", runId: "task-run", status: "running" },
      ],
      verificationRun: {
        sessionId: "verify-1",
        command: "bun test",
        worktreePath: "C:/work",
        cwd: "C:/work",
        baseCommit: "abc",
        status: "passed",
        startedAt: "2026-08-11T11:40:00Z",
        endedAt: "2026-08-11T11:42:00Z",
      },
    });
    const conflictPeer = card("peer", { assigneeIds: ["wren"] });
    const approval: AttentionItem = {
      id: "ops:dependent",
      sources: ["runtime"],
      title: "dependent",
      detail: "Allow the command?",
      status: "needs_input",
      target: { kind: "ops", cardId: "dependent" },
      runtimeNodeId: "osprey",
      activityIds: [],
      createdAt: "2026-08-11T11:44:00Z",
    };
    const model = deriveOpsRunGraphModel({
      state: state([prerequisite, dependent, conflictPeer]),
      runtimes: [runtime("osprey", "needs_input", { messages: [{ id: "ask", role: "assistant", kind: "approval", text: "Allow the command?", interactionState: "pending" }] })],
      attentionItems: [approval],
      conflicts: [{ file: "src/shared.ts", cardIds: ["dependent", "peer"] }],
      now,
      range: "40m",
    });

    expect(model.edges.map((edge) => edge.kind)).toEqual(["dependency", "handoff"]);
    expect(model.edges.find((edge) => edge.kind === "handoff")).toMatchObject({ fromLaneId: "osprey", toLaneId: "wren", taskIds: ["dependent"] });
    expect(model.nodes.filter((node) => node.kind === "verification").map((node) => node.status)).toEqual(["running", "passed"]);
    expect(model.currentSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "approval", tone: "warning", taskIds: ["dependent"] }),
      expect.objectContaining({ kind: "conflict", tone: "destructive", taskIds: ["dependent", "peer"], conflictFile: "src/shared.ts", at: now }),
    ]));
  });

  test("ignores malformed and unscoped evidence while retaining connected lanes in an empty window", () => {
    const task = card("task", {
      events: [
        { id: "bad-time", kind: "update", timestamp: "not-a-time", message: "Bad", callsign: "ghost", runId: "run", status: "running" },
        { id: "no-run", kind: "update", timestamp: "2026-08-11T11:59:00Z", message: "No run", callsign: "ghost", status: "running" },
        { id: "no-agent", kind: "update", timestamp: "2026-08-11T11:59:30Z", message: "No agent", runId: "run", status: "running" },
      ],
    });
    const model = deriveOpsRunGraphModel({ state: state([task]), runtimes: [runtime("beacon", "idle")], attentionItems: [], conflicts: [], now, range: "10m" });

    expect(model.lanes).toEqual([expect.objectContaining({ id: "beacon", connected: true })]);
    expect(model.nodes).toEqual([]);
    expect(model.segments).toEqual([]);
    expect(model.edges).toEqual([]);
    expect(model.emptyWindow).toBe(true);
    expect(Object.keys(model)).not.toEqual(expect.arrayContaining(["cost", "eta", "utilization", "deadTime", "prediction", "steps"]));
  });

  test("orders connected runtimes first and event-only lanes by latest evidence", () => {
    const task = card("task", {
      events: [
        { id: "old", kind: "update", timestamp: "2026-08-11T11:30:00Z", message: "Old", callsign: "kestrel", runId: "run-k", status: "paused" },
        { id: "new", kind: "update", timestamp: "2026-08-11T11:50:00Z", message: "New", callsign: "wren", runId: "run-w", status: "paused" },
      ],
    });
    const model = deriveOpsRunGraphModel({
      state: state([task]),
      runtimes: [runtime("beacon", "idle"), runtime("osprey", "idle")],
      attentionItems: [],
      conflicts: [],
      now,
      range: "40m",
    });

    expect(model.lanes.map((lane) => lane.id)).toEqual(["beacon", "osprey", "wren", "kestrel"]);
  });
});
