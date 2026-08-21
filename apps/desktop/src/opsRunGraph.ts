import { pendingAgentInteraction, type AttentionItem } from "./attention";
import { opsCardParticipantIds, opsCurrentCardForAgent } from "./opsPresence";
import { resolveRunState, runGraphTone } from "./runState";
import type { OpsFloorContention } from "./opsFloor";
import type { OpsCard, OpsState, OpsTaskEvent, PaneRuntime } from "./types";

export type OpsRunGraphRange = "10m" | "40m" | "4h";

export interface OpsRunGraphLane {
  id: string;
  connected: boolean;
  runtimeStatus?: string;
  latestEvidenceAt?: number;
}

export type OpsRunGraphTone = "neutral" | "success" | "warning" | "destructive";

export interface OpsRunGraphSegment {
  id: string;
  taskId: string;
  runId: string;
  laneId: string;
  eventId: string;
  startedAt: number;
  endedAt: number;
  recordedStartedAt: number;
  recordedEndedAt?: number;
  status?: string;
  tone: OpsRunGraphTone;
  active: boolean;
  clippedStart: boolean;
}

export type OpsRunGraphNodeKind = "event" | "verification";

export interface OpsRunGraphNode {
  id: string;
  kind: OpsRunGraphNodeKind;
  taskId: string;
  taskTitle: string;
  laneId: string;
  at: number;
  label: string;
  eventType: string;
  status?: string;
  eventId?: string;
  runId?: string;
  tone: OpsRunGraphTone;
}

export type OpsRunGraphEdgeKind = "handoff" | "dependency";

export interface OpsRunGraphEdge {
  id: string;
  kind: OpsRunGraphEdgeKind;
  fromLaneId: string;
  toLaneId: string;
  fromAt: number;
  toAt: number;
  taskIds: string[];
  fromNodeId?: string;
  toNodeId?: string;
}

export type OpsRunGraphSignalKind = "approval" | "question" | "conflict";

export interface OpsRunGraphCurrentSignal {
  id: string;
  kind: OpsRunGraphSignalKind;
  at: number;
  recordedAt?: number;
  laneIds: string[];
  taskIds: string[];
  label: string;
  conflictFile?: string;
  tone: "warning" | "destructive";
}

export interface OpsRunGraphModel {
  range: OpsRunGraphRange;
  windowStart: number;
  windowEnd: number;
  lanes: OpsRunGraphLane[];
  segments: OpsRunGraphSegment[];
  nodes: OpsRunGraphNode[];
  edges: OpsRunGraphEdge[];
  currentSignals: OpsRunGraphCurrentSignal[];
  emptyWindow: boolean;
}

export interface OpsRunGraphSelection {
  id: string;
  kind: "event" | "run" | "task" | "conflict";
  taskIds: string[];
  taskId?: string;
  eventId?: string;
  runId?: string;
  conflictFile?: string;
}

interface ParsedEvent {
  card: OpsCard;
  event: OpsTaskEvent;
  at: number;
  cardIndex: number;
  eventIndex: number;
  laneId: string;
  runId: string;
}

const RANGE_MS: Record<OpsRunGraphRange, number> = {
  "10m": 10 * 60_000,
  "40m": 40 * 60_000,
  "4h": 4 * 60 * 60_000,
};

const activeStatuses = new Set(["starting", "running", "in_progress"]);

export function deriveOpsRunGraphModel({
  state,
  runtimes,
  attentionItems,
  conflicts,
  now,
  range,
}: {
  state: OpsState;
  runtimes: PaneRuntime[];
  attentionItems: AttentionItem[];
  conflicts: OpsFloorContention[];
  now: number;
  range: OpsRunGraphRange;
}): OpsRunGraphModel {
  const windowEnd = Number.isFinite(now) ? now : 0;
  const windowStart = windowEnd - RANGE_MS[range];
  const runtimeOrder: string[] = [];
  const runtimeById = new Map<string, PaneRuntime>();
  for (const runtime of runtimes) {
    if (!runtime.structured || runtimeById.has(runtime.nodeId)) continue;
    runtimeOrder.push(runtime.nodeId);
    runtimeById.set(runtime.nodeId, runtime);
  }
  const cardById = new Map(state.cards.map((card) => [card.id, card]));
  const parsedEvents = state.cards.flatMap((card, cardIndex) => (card.events ?? []).flatMap((event, eventIndex) => {
    const at = parseTimestamp(event.timestamp);
    const laneId = event.callsign?.trim();
    const runId = event.runId?.trim();
    if (at === undefined || !laneId || !runId) return [];
    return [{ card, event, at, cardIndex, eventIndex, laneId, runId } satisfies ParsedEvent];
  })).sort(compareParsedEvents);
  const latestEvidence = new Map<string, number>();
  const rememberEvidence = (laneId: string | undefined, at: number) => {
    if (!laneId || at < windowStart || at > windowEnd) return;
    latestEvidence.set(laneId, Math.max(latestEvidence.get(laneId) ?? Number.NEGATIVE_INFINITY, at));
  };
  for (const item of parsedEvents) {
    rememberEvidence(item.laneId, item.at);
    if (item.event.kind === "handoff") rememberEvidence(item.event.targetId?.trim(), item.at);
  }

  const nodes: OpsRunGraphNode[] = parsedEvents.flatMap((item) => {
    if (!inWindow(item.at, windowStart, windowEnd)) return [];
    return [{
      id: eventNodeId(item.card.id, item.event.id),
      kind: "event" as const,
      taskId: item.card.id,
      taskTitle: item.card.title,
      laneId: item.laneId,
      at: item.at,
      label: item.event.message || eventLabel(item.event),
      eventType: item.event.kind,
      status: item.event.status,
      eventId: item.event.id,
      runId: item.runId,
      tone: eventTone(item.event),
    }];
  });

  const groups = new Map<string, ParsedEvent[]>();
  for (const item of parsedEvents) {
    const key = `${item.runId}\u0000${item.laneId}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const segments: OpsRunGraphSegment[] = [];
  for (const group of groups.values()) {
    for (let index = 0; index < group.length; index++) {
      const item = group[index];
      const next = group[index + 1];
      const recordedEnd = next?.at;
      const active = !next && matchingRuntimeProvesActive(item, state, runtimeById);
      const end = recordedEnd ?? (active ? windowEnd : undefined);
      if (end === undefined || end <= item.at || end < windowStart || item.at > windowEnd) continue;
      segments.push({
        id: `segment:${item.card.id}:${item.event.id}`,
        taskId: item.card.id,
        runId: item.runId,
        laneId: item.laneId,
        eventId: item.event.id,
        startedAt: Math.max(item.at, windowStart),
        endedAt: Math.min(end, windowEnd),
        recordedStartedAt: item.at,
        recordedEndedAt: recordedEnd,
        status: item.event.status,
        tone: eventTone(item.event),
        active,
        clippedStart: item.at < windowStart,
      });
    }
  }

  const verificationNodes: OpsRunGraphNode[] = [];
  for (const card of state.cards) {
    const run = card.verificationRun;
    if (!run) continue;
    const laneId = card.reviewerId ?? card.assigneeIds[0];
    if (!laneId) continue;
    const startedAt = parseTimestamp(run.startedAt);
    if (startedAt !== undefined && inWindow(startedAt, windowStart, windowEnd)) {
      rememberEvidence(laneId, startedAt);
      verificationNodes.push({
        id: `verification:${card.id}:${run.sessionId}:start`,
        kind: "verification",
        taskId: card.id,
        taskTitle: card.title,
        laneId,
        at: startedAt,
        label: `Verification started: ${run.command}`,
        eventType: "verification started",
        status: "running",
        runId: run.sessionId,
        tone: "neutral",
      });
    }
    const endedAt = parseTimestamp(run.endedAt);
    if (endedAt !== undefined && (startedAt === undefined || endedAt >= startedAt) && inWindow(endedAt, windowStart, windowEnd)) {
      rememberEvidence(laneId, endedAt);
      verificationNodes.push({
        id: `verification:${card.id}:${run.sessionId}:end`,
        kind: "verification",
        taskId: card.id,
        taskTitle: card.title,
        laneId,
        at: endedAt,
        label: `Verification ${run.status}`,
        eventType: "verification result",
        status: run.status,
        runId: run.sessionId,
        tone: statusTone(run.status),
      });
    }
  }
  nodes.push(...verificationNodes);

  const edges: OpsRunGraphEdge[] = [];
  for (const item of parsedEvents) {
    const targetId = item.event.targetId?.trim();
    if (item.event.kind !== "handoff" || !targetId || targetId === item.laneId || !inWindow(item.at, windowStart, windowEnd)) continue;
    edges.push({
      id: `handoff:${item.card.id}:${item.event.id}`,
      kind: "handoff",
      fromLaneId: item.laneId,
      toLaneId: targetId,
      fromAt: item.at,
      toAt: item.at,
      taskIds: [item.card.id],
      fromNodeId: eventNodeId(item.card.id, item.event.id),
    });
  }
  for (const card of state.cards) {
    const starts = parsedEvents.filter((item) => item.card.id === card.id && explicitStart(item.event));
    if (!starts.length) continue;
    const start = starts[0];
    for (const dependencyId of card.dependencyIds ?? []) {
      const completions = parsedEvents.filter((item) => item.card.id === dependencyId && explicitCompletion(item.event) && item.at <= start.at);
      const completion = completions.at(-1);
      if (!completion || !inWindow(completion.at, windowStart, windowEnd) || !inWindow(start.at, windowStart, windowEnd)) continue;
      edges.push({
        id: `dependency:${dependencyId}:${card.id}:${completion.event.id}:${start.event.id}`,
        kind: "dependency",
        fromLaneId: completion.laneId,
        toLaneId: start.laneId,
        fromAt: completion.at,
        toAt: start.at,
        taskIds: [dependencyId, card.id],
        fromNodeId: eventNodeId(dependencyId, completion.event.id),
        toNodeId: eventNodeId(card.id, start.event.id),
      });
    }
  }

  const currentSignals: OpsRunGraphCurrentSignal[] = [];
  for (const item of attentionItems) {
    const runtimeId = item.runtimeNodeId ?? (item.target.kind === "pane" ? item.target.nodeId : undefined);
    const interaction = runtimeId ? pendingAgentInteraction(runtimeById.get(runtimeId)?.messages ?? []) : undefined;
    if (!interaction || (interaction.kind !== "approval" && interaction.kind !== "question")) continue;
    const taskId = item.target.kind === "pane" ? undefined : item.target.cardId;
    const card = taskId ? cardById.get(taskId) : undefined;
    const laneId = runtimeId ?? card?.assigneeIds[0] ?? card?.reviewerId;
    if (!laneId) continue;
    const recordedAt = parseTimestamp(item.createdAt);
    const at = recordedAt !== undefined && inWindow(recordedAt, windowStart, windowEnd) ? recordedAt : windowEnd;
    rememberEvidence(laneId, at);
    currentSignals.push({
      id: `gate:${item.id}`,
      kind: interaction.kind,
      at,
      recordedAt,
      laneIds: [laneId],
      taskIds: taskId ? [taskId] : [],
      label: interaction.kind === "approval" ? `Approval needed: ${item.detail}` : `Question waiting: ${item.detail}`,
      tone: "warning",
    });
  }
  for (const conflict of conflicts) {
    const laneIds = [...new Set(conflict.cardIds.flatMap((cardId) => {
      const card = cardById.get(cardId);
      return card ? opsCardParticipantIds(card, runtimes) : [];
    }))];
    if (!laneIds.length) continue;
    for (const laneId of laneIds) rememberEvidence(laneId, windowEnd);
    currentSignals.push({
      id: `conflict:${conflict.file}`,
      kind: "conflict",
      at: windowEnd,
      laneIds,
      taskIds: [...conflict.cardIds],
      label: `Current file conflict: ${conflict.file}`,
      conflictFile: conflict.file,
      tone: "destructive",
    });
  }

  const connected = new Set(runtimeOrder);
  const evidenceOnly = [...latestEvidence.entries()]
    .filter(([laneId]) => !connected.has(laneId))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const lanes: OpsRunGraphLane[] = [
    ...runtimeOrder.map((id) => ({ id, connected: true, runtimeStatus: runtimeById.get(id)?.status, latestEvidenceAt: latestEvidence.get(id) })),
    ...evidenceOnly.map(([id, latestEvidenceAt]) => ({ id, connected: false, latestEvidenceAt })),
  ];
  const laneIds = new Set(lanes.map((lane) => lane.id));

  const visibleNodes = nodes.filter((node) => laneIds.has(node.laneId)).sort(compareTimedElements);
  const visibleSegments = segments.filter((segment) => laneIds.has(segment.laneId)).sort(compareTimedElements);
  const visibleEdges = edges.filter((edge) => laneIds.has(edge.fromLaneId) && laneIds.has(edge.toLaneId))
    .sort((left, right) => left.fromAt - right.fromAt || left.id.localeCompare(right.id));
  const visibleSignals = currentSignals.filter((signal) => signal.laneIds.some((laneId) => laneIds.has(laneId)))
    .sort((left, right) => left.at - right.at || left.id.localeCompare(right.id));

  return {
    range,
    windowStart,
    windowEnd,
    lanes,
    segments: visibleSegments,
    nodes: visibleNodes,
    edges: visibleEdges,
    currentSignals: visibleSignals,
    emptyWindow: visibleNodes.length === 0 && visibleSegments.length === 0 && visibleEdges.length === 0,
  };
}

function matchingRuntimeProvesActive(item: ParsedEvent, state: OpsState, runtimeById: ReadonlyMap<string, PaneRuntime>): boolean {
  const runtime = runtimeById.get(item.laneId);
  if (!runtime || !activeStatuses.has(runtime.status.toLowerCase())) return false;
  if (item.card.runProgress && item.card.runProgress.runId !== item.runId) return false;
  return opsCurrentCardForAgent(state, item.laneId)?.id === item.card.id;
}

function explicitStart(event: OpsTaskEvent): boolean {
  const status = event.status?.toLowerCase();
  return event.kind === "assignment" || Boolean(status && activeStatuses.has(status));
}

function explicitCompletion(event: OpsTaskEvent): boolean {
  const status = event.status?.toLowerCase();
  return event.kind === "completion" || status === "completed" || status === "complete" || status === "done";
}

function eventNodeId(taskId: string, eventId: string): string {
  return `event:${taskId}:${eventId}`;
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inWindow(at: number, start: number, end: number): boolean {
  return at >= start && at <= end;
}

function compareParsedEvents(left: ParsedEvent, right: ParsedEvent): number {
  return left.at - right.at || left.cardIndex - right.cardIndex || left.eventIndex - right.eventIndex || left.event.id.localeCompare(right.event.id);
}

function compareTimedElements(left: { startedAt?: number; at?: number; id: string }, right: { startedAt?: number; at?: number; id: string }): number {
  return (left.startedAt ?? left.at ?? 0) - (right.startedAt ?? right.at ?? 0) || left.id.localeCompare(right.id);
}

function eventLabel(event: OpsTaskEvent): string {
  return event.status ? `${event.kind}: ${resolveRunState(event.status).label}` : event.kind.replaceAll("_", " ");
}

function eventTone(event: OpsTaskEvent): OpsRunGraphTone {
  if (event.kind === "completion") return "success";
  if (event.kind === "blocker") return "warning";
  return runGraphTone(event.status);
}

function statusTone(status: string | undefined): OpsRunGraphTone {
  return runGraphTone(status);
}
