import { describe, expect, test } from "vitest";
import { deriveOpsFloorModel } from "./opsFloor";
import type { ActivityEvent, OpsCard, OpsState, PaneRuntime } from "./types";

const columns: OpsState["columns"] = [
  { id: "queued", title: "Ready", role: "queued" },
  { id: "active", title: "Active", role: "active" },
  { id: "review", title: "Review", role: "review" },
  { id: "done", title: "Done", role: "done" },
];

function card(id: string, columnId: string, patch: Partial<OpsCard> = {}): OpsCard {
  return {
    id,
    columnId,
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

function runtime(nodeId: string, status: string, patch: Partial<PaneRuntime> = {}): PaneRuntime {
  return {
    nodeId,
    adapterId: "codex",
    protocol: "codex-jsonl",
    structured: true,
    status,
    messages: [],
    ...patch,
  } as PaneRuntime;
}

describe("deriveOpsFloorModel", () => {
  test("keeps resolved activity in history without leaving stale Floor interventions", () => {
    const state: OpsState = {
      version: 2,
      columns,
      prd: "",
      tdd: "",
      eventCursors: {},
      cards: [
        card("recovered", "active", { assigneeIds: ["recovered-agent"] }),
        card("waiting", "active", { assigneeIds: ["waiting-agent"] }),
      ],
    };
    const runtimes = [
      runtime("recovered-agent", "running"),
      runtime("waiting-agent", "needs_input", {
        messages: [{ id: "question", role: "assistant", kind: "question", text: "Choose scope" }],
      }),
    ];
    const events: ActivityEvent[] = [
      { id: 1, sessionId: "recovered-session", seq: 1, kind: "status", status: "failed", message: "Session failed", payload: { taskId: "recovered" }, isRead: false, createdAt: "2026-08-19T09:00:00Z", nodeId: "recovered-agent" },
      { id: 2, sessionId: "waiting-session", seq: 1, kind: "question", status: "needs_input", message: "Choose scope", payload: { taskId: "waiting" }, isRead: false, createdAt: "2026-08-19T10:00:00Z", nodeId: "waiting-agent" },
    ];
    const attentionItems = [
      { id: "ops:recovered", sources: ["activity"], title: "recovered", detail: "Session failed", status: "failed", target: { kind: "ops", cardId: "recovered" }, runtimeNodeId: "recovered-agent", activityIds: [1] },
      { id: "ops:waiting", sources: ["runtime", "activity"], title: "waiting", detail: "Choose scope", status: "needs_input", target: { kind: "ops", cardId: "waiting" }, runtimeNodeId: "waiting-agent", activityIds: [2] },
    ] as Parameters<typeof deriveOpsFloorModel>[0]["attentionItems"];

    const model = deriveOpsFloorModel({ state, runtimes, attentionItems, activity: events });

    expect(model.actionQueue.map((action) => action.id)).toEqual(["ops:waiting"]);
    expect(model.running.map((task) => task.card.id)).toEqual(["recovered"]);
    expect(model.recentActivity.map((event) => event.id)).toEqual([2, 1]);
    expect(model.sinceLeft.actionable.map((event) => event.id)).toEqual([2, 1]);
  });

  test("ranks interactions, conflicts, runtime failures, reviews, then dependency waits", () => {
    const state: OpsState = {
      version: 2,
      columns,
      prd: "",
      tdd: "",
      eventCursors: {},
      cards: [
        card("question", "active", { assigneeIds: ["a-question"] }),
        card("conflict", "active", { assigneeIds: ["a-conflict"], expectedFiles: ["src/shared.ts"] }),
        card("conflict-peer", "active", {
          assigneeIds: ["a-peer"],
          expectedFiles: ["src/shared.ts"],
          steeringDirective: {
            id: "resolve-conflict",
            text: "Yield shared",
            createdAt: "2026-08-19T10:00:00Z",
            status: "failed",
            kind: "file_conflict",
            conflictFiles: ["src/shared.ts"],
          },
        }),
        card("failed", "active", { assigneeIds: ["a-failed"] }),
        card("review", "review"),
        card("blocker", "active", { assigneeIds: ["a-blocker"] }),
        card("waiting", "queued", { dependencyIds: ["blocker"] }),
      ],
    };
    const runtimes = [
      runtime("a-question", "needs_input", { messages: [{ id: "q", role: "assistant", kind: "question", text: "Choose scope" }] }),
      runtime("a-conflict", "running"),
      runtime("a-peer", "running"),
      runtime("a-failed", "failed"),
      runtime("a-blocker", "running"),
    ];
    const attentionItems = [
      { id: "ops:question", sources: ["runtime"], title: "question", detail: "Choose scope", status: "needs_input", target: { kind: "ops", cardId: "question" }, runtimeNodeId: "a-question", activityIds: [] },
      { id: "ops:conflict", sources: ["ops"], title: "conflict", detail: "Claim conflict", status: "attention", target: { kind: "ops", cardId: "conflict" }, activityIds: [] },
      { id: "ops:failed", sources: ["runtime"], title: "failed", detail: "Agent failed", status: "failed", target: { kind: "ops", cardId: "failed" }, runtimeNodeId: "a-failed", activityIds: [] },
      { id: "review:review", sources: ["review"], title: "review", detail: "Ready for review", status: "review", target: { kind: "review", cardId: "review" }, activityIds: [] },
    ] as Parameters<typeof deriveOpsFloorModel>[0]["attentionItems"];

    const model = deriveOpsFloorModel({ state, runtimes, attentionItems, activity: [] });
    expect(model.attention.map((item) => item.kind)).toEqual(["interaction", "conflict", "runtime", "review", "dependency"]);
    expect(model.contentions).toEqual([{ file: "src/shared.ts", cardIds: ["conflict", "conflict-peer"] }]);
    expect(model.actionQueue.map((action) => action.type === "contention" ? action.type : action.item.kind)).toEqual([
      "interaction",
      "contention",
      "runtime",
      "review",
      "dependency",
    ]);
    expect(model.actionQueue.filter((action) => action.type === "contention")).toHaveLength(1);
    expect(model.attention.at(-1)?.reason).toContain("blocker");
  });

  test("keeps live automatically resolving file overlaps out of the action queue", () => {
    const state: OpsState = {
      version: 2,
      columns,
      prd: "",
      tdd: "",
      eventCursors: {},
      cards: [
        card("owner", "active", { assigneeIds: ["owner-agent"], expectedFiles: ["src/shared.ts"], priority: "high" }),
        card("yielding", "active", {
          assigneeIds: ["yielding-agent"],
          expectedFiles: ["src/shared.ts"],
          steeringDirective: {
            id: "auto-resolve",
            text: "Yield shared",
            createdAt: "2026-08-19T10:00:00Z",
            status: "queued",
            kind: "file_conflict",
            conflictFiles: ["src/shared.ts"],
          },
        }),
      ],
    };
    const model = deriveOpsFloorModel({
      state,
      runtimes: [runtime("owner-agent", "running"), runtime("yielding-agent", "running")],
      attentionItems: [{
        id: "ops:yielding",
        sources: ["ops"],
        title: "yielding",
        detail: "Overlapping file claims",
        status: "attention",
        target: { kind: "ops", cardId: "yielding" },
        activityIds: [],
      }],
      activity: [],
    });

    expect(model.contentions).toEqual([{ file: "src/shared.ts", cardIds: ["owner", "yielding"] }]);
    expect(model.actionQueue).toEqual([]);
    expect(model.running.map((task) => task.card.id)).toEqual(["owner", "yielding"]);
  });

  test("separates active, dependency-ready, completed, and unread project activity without fabricated telemetry", () => {
    const state: OpsState = {
      version: 2,
      columns,
      prd: "",
      tdd: "",
      eventCursors: {},
      cards: [
        card("active", "active", { assigneeIds: ["agent"], startedAt: "2026-08-11T10:00:00Z", lastNote: "Running tests" }),
        card("ready", "queued"),
        card("done", "done", { completedAt: "2026-08-11T11:00:00Z" }),
      ],
    };
    const events: ActivityEvent[] = [
      { id: 1, sessionId: "s", seq: 1, kind: "status", status: "failed", message: "Needs help", payload: { taskId: "active" }, isRead: false, createdAt: "2026-08-11T11:01:00Z", nodeId: "agent" },
      { id: 2, sessionId: "s", seq: 2, kind: "status", status: "completed", message: "Finished", payload: { taskId: "done" }, isRead: false, createdAt: "2026-08-11T11:02:00Z", nodeId: "agent" },
      { id: 3, sessionId: "other", seq: 1, kind: "status", status: "failed", message: "Other project", payload: { taskId: "other" }, isRead: false, createdAt: "2026-08-11T11:03:00Z", nodeId: "other" },
    ];
    const model = deriveOpsFloorModel({ state, runtimes: [runtime("agent", "running", { statusSummary: "Running tests" })], attentionItems: [], activity: events });

    expect(model.running.map((item) => item.card.id)).toEqual(["active"]);
    expect(model.ready.map((item) => item.card.id)).toEqual(["ready"]);
    expect(model.recentActivity.map((event) => event.id)).toEqual([2, 1]);
    expect(model.connectedAgents).toBe(1);
    expect(model.workingAgents).toBe(1);
    expect(model.agents).toEqual([expect.objectContaining({ id: "agent", state: "working", task: expect.objectContaining({ card: expect.objectContaining({ id: "active" }) }), currentAction: "Running tests" })]);
    const genericWorking = deriveOpsFloorModel({ state, runtimes: [runtime("agent", "running", { statusSummary: "Agent is working..." })], attentionItems: [], activity: events });
    expect(genericWorking.running[0].currentAction).toBe("Running tests");
    expect(genericWorking.agents[0].currentAction).toBe("Running tests");
    expect(model.nextAutonomousTask?.card.id).toBe("ready");
    expect(model.actionQueue).toEqual([]);
    expect(model.sinceLeft.actionable.map((event) => event.id)).toEqual([1]);
    expect(model.sinceLeft.updates.map((event) => event.id)).toEqual([2]);
    expect(Object.keys(model)).not.toEqual(
      expect.arrayContaining(["cost", "eta", "utilization", "prediction"]),
    );
  });

  test("derives agent roster states and groups unread activity by recorded outcome", () => {
    const state: OpsState = {
      version: 2,
      columns,
      prd: "",
      tdd: "",
      eventCursors: {},
      cards: [
        card("working", "active", { assigneeIds: ["worker"] }),
        card("blocked", "active", { assigneeIds: ["blocked-agent"] }),
      ],
    };
    const events: ActivityEvent[] = [
      { id: 1, sessionId: "s", seq: 1, kind: "status", status: "completed", message: "Task completed", payload: { taskId: "working" }, isRead: false, createdAt: "2026-08-11T11:05:00Z", nodeId: "worker" },
      { id: 2, sessionId: "s", seq: 2, kind: "agent_control", status: "running", message: "Task handed off to reviewer", payload: { taskId: "working" }, isRead: false, createdAt: "2026-08-11T11:04:00Z", nodeId: "worker" },
      { id: 3, sessionId: "s", seq: 3, kind: "coordination", status: "running", message: "Released overlapping file claims", payload: { taskId: "working" }, isRead: false, createdAt: "2026-08-11T11:03:00Z", nodeId: "worker" },
    ];
    const model = deriveOpsFloorModel({
      state,
      runtimes: [
        runtime("worker", "running", { statusSummary: "Writing code" }),
        runtime("blocked-agent", "needs_input", { statusSummary: "Waiting for scope" }),
        runtime("idle", "completed", { statusSummary: "Turn completed" }),
        runtime("offline", "disconnected"),
      ],
      attentionItems: [],
      activity: events,
    });

    expect(model.agents.map((agent) => [agent.id, agent.state])).toEqual([
      ["blocked-agent", "attention"],
      ["worker", "working"],
      ["idle", "idle"],
      ["offline", "unavailable"],
    ]);
    expect(model.agents.find((agent) => agent.id === "blocked-agent")?.task?.card.id).toBe("blocked");
    expect(model.agents.find((agent) => agent.id === "idle")?.task).toBeUndefined();
    expect(model.connectedAgents).toBe(3);
    expect(model.sinceLeft.groups.map((group) => group.outcome)).toEqual(["completed", "handoff", "conflict"]);
    expect(model.sinceLeft.groups.flatMap((group) => group.events.map((event) => event.id))).toEqual([1, 2, 3]);
  });

});
