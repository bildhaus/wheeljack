import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AgentAvatar } from "./AgentAvatar";
import { RunStateBadge } from "./RunStateBadge";
import { resolveRunState } from "./runState";
import type { CanvasNode, OpsCard } from "./types";
import type {
  OpsRunGraphCurrentSignal,
  OpsRunGraphModel,
  OpsRunGraphNode,
  OpsRunGraphRange,
  OpsRunGraphSegment,
  OpsRunGraphSelection,
} from "./opsRunGraph";

const laneHeight = 28;
const axisHeight = 20;
const svgWidth = 1000;
const labelWidth = 180;
const railWidth = svgWidth - labelWidth;
const ranges: OpsRunGraphRange[] = ["10m", "40m", "4h"];

interface PositionedStyle extends CSSProperties {
  "--wj-run-x"?: string;
  "--wj-run-span"?: string;
  "--wj-run-y"?: string;
}

export function OpsRunGraph({
  model,
  cards,
  agentNodes,
  agentLabels = {},
  selection,
  onRangeChange,
  onSelectionChange,
  embedded = false,
  summary,
  onCollapse,
}: {
  model: OpsRunGraphModel;
  cards: OpsCard[];
  agentNodes: Record<string, CanvasNode>;
  agentLabels?: Record<string, string>;
  selection?: OpsRunGraphSelection;
  onRangeChange: (range: OpsRunGraphRange) => void;
  onSelectionChange: (selection?: OpsRunGraphSelection) => void;
  embedded?: boolean;
  summary?: string;
  onCollapse?: () => void;
}) {
  const [announcement, setAnnouncement] = useState(`Run Graph range: ${rangeLabel(model.range)}.`);
  const cardTitleById = useMemo(() => new Map(cards.map((card) => [card.id, card.title])), [cards]);
  const agentLabelById = useMemo(() => new Map([
    ...Object.entries(agentLabels),
    ...Object.entries(agentNodes).map(([id, node]) => [id, node.title || id] as const),
  ]), [agentLabels, agentNodes]);
  const laneIndex = useMemo(() => new Map(model.lanes.map((lane, index) => [lane.id, index])), [model.lanes]);
  const selectedTaskIds = useMemo(() => new Set(selection?.taskIds ?? []), [selection]);
  const causalTaskIds = useMemo(() => {
    const taskIds = new Set(selectedTaskIds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of model.edges) {
        if (!edge.taskIds.some((taskId) => taskIds.has(taskId))) continue;
        for (const taskId of edge.taskIds) {
          if (taskIds.has(taskId)) continue;
          taskIds.add(taskId);
          changed = true;
        }
      }
    }
    return taskIds;
  }, [model.edges, selectedTaskIds]);
  const selectionExists = !selection || model.nodes.some((node) => node.id === selection.id)
    || model.segments.some((segment) => segment.id === selection.id)
    || model.currentSignals.some((signal) => signal.id === selection.id);

  useEffect(() => {
    if (selection && !selectionExists) onSelectionChange(undefined);
  }, [onSelectionChange, selection, selectionExists]);

  const select = (next: OpsRunGraphSelection, label: string) => {
    if (selection?.id === next.id) {
      onSelectionChange(undefined);
      setAnnouncement("Run Graph selection cleared.");
      return;
    }
    onSelectionChange(next);
    setAnnouncement(`${label} selected. Matching Floor work highlighted.`);
  };
  const changeRange = (range: OpsRunGraphRange) => {
    onRangeChange(range);
    setAnnouncement(`Run Graph range: ${rangeLabel(range)}.`);
  };
  const plotHeight = axisHeight + Math.max(1, model.lanes.length) * laneHeight + 4;
  const position = (at: number) => Math.max(0, Math.min(1, (at - model.windowStart) / Math.max(1, model.windowEnd - model.windowStart)));
  const cssPosition = (value: number) => `${labelWidth / svgWidth * 100 + value * railWidth / svgWidth * 100}%`;
  const laneY = (laneId: string) => axisHeight + ((laneIndex.get(laneId) ?? 0) + .5) * laneHeight;
  const edgePath = (edge: OpsRunGraphModel["edges"][number]) => {
    const x1 = labelWidth + position(edge.fromAt) * railWidth;
    const x2 = labelWidth + position(edge.toAt) * railWidth;
    const y1 = laneY(edge.fromLaneId);
    const y2 = laneY(edge.toLaneId);
    const bend = Math.max(20, Math.abs(x2 - x1) * .38);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  };

  return <section className="wj-run-graph" data-embedded={embedded || undefined} aria-labelledby="run-graph-heading" style={{ "--wj-run-graph-height": `${plotHeight}px` } as CSSProperties}>
    <header className="wj-run-graph-header">
      <div className="wj-run-graph-title"><span className="wj-section-label">Recorded execution</span><h2 id="run-graph-heading">Run Graph</h2>{summary && <small>{summary}</small>}</div>
      <div className="wj-run-graph-controls">
        {onCollapse && <button type="button" className="wj-run-graph-toggle" onClick={onCollapse}>Hide graph</button>}
        {embedded && <div className="wj-run-graph-legend" aria-label="Run state legend">
          <RunStateBadge status="needs_input" variant="compact" />
          <RunStateBadge status="verified" variant="compact" />
          <RunStateBadge status="failed" variant="compact" />
        </div>}
        <div className="wj-run-graph-range" role="group" aria-label="Run Graph time range">
          {ranges.map((range) => <button type="button" aria-pressed={model.range === range} onClick={() => changeRange(range)} key={range}>{range}</button>)}
        </div>
      </div>
    </header>
    {!embedded && <div className="wj-run-graph-legend" aria-label="Run state legend">
      <RunStateBadge status="needs_input" variant="compact" />
      <RunStateBadge status="verified" variant="compact" />
      <RunStateBadge status="failed" variant="compact" />
    </div>}
    <div className="wj-run-graph-scroll" data-overflow={model.lanes.length > 4 || undefined}>
      <div className="wj-run-graph-plot" style={{ height: plotHeight }}>
        <div className="wj-run-graph-axis" aria-hidden="true">
          {timeTicks(model).map((tick) => <span style={{ "--wj-run-x": cssPosition(tick.position) } as PositionedStyle} key={tick.position}>{tick.label}</span>)}
        </div>
        <ol className="wj-run-graph-lanes" aria-label="Agent execution lanes">
          {model.lanes.map((lane, index) => {
            const label = agentLabelById.get(lane.id) ?? lane.id;
            return <li style={{ top: axisHeight + index * laneHeight, height: laneHeight }} data-connected={lane.connected || undefined} key={lane.id}>
              <span className="wj-run-graph-agent"><AgentAvatar id={lane.id} label={label} status={lane.runtimeStatus ?? (lane.connected ? "connected" : "recorded")} /><span>{label}</span></span>
              <span className="wj-run-graph-rail" aria-hidden="true" />
            </li>;
          })}
        </ol>
        <svg className="wj-run-graph-paths" viewBox={`0 0 ${svgWidth} ${plotHeight}`} preserveAspectRatio="none" aria-hidden="true">
          {model.edges.map((edge) => <path
            d={edgePath(edge)}
            data-kind={edge.kind}
            data-path={edge.taskIds.some((taskId) => causalTaskIds.has(taskId)) || undefined}
            key={edge.id}
          />)}
          {model.currentSignals.filter((signal) => signal.kind === "conflict" && signal.laneIds.length > 1).map((signal) => {
            const x = labelWidth + position(signal.at) * railWidth;
            const ys = signal.laneIds.flatMap((laneId) => laneIndex.has(laneId) ? [laneY(laneId)] : []);
            return ys.length > 1 ? <path className="wj-run-graph-knot-path" d={`M ${x} ${Math.min(...ys)} L ${x} ${Math.max(...ys)}`} data-path={signal.taskIds.some((taskId) => causalTaskIds.has(taskId)) || undefined} key={`path:${signal.id}`} /> : null;
          })}
        </svg>
        <div className="wj-run-graph-elements">
          {model.segments.map((segment) => <RunSegment
            segment={segment}
            taskTitle={cardTitleById.get(segment.taskId) ?? segment.taskId}
            agentLabel={agentLabelById.get(segment.laneId) ?? segment.laneId}
            selected={selection?.id === segment.id}
            onPath={causalTaskIds.has(segment.taskId)}
            position={position}
            cssPosition={cssPosition}
            top={laneY(segment.laneId)}
            onSelect={select}
            key={segment.id}
          />)}
          {model.nodes.map((node) => <RunNode
            node={node}
            agentLabel={agentLabelById.get(node.laneId) ?? node.laneId}
            selected={selection?.id === node.id}
            onPath={causalTaskIds.has(node.taskId)}
            left={cssPosition(position(node.at))}
            top={laneY(node.laneId)}
            onSelect={select}
            key={node.id}
          />)}
          {model.currentSignals.map((signal) => {
            const signalLaneIndexes = signal.laneIds.flatMap((laneId) => laneIndex.has(laneId) ? [laneIndex.get(laneId)!] : []);
            const averageLaneIndex = signalLaneIndexes.reduce((sum, index) => sum + index, 0) / Math.max(1, signalLaneIndexes.length);
            return <RunSignal
              signal={signal}
              selected={selection?.id === signal.id}
              onPath={signal.taskIds.some((taskId) => causalTaskIds.has(taskId))}
              left={cssPosition(position(signal.at))}
              alignEnd={position(signal.at) > .92}
              top={axisHeight + (averageLaneIndex + .5) * laneHeight}
              onSelect={select}
              key={signal.id}
            />;
          })}
        </div>
        {model.emptyWindow && <p className="wj-run-graph-empty">No recorded run events in the last {rangeLabel(model.range)}.</p>}
      </div>
    </div>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </section>;
}

function RunSegment({
  segment,
  taskTitle,
  agentLabel,
  selected,
  onPath,
  position,
  cssPosition,
  top,
  onSelect,
}: {
  segment: OpsRunGraphSegment;
  taskTitle: string;
  agentLabel: string;
  selected: boolean;
  onPath: boolean;
  position: (at: number) => number;
  cssPosition: (position: number) => string;
  top: number;
  onSelect: (selection: OpsRunGraphSelection, label: string) => void;
}) {
  const start = position(segment.startedAt);
  const end = position(segment.endedAt);
  const label = `${taskTitle}, ${agentLabel}, run ${segment.runId}, ${segment.status ? resolveRunState(segment.status).label : "Recorded activity"}, ${formatTimestamp(segment.recordedStartedAt)} to ${segment.active ? "now" : formatTimestamp(segment.recordedEndedAt ?? segment.endedAt)}`;
  return <button
    type="button"
    className="wj-run-graph-segment"
    style={{ "--wj-run-x": cssPosition(start), "--wj-run-span": `${Math.max(0, end - start) * railWidth / svgWidth * 100}%`, "--wj-run-y": `${top}px` } as PositionedStyle}
    data-tone={segment.tone}
    data-active={segment.active || undefined}
    data-clipped={segment.clippedStart || undefined}
    data-selected={selected || undefined}
    data-path={onPath || undefined}
    aria-label={label}
    aria-pressed={selected}
    title={label}
    onClick={() => onSelect({ id: segment.id, kind: "run", taskIds: [segment.taskId], taskId: segment.taskId, runId: segment.runId, eventId: segment.eventId }, `${taskTitle} run`)}
  />;
}

function RunNode({ node, agentLabel, selected, onPath, left, top, onSelect }: {
  node: OpsRunGraphNode;
  agentLabel: string;
  selected: boolean;
  onPath: boolean;
  left: string;
  top: number;
  onSelect: (selection: OpsRunGraphSelection, label: string) => void;
}) {
  const label = `${node.taskTitle}, ${agentLabel}, ${node.eventType}, ${formatTimestamp(node.at)}${node.status ? `, ${resolveRunState(node.status).label}` : ""}`;
  return <button
    type="button"
    className="wj-run-graph-node"
    style={{ "--wj-run-x": left, "--wj-run-y": `${top}px` } as PositionedStyle}
    data-node-kind={node.kind}
    data-tone={node.tone}
    data-selected={selected || undefined}
    data-path={onPath || undefined}
    aria-label={label}
    aria-pressed={selected}
    title={`${node.label} · ${label}`}
    onClick={() => onSelect({ id: node.id, kind: "event", taskIds: [node.taskId], taskId: node.taskId, eventId: node.eventId, runId: node.runId }, node.label)}
  />;
}

function RunSignal({ signal, selected, onPath, left, alignEnd, top, onSelect }: {
  signal: OpsRunGraphCurrentSignal;
  selected: boolean;
  onPath: boolean;
  left: string;
  alignEnd: boolean;
  top: number;
  onSelect: (selection: OpsRunGraphSelection, label: string) => void;
}) {
  const conflict = signal.kind === "conflict";
  return <button
    type="button"
    className="wj-run-graph-signal"
    style={{ "--wj-run-x": left, "--wj-run-y": `${top}px` } as PositionedStyle}
    data-kind={signal.kind}
    data-tone={signal.tone}
    data-align-end={alignEnd || undefined}
    data-selected={selected || undefined}
    data-path={onPath || undefined}
    aria-label={`${signal.label}, current, ${formatTimestamp(signal.recordedAt ?? signal.at)}`}
    aria-pressed={selected}
    title={signal.label}
    onClick={() => onSelect({
      id: signal.id,
      kind: conflict ? "conflict" : "task",
      taskIds: signal.taskIds,
      taskId: signal.taskIds[0],
      conflictFile: signal.conflictFile,
    }, signal.label)}
  ><span aria-hidden="true">{conflict ? "conflict" : signal.kind === "approval" ? "approve" : "ask"}</span><small aria-hidden="true">current</small></button>;
}

function timeTicks(model: OpsRunGraphModel): Array<{ position: number; label: string }> {
  return [0, .25, .5, .75, 1].map((position) => ({
    position,
    label: position === 1 ? "now" : formatTick(model.windowStart + (model.windowEnd - model.windowStart) * position),
  }));
}

function formatTick(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(timestamp);
}

function rangeLabel(range: OpsRunGraphRange): string {
  return range === "10m" ? "10 minutes" : range === "40m" ? "40 minutes" : "4 hours";
}
