import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, test, vi } from "vitest";
import { FloorSurface } from "./ParitySurfaces";
import { deriveOpsFloorModel } from "./opsFloor";
import type { OpsRunGraphModel } from "./opsRunGraph";
import type { ActivityEvent, CanvasNode, OpsCard, OpsState, PaneRuntime } from "./types";

const now = Date.parse("2026-08-19T10:00:00Z");
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
    detail: `${id} objective`,
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
    sessionId: `session-${nodeId}`,
    historySessionId: `history-${nodeId}`,
    adapterId: "codex",
    structured: true,
    protocol: "codex-jsonl",
    status,
    transcript: "",
    structuredLines: [],
    messages: [],
    ...patch,
  };
}

function node(id: string): CanvasNode {
  return {
    id,
    canvasId: "canvas",
    kind: "agent_terminal",
    title: id.replace(/^agent-/, "Agent "),
    x: 0,
    y: 0,
    width: 640,
    height: 480,
    zIndex: 1,
    data: {},
    createdAt: "2026-08-19T09:00:00Z",
    updatedAt: "2026-08-19T10:00:00Z",
  };
}

function runGraph(cardId?: string, conflictFile?: string): OpsRunGraphModel {
  return {
    range: "40m",
    windowStart: now - 40 * 60_000,
    windowEnd: now,
    lanes: [{ id: "agent-approval", connected: true, runtimeStatus: "needs_input", latestEvidenceAt: now }],
    segments: [],
    nodes: cardId ? [{
      id: `event:${cardId}`,
      kind: "event",
      taskId: cardId,
      taskTitle: cardId,
      laneId: "agent-approval",
      at: now - 60_000,
      label: `Assigned ${cardId}`,
      eventType: "assignment",
      eventId: "assignment",
      runId: "run-1",
      status: "running",
      tone: "neutral",
    }] : [],
    edges: [],
    currentSignals: conflictFile ? [{
      id: `conflict:${conflictFile}`,
      kind: "conflict",
      at: now,
      laneIds: ["agent-approval"],
      taskIds: ["conflict-a", "conflict-b"],
      label: `Current file conflict: ${conflictFile}`,
      conflictFile,
      tone: "destructive",
    }] : [],
    emptyWindow: !cardId && !conflictFile,
  };
}

type FloorProps = ComponentProps<typeof FloorSurface>;

function floorProps({
  state,
  runtimes,
  attentionItems = [],
  activity = [],
  graph = runGraph(),
}: {
  state: OpsState;
  runtimes: PaneRuntime[];
  attentionItems?: Parameters<typeof deriveOpsFloorModel>[0]["attentionItems"];
  activity?: ActivityEvent[];
  graph?: OpsRunGraphModel;
}): FloorProps {
  const nodes = Object.fromEntries(runtimes.map((item) => [item.nodeId, node(item.nodeId)]));
  return {
    model: deriveOpsFloorModel({ state, runtimes, attentionItems, activity }),
    state,
    runtimes,
    nodes,
    now,
    runGraphModel: graph,
    runGraphSelection: undefined,
    onRunGraphRange: vi.fn(),
    onRunGraphSelection: vi.fn(),
    autonomousPickup: false,
    autonomousConcurrency: 1,
    maxAutonomousConcurrency: 4,
    onAutonomousPickupChange: vi.fn(),
    onAutonomousConcurrencyChange: vi.fn(),
    onOpenAgentSettings: vi.fn(),
    onInspect: vi.fn(),
    onReview: vi.fn(),
    onOpenRuntime: vi.fn(),
    onResumeRuntime: vi.fn(),
    onRespondRuntime: vi.fn(async () => true),
    onCancelRuntime: vi.fn(async () => true),
    onStartAgent: vi.fn(async () => true),
    steeringCardId: undefined,
    steeringDraft: "",
    onSteeringCardId: vi.fn(),
    onSteeringDraft: vi.fn(),
    onQueueSteering: vi.fn(),
    onCancelSteering: vi.fn(),
    onOpenActivity: vi.fn(),
    onOpenHistory: vi.fn(),
    onAcknowledgeActivity: vi.fn(),
    projectIsRepo: true,
    railWidth: 340,
    onRailWidth: vi.fn(),
  };
}

function state(cards: OpsCard[]): OpsState {
  return { version: 2, columns, cards, prd: "", tdd: "", eventCursors: {} };
}

describe("FloorSurface", () => {
  test("keeps taskless agents visible without a Running now 0 contradiction", () => {
    const props = floorProps({ state: state([]), runtimes: [runtime("agent-idle", "completed")] });
    const { container } = render(<FloorSurface {...props} />);

    expect(screen.getByRole("heading", { name: "Agents" })).toBeTruthy();
    expect(screen.getByText("Available")).toBeTruthy();
    expect(screen.queryByText("0 working / 1 connected")).toBeNull();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Working")).toBeTruthy();
    expect(container.textContent).not.toContain("Running now 0");
  });

  test("collapses empty execution and intervention states while prioritizing the scheduler queue", async () => {
    const user = userEvent.setup();
    const props = floorProps({
      state: state([card("first", "queued"), card("second", "queued")]),
      runtimes: [runtime("agent", "completed")],
    });
    const { container } = render(<FloorSurface {...props} />);

    expect(screen.queryByRole("heading", { name: "Run Graph" })).toBeNull();
    expect(container.querySelector(".wj-floor-clear-strip")).toBeTruthy();
    expect(container.querySelector(".wj-floor-main .wj-floor-activity")).toBeTruthy();
    expect(container.querySelector(".wj-floor-rail .wj-floor-activity")).toBeNull();
    expect(container.querySelector(".wj-floor-queue-row .wj-run-state")).toBeNull();
    expect(screen.getByLabelText("Queue position 1").textContent).toBe("01");
    expect(screen.getByLabelText("Queue position 2").textContent).toBe("02");
    expect(screen.getByText("New starts")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Run Graph/ }));
    expect(screen.getByRole("heading", { name: "Run Graph" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide graph" })).toBeTruthy();
  });

  test("opens agents from their identity and confirms stop from the overflow menu", async () => {
    const user = userEvent.setup();
    const props = floorProps({
      state: state([card("active-task", "active", { assigneeIds: ["agent"] })]),
      runtimes: [runtime("agent", "running", { statusSummary: "Indexing workspace" })],
      graph: { ...runGraph(), emptyWindow: false },
    });
    const { container } = render(<FloorSurface {...props} />);

    expect(screen.getByRole("heading", { name: "Now" })).toBeTruthy();
    expect(screen.getAllByText("Indexing workspace").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('.wj-floor-now-list > button[data-presence-phase="working"]')).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open agent" }));
    expect(props.onOpenRuntime).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Stop now" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "More actions for agent" }));
    await user.click(screen.getByRole("menuitem", { name: "Stop now" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(props.onCancelRuntime).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Stop agent" }));
    expect(props.onCancelRuntime).toHaveBeenCalledOnce();
  });

  test("shows autonomous reconciliation as live work without inventing an agent", async () => {
    const user = userEvent.setup();
    const reconciling = card("reconciling-task", "review", {
      reconciliation: {
        status: "running",
        attempts: 1,
        message: "Converging task changes",
        updatedAt: "2026-08-19T09:59:00Z",
      },
    });
    const props = floorProps({ state: state([reconciling]), runtimes: [] });
    const { container } = render(<FloorSurface {...props} />);

    expect(screen.getByRole("heading", { name: "Now" })).toBeTruthy();
    expect(container.querySelector(".wj-floor-now-reconciler")).toBeTruthy();
    expect(screen.getByText("Converging task changes")).toBeTruthy();
    expect(container.querySelector('.wj-floor-now-list > button[data-presence-phase="reconciling"]')).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /reconciling-task.*Converging task changes/ }));
    expect(container.querySelector('.wj-floor-docked-inspector[data-card-id="reconciling-task"]')).toBeTruthy();
  });

  test("times live work from the current agent run instead of the task's original start", () => {
    const props = floorProps({
      state: state([card("old-task", "active", {
        assigneeIds: ["agent"],
        startedAt: "2026-08-15T07:00:00Z",
      })]),
      runtimes: [runtime("agent", "running", { startedAt: "2026-08-19T09:59:50Z" })],
    });
    const { container } = render(<FloorSurface {...props} />);

    expect(screen.getByText("10s")).toBeTruthy();
    expect(container.textContent).not.toContain("4d 3h");
  });

  test("renders intervention-specific copy, direct actions, and humanized path evidence", () => {
    const cards = [
      card("approval", "active", { assigneeIds: ["agent-approval"], startedAt: "2026-08-19T09:40:00Z" }),
      card("question", "active", { assigneeIds: ["agent-question"] }),
      card("stopped", "active", { assigneeIds: ["agent-stopped"] }),
      card("review-task", "review"),
      card("blocker", "active", { assigneeIds: ["agent-blocker"] }),
      card("dependent", "queued", { dependencyIds: ["blocker"] }),
      card("conflict-a", "active", { assigneeIds: ["agent-a"], expectedFiles: ["shared.ts"] }),
      card("conflict-b", "active", {
        assigneeIds: ["agent-b"],
        expectedFiles: ["shared.ts"],
        steeringDirective: { id: "resolve", text: "Yield shared", createdAt: new Date(now).toISOString(), status: "failed", kind: "file_conflict", conflictFiles: ["shared.ts"] },
      }),
    ];
    const pathRequest = JSON.stringify(["C:\\workspace\\coordination\\agents\\*"]);
    const runtimes = [
      runtime("agent-approval", "needs_input", { messages: [{ id: "approval", role: "assistant", kind: "approval", text: pathRequest, interactionState: "pending" }] }),
      runtime("agent-question", "needs_input", { messages: [{ id: "question", role: "assistant", kind: "question", text: "Which scope?", interactionState: "pending" }] }),
      runtime("agent-stopped", "failed"),
      runtime("agent-blocker", "running"),
      runtime("agent-a", "running"),
      runtime("agent-b", "running"),
    ];
    const attentionItems = [
      { id: "approval", sources: ["runtime"], title: "approval", detail: pathRequest, status: "needs_input", target: { kind: "ops", cardId: "approval" }, runtimeNodeId: "agent-approval", activityIds: [] },
      { id: "question", sources: ["runtime"], title: "question", detail: "Which scope?", status: "needs_input", target: { kind: "ops", cardId: "question" }, runtimeNodeId: "agent-question", activityIds: [] },
      { id: "stopped", sources: ["runtime"], title: "stopped", detail: "Process exited", status: "failed", target: { kind: "ops", cardId: "stopped" }, runtimeNodeId: "agent-stopped", activityIds: [] },
      { id: "review", sources: ["review"], title: "review-task", detail: "Evidence ready", status: "review", target: { kind: "review", cardId: "review-task" }, activityIds: [] },
    ] as Parameters<typeof deriveOpsFloorModel>[0]["attentionItems"];

    render(<FloorSurface {...floorProps({ state: state(cards), runtimes, attentionItems })} />);

    for (const heading of ["Permission requested", "Response needed", "Agent stopped", "Review ready", "Automatic ownership resolution stalled"]) {
      expect(screen.getAllByText(heading).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Access to 1 path · …\\agents\\*")).toBeTruthy();
    for (const action of [/Approve/, /Deny/, /Answer in chat/, /Recover/, /Review evidence/, /Choose owner/]) {
      expect(screen.getAllByRole("button", { name: action }).length).toBeGreaterThan(0);
    }
  });

  test("opens graph evidence in the inspector, restores focus on close, and returns conflicts to the rail", async () => {
    const user = userEvent.setup();
    const cards = [
      card("approval", "active", { assigneeIds: ["agent-approval"] }),
      card("conflict-a", "active", { assigneeIds: ["agent-a"], expectedFiles: ["shared.ts"] }),
      card("conflict-b", "active", {
        assigneeIds: ["agent-b"],
        expectedFiles: ["shared.ts"],
        steeringDirective: { id: "resolve", text: "Yield shared", createdAt: new Date(now).toISOString(), status: "failed", kind: "file_conflict", conflictFiles: ["shared.ts"] },
      }),
    ];
    const runtimes = [runtime("agent-approval", "running"), runtime("agent-a", "running"), runtime("agent-b", "running")];
    const props = floorProps({ state: state(cards), runtimes, graph: runGraph("approval", "shared.ts") });
    const { container } = render(<FloorSurface {...props} />);
    const taskButton = container.querySelector<HTMLButtonElement>('.wj-floor-task-title');
    expect(taskButton).toBeTruthy();

    await user.click(taskButton!);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Inspector" })));
    await user.click(screen.getByRole("button", { name: "Close task inspector" }));
    await waitFor(() => expect(document.activeElement).toBe(taskButton));

    const graphEvent = container.querySelector<HTMLButtonElement>(".wj-run-graph-node");
    expect(graphEvent).toBeTruthy();
    fireEvent.click(graphEvent!);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Inspector" })).toBeTruthy());

    const conflictSignal = container.querySelector<HTMLButtonElement>('.wj-run-graph-signal[data-kind="conflict"]');
    expect(conflictSignal).toBeTruthy();
    fireEvent.click(conflictSignal!);
    const conflictRow = await waitFor(() => container.querySelector<HTMLElement>('[data-conflict-file="shared.ts"]'));
    await waitFor(() => expect(document.activeElement).toBe(conflictRow));
    expect(screen.getByRole("heading", { name: "Exceptions" })).toBeTruthy();
  });

  test("opens the existing history activity surface from recent activity", async () => {
    const user = userEvent.setup();
    const event: ActivityEvent = {
      id: 1,
      sessionId: "session-agent",
      seq: 1,
      kind: "status",
      status: "completed",
      message: "Task completed",
      payload: { taskId: "task" },
      isRead: false,
      createdAt: "2026-08-19T09:59:00Z",
      nodeId: "agent",
      nodeTitle: "Agent",
    };
    const task = card("task", "done", { assigneeIds: ["agent"] });
    const props = floorProps({ state: state([task]), runtimes: [runtime("agent", "completed")], activity: [event] });
    render(<FloorSurface {...props} />);

    await user.click(screen.getByRole("button", { name: "View history" }));
    expect(props.onOpenHistory).toHaveBeenCalledOnce();
  });

  test("keeps a status column when routine activity omits its indicator", () => {
    const event: ActivityEvent = {
      id: 1,
      sessionId: "session-agent",
      seq: 1,
      kind: "status",
      status: "running",
      message: "Applying the requested changes",
      payload: { taskId: "task" },
      isRead: false,
      createdAt: "2026-08-19T09:59:00Z",
      nodeId: "agent",
      nodeTitle: "Agent",
    };
    const props = floorProps({
      state: state([card("task", "active", { assigneeIds: ["agent"] })]),
      runtimes: [runtime("agent", "running")],
      activity: [event],
    });
    const { container } = render(<FloorSurface {...props} />);

    const row = container.querySelector<HTMLButtonElement>(".wj-floor-activity-scroll article > button:first-child");
    expect(row?.children).toHaveLength(3);
    expect(row?.firstElementChild?.classList.contains("wj-floor-activity-status")).toBe(true);
    expect(row?.firstElementChild?.children).toHaveLength(0);
    expect(row?.children[1]?.textContent).toBe("AgentApplying the requested changes");
  });
});
