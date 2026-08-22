import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { OpsRunGraph } from "./RunGraphSurface";
import type { OpsRunGraphModel, OpsRunGraphSelection } from "./opsRunGraph";
import type { CanvasNode, OpsCard } from "./types";

const now = Date.parse("2026-08-11T12:00:00Z");

function card(): OpsCard {
  return {
    id: "task",
    columnId: "active",
    title: "Render the graph",
    detail: "",
    assignee: "Beacon",
    priority: "normal",
    assigneeIds: ["beacon"],
    agentStatuses: {},
    expectedFiles: [],
    lastNote: "",
  };
}

function model(): OpsRunGraphModel {
  const lanes = ["beacon", "osprey", "wren", "kestrel", "marlin", "tern", "swift"].map((id, index) => ({
    id,
    connected: index < 2,
    runtimeStatus: index < 2 ? "running" : undefined,
    latestEvidenceAt: now - index * 1_000,
  }));
  return {
    range: "40m",
    windowStart: now - 40 * 60_000,
    windowEnd: now,
    lanes,
    segments: [{
      id: "segment:task:start",
      taskId: "task",
      runId: "run-1",
      laneId: "beacon",
      eventId: "start",
      startedAt: now - 12 * 60_000,
      endedAt: now - 8 * 60_000,
      recordedStartedAt: now - 12 * 60_000,
      recordedEndedAt: now - 8 * 60_000,
      status: "running",
      tone: "neutral",
      active: false,
      clippedStart: false,
    }],
    nodes: [{
      id: "event:task:start",
      kind: "event",
      taskId: "task",
      taskTitle: "Render the graph",
      laneId: "beacon",
      at: now - 12 * 60_000,
      label: "Assigned to Beacon",
      eventType: "assignment",
      status: "running",
      eventId: "start",
      runId: "run-1",
      tone: "neutral",
    }],
    edges: [],
    currentSignals: [{
      id: "gate:task",
      kind: "approval",
      at: now,
      laneIds: ["beacon"],
      taskIds: ["task"],
      label: "Approval needed: run tests",
      tone: "warning",
    }],
    emptyWindow: false,
  };
}

describe("OpsRunGraph", () => {
  test("renders semantic lanes, keyboard-native controls, truthful event labels, and one aligned overflow region", () => {
    const graph = model();
    const nodes = Object.fromEntries(graph.lanes.map((lane) => [lane.id, { title: lane.id.toUpperCase() } as CanvasNode]));
    const html = renderToStaticMarkup(<OpsRunGraph
      model={graph}
      cards={[card()]}
      agentNodes={nodes}
      onRangeChange={vi.fn()}
      onSelectionChange={vi.fn()}
    />);

    expect(html).toContain("Run Graph");
    expect(html).toContain('role="group" aria-label="Run Graph time range"');
    expect(html).toContain('aria-pressed="true">40m</button>');
    expect(html).toContain('<ol class="wj-run-graph-lanes" aria-label="Agent execution lanes">');
    expect(html).toContain('data-overflow="true"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Render the graph, BEACON, assignment");
    expect(html).toContain("Approval needed: run tests, current");
    expect(html).not.toContain('aria-label="Working"');
    expect(html).toContain('aria-label="Needs input"');
    expect(html).toContain('aria-label="Verified"');
    expect(html).toContain('aria-label="Failed"');
    expect(html).not.toMatch(/cost|eta|utilization|dead time|prediction|inferred step/i);
  });

  test("exposes selected evidence and its causal task path without changing the model", () => {
    const graph = model();
    const selection: OpsRunGraphSelection = { id: "event:task:start", kind: "event", taskIds: ["task"], taskId: "task", eventId: "start", runId: "run-1" };
    const html = renderToStaticMarkup(<OpsRunGraph
      model={graph}
      cards={[card()]}
      agentNodes={{ beacon: { title: "Beacon" } as CanvasNode }}
      selection={selection}
      onRangeChange={vi.fn()}
      onSelectionChange={vi.fn()}
    />);

    expect(html).toContain('class="wj-run-graph-node"');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('data-path="true"');
    expect(graph.nodes[0].id).toBe("event:task:start");
  });

  test("renders embedded graph controls without duplicating visible dashboard chrome", () => {
    const graph = model();
    const html = renderToStaticMarkup(<OpsRunGraph
      embedded
      summary="2 recorded events · 1 current signal · 40m"
      model={graph}
      cards={[card()]}
      agentNodes={{ beacon: { title: "Beacon" } as CanvasNode }}
      onRangeChange={vi.fn()}
      onSelectionChange={vi.fn()}
    />);

    expect(html).toContain('data-embedded="true"');
    expect(html).toContain('<h2 id="run-graph-heading">Run Graph</h2>');
    expect(html).toContain('<span class="wj-section-label">Recorded execution</span>');
    expect(html).toContain("2 recorded events · 1 current signal · 40m");
    expect(html).toContain('aria-label="Run state legend"');
    expect(html).toContain('aria-label="Run Graph time range"');
  });

  test("renders a recorded label after the agent node has been removed", () => {
    const graph = model();
    const removedNodeId = "node_b536ef7ddcb4208ab834f6f8b2d";
    graph.lanes = [{ id: removedNodeId, connected: false, latestEvidenceAt: now }];
    graph.segments = [];
    graph.nodes = [{ ...graph.nodes[0], laneId: removedNodeId }];
    graph.currentSignals = [];
    const html = renderToStaticMarkup(<OpsRunGraph
      model={graph}
      cards={[card()]}
      agentNodes={{}}
      agentLabels={{ [removedNodeId]: "Osprey" }}
      onRangeChange={vi.fn()}
      onSelectionChange={vi.fn()}
    />);

    expect(html).toContain(">Osprey</span>");
    expect(html).not.toContain(`>${removedNodeId}</span>`);
  });

  test("renders a selected current conflict as one knot spanning every affected task", () => {
    const graph = model();
    graph.currentSignals = [{
      id: "conflict:src/shared.ts",
      kind: "conflict",
      at: now,
      laneIds: ["beacon", "osprey"],
      taskIds: ["task", "peer"],
      label: "Current file conflict: src/shared.ts",
      conflictFile: "src/shared.ts",
      tone: "destructive",
    }];
    const selection: OpsRunGraphSelection = { id: "conflict:src/shared.ts", kind: "conflict", taskIds: ["task", "peer"], conflictFile: "src/shared.ts" };
    const html = renderToStaticMarkup(<OpsRunGraph
      model={graph}
      cards={[card()]}
      agentNodes={{ beacon: { title: "Beacon" } as CanvasNode, osprey: { title: "Osprey" } as CanvasNode }}
      selection={selection}
      onRangeChange={vi.fn()}
      onSelectionChange={vi.fn()}
    />);

    expect(html).toContain('class="wj-run-graph-knot-path"');
    expect(html).toContain('data-kind="conflict"');
    expect(html).toContain('aria-label="Current file conflict: src/shared.ts, current');
    expect(html).toContain('data-selected="true"');
  });
});
