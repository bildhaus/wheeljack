import { needsAttention, pendingAgentInteraction, type AttentionItem } from "./attention";
import {
  opsActiveFileConflicts,
  opsCardParticipantIds,
  opsExecutionLane,
  opsFileConflictNeedsAttention,
  opsNextAutonomousTask,
  opsVerificationProgress,
  opsWaitingRelationships,
} from "./opsPresence";
import { visibleRunStateDetail } from "./runState";
import type { ActivityEvent, OpsCard, OpsState, PaneRuntime } from "./types";

export type OpsFloorLane = "ready" | "running" | "attention" | "verifying" | "done";

export interface OpsFloorTask {
  card: OpsCard;
  lane: OpsFloorLane;
  participantIds: string[];
  runtimeId?: string;
  runtimeStatus?: string;
  currentAction?: string;
  lastActivityAt?: string;
  waitingOnCardIds: string[];
  downstreamBlocked: number;
  verification: ReturnType<typeof opsVerificationProgress>;
}

export type OpsFloorAttentionKind = "interaction" | "conflict" | "runtime" | "review" | "dependency";

export interface OpsFloorAttention {
  id: string;
  title: string;
  reason: string;
  kind: OpsFloorAttentionKind;
  cardId?: string;
  runtimeId?: string;
  interactionKind?: "approval" | "question";
  downstreamBlocked: number;
  waitingSince?: string;
  rank: number;
}

export interface OpsFloorContention {
  file: string;
  cardIds: string[];
}

export type OpsFloorAgentState = "working" | "attention" | "idle" | "unavailable";

export interface OpsFloorAgent {
  id: string;
  status: string;
  state: OpsFloorAgentState;
  task?: OpsFloorTask;
  currentAction?: string;
  lastActivityAt?: string;
}

export type OpsFloorActivityOutcome = "completed" | "failed" | "blocked" | "handoff" | "conflict" | "update";

export interface OpsFloorActivityGroup {
  outcome: OpsFloorActivityOutcome;
  events: ActivityEvent[];
}

export type OpsFloorAction =
  | { type: "attention"; id: string; rank: number; item: OpsFloorAttention }
  | { type: "contention"; id: string; rank: 1; contention: OpsFloorContention };

export interface OpsFloorModel {
  connectedAgents: number;
  workingAgents: number;
  agents: OpsFloorAgent[];
  nextAutonomousTask?: OpsFloorTask;
  attention: OpsFloorAttention[];
  contentions: OpsFloorContention[];
  actionQueue: OpsFloorAction[];
  running: OpsFloorTask[];
  ready: OpsFloorTask[];
  recentActivity: ActivityEvent[];
  sinceLeft: {
    actionable: ActivityEvent[];
    updates: ActivityEvent[];
    groups: OpsFloorActivityGroup[];
  };
}

const workingStatuses = new Set(["starting", "running", "in_progress"]);
const terminalStatuses = new Set(["completed", "canceled", "failed", "disconnected"]);

export function deriveOpsFloorModel({
  state,
  runtimes,
  attentionItems,
  activity,
}: {
  state: OpsState;
  runtimes: PaneRuntime[];
  attentionItems: AttentionItem[];
  activity: ActivityEvent[];
}): OpsFloorModel {
  const structuredRuntimes = runtimes.filter((runtime) => runtime.structured);
  const runtimeById = new Map(structuredRuntimes.map((runtime) => [runtime.nodeId, runtime]));
  const roleByColumnId = new Map(state.columns.map((column) => [column.id, column.role]));
  const doneColumnIds = new Set(state.columns.filter((column) => column.role === "done").map((column) => column.id));
  const connectedAgentIds = new Set(structuredRuntimes.map((runtime) => runtime.nodeId));
  const liveCards = state.cards.filter((card) => opsCardParticipantIds(card, structuredRuntimes).some((id) => connectedAgentIds.has(id)));
  const contentions = opsActiveFileConflicts({ cards: liveCards, columns: state.columns });
  const contentionsNeedingAttention = contentions.filter((contention) =>
    opsFileConflictNeedsAttention(state, contention, structuredRuntimes));
  const contentionAttentionCardIds = new Set(contentionsNeedingAttention.flatMap((contention) => contention.cardIds));
  const conflictCardIds = new Set(contentions.flatMap((conflict) => conflict.cardIds));
  const waiting = opsWaitingRelationships(state.cards, doneColumnIds);
  const waitingByCard = new Map(waiting.map((relationship) => [relationship.cardId, relationship]));
  const cardById = new Map(state.cards.map((card) => [card.id, card]));
  const cardOrder = new Map(state.cards.map((card, index) => [card.id, index]));
  const downstream = new Map(state.cards.map((card) => [card.id, downstreamBlockedCount(state.cards, card.id, doneColumnIds)]));

  const floorTask = (card: OpsCard): OpsFloorTask => {
    const participantIds = opsCardParticipantIds(card, structuredRuntimes);
    const runtime = participantIds.flatMap((id) => runtimeById.get(id) ?? [])[0];
    const runtimeStatuses = participantIds.flatMap((id) => runtimeById.get(id)?.status ?? []);
    const role = roleByColumnId.get(card.columnId) ?? "queued";
    const lane = opsExecutionLane(card, role, runtimeStatuses, conflictCardIds.has(card.id)) as OpsFloorLane;
    const relationship = waitingByCard.get(card.id);
    return {
      card,
      lane,
      participantIds,
      runtimeId: runtime?.nodeId,
      runtimeStatus: runtime?.status,
      currentAction: visibleRunStateDetail(runtime?.status, runtime?.statusSummary) || card.lastNote || undefined,
      lastActivityAt: card.events?.at(-1)?.timestamp ?? card.completedAt ?? card.pausedAt ?? card.startedAt,
      waitingOnCardIds: relationship?.waitingOnCardIds ?? [],
      downstreamBlocked: downstream.get(card.id) ?? 0,
      verification: opsVerificationProgress(card, conflictCardIds.has(card.id)),
    };
  };

  const objectiveIds = new Set(state.cards.flatMap((card) => card.parentId ?? []));
  const taskRows = state.cards
    .filter((card) => card.kind !== "objective" && !objectiveIds.has(card.id))
    .map(floorTask);
  const attentionById = new Map<string, OpsFloorAttention>();
  for (const item of attentionItems) {
    if (item.sources.every((source) => source === "activity")) continue;
    const cardId = item.target.kind === "pane" ? undefined : item.target.cardId;
    const card = cardId ? cardById.get(cardId) : undefined;
    const runtimeId = item.runtimeNodeId ?? (item.target.kind === "pane" ? item.target.nodeId : undefined);
    const runtime = runtimeId ? runtimeById.get(runtimeId) : undefined;
    const interaction = runtime ? pendingAgentInteraction(runtime.messages) : undefined;
    const kind: OpsFloorAttentionKind = interaction
      ? "interaction"
      : runtime && needsAttention(runtime.status)
        ? "runtime"
      : cardId && conflictCardIds.has(cardId)
        ? "conflict"
        : item.target.kind === "review"
          ? "review"
          : "runtime";
    if (kind === "conflict" && cardId && !contentionAttentionCardIds.has(cardId)) continue;
    attentionById.set(item.id, {
      id: item.id,
      title: card?.title ?? item.title,
      reason: item.detail,
      kind,
      cardId,
      runtimeId,
      interactionKind: interaction?.kind === "approval" || interaction?.kind === "question" ? interaction.kind : undefined,
      downstreamBlocked: cardId ? downstream.get(cardId) ?? 0 : 0,
      waitingSince: item.createdAt ?? card?.events?.at(-1)?.timestamp ?? card?.startedAt,
      rank: kind === "interaction" ? 0 : kind === "conflict" ? 1 : kind === "runtime" ? 2 : 3,
    });
  }

  const priorityRank = (cardId?: string) => {
    const priority = cardId ? cardById.get(cardId)?.priority : undefined;
    return priority === "high" ? 0 : priority === "normal" ? 1 : 2;
  };
  const attention = [...attentionById.values()].sort((left, right) =>
    left.rank - right.rank
    || right.downstreamBlocked - left.downstreamBlocked
    || (left.waitingSince ?? "").localeCompare(right.waitingSince ?? "")
    || priorityRank(left.cardId) - priorityRank(right.cardId)
    || (cardOrder.get(left.cardId ?? "") ?? Number.MAX_SAFE_INTEGER) - (cardOrder.get(right.cardId ?? "") ?? Number.MAX_SAFE_INTEGER));
  const actionQueue: OpsFloorAction[] = [
    ...attention.filter((item) => item.kind !== "conflict").map((item) => ({
      type: "attention" as const,
      id: item.id,
      rank: item.rank,
      item,
    })),
    ...contentionsNeedingAttention.map((contention) => ({
      type: "contention" as const,
      id: `contention:${contention.file}`,
      rank: 1 as const,
      contention,
    })),
  ].sort((left, right) => left.rank - right.rank);
  const attentionCardIds = new Set(attention.flatMap((item) => item.cardId ?? []));
  const chronological = (left: OpsFloorTask, right: OpsFloorTask) =>
    (right.lastActivityAt ?? "").localeCompare(left.lastActivityAt ?? "")
    || (cardOrder.get(left.card.id) ?? 0) - (cardOrder.get(right.card.id) ?? 0);

  const currentProjectNodeIds = new Set(structuredRuntimes.map((runtime) => runtime.nodeId));
  const taskIds = new Set(state.cards.map((card) => card.id));
  const projectActivity = activity.filter((event) => {
    const taskId = stringPayload(event.payload, "taskId") ?? stringPayload(event.payload, "cardId");
    return Boolean((event.nodeId && currentProjectNodeIds.has(event.nodeId)) || (taskId && taskIds.has(taskId)));
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id - left.id);
  const unread = projectActivity.filter((event) => !event.isRead);
  const nextAutonomousCard = opsNextAutonomousTask(state);
  const taskById = new Map(taskRows.map((task) => [task.card.id, task]));
  const currentTaskByAgent = new Map<string, OpsFloorTask>();
  for (const task of taskRows.filter((item) => ["running", "verifying", "attention"].includes(item.lane))) {
    for (const participantId of task.participantIds) {
      if (!currentTaskByAgent.has(participantId)) currentTaskByAgent.set(participantId, task);
    }
  }
  const agents = structuredRuntimes.map((runtime): OpsFloorAgent => {
    const task = currentTaskByAgent.get(runtime.nodeId);
    const state: OpsFloorAgentState = runtime.status === "disconnected"
      ? "unavailable"
      : needsAttention(runtime.status)
        ? "attention"
        : workingStatuses.has(runtime.status)
        ? "working"
        : "idle";
    return {
      id: runtime.nodeId,
      status: runtime.status,
      state,
      task,
      currentAction: visibleRunStateDetail(runtime.status, runtime.statusSummary) || task?.currentAction,
      lastActivityAt: task?.lastActivityAt,
    };
  }).sort((left, right) => agentStateRank(left.state) - agentStateRank(right.state) || left.id.localeCompare(right.id));
  const activityGroups = groupActivityByOutcome(unread);

  return {
    connectedAgents: structuredRuntimes.filter((runtime) => runtime.status !== "disconnected").length,
    workingAgents: structuredRuntimes.filter((runtime) => workingStatuses.has(runtime.status)).length,
    agents,
    nextAutonomousTask: nextAutonomousCard ? taskById.get(nextAutonomousCard.id) : undefined,
    attention,
    contentions,
    actionQueue,
    running: taskRows.filter((task) => ["running", "verifying"].includes(task.lane) && !attentionCardIds.has(task.card.id)).sort(chronological),
    ready: taskRows.filter((task) => task.lane === "ready" && !task.waitingOnCardIds.length && !attentionCardIds.has(task.card.id)),
    recentActivity: projectActivity,
    sinceLeft: {
      actionable: unread.filter((event) => needsAttention(event.status)),
      updates: unread.filter((event) => !needsAttention(event.status)),
      groups: activityGroups,
    },
  };
}

function agentStateRank(state: OpsFloorAgentState): number {
  return state === "attention" ? 0 : state === "working" ? 1 : state === "idle" ? 2 : 3;
}

function groupActivityByOutcome(events: ActivityEvent[]): OpsFloorActivityGroup[] {
  const groups = new Map<OpsFloorActivityOutcome, ActivityEvent[]>();
  for (const event of events) {
    const outcome = activityOutcome(event);
    groups.set(outcome, [...(groups.get(outcome) ?? []), event]);
  }
  const order: OpsFloorActivityOutcome[] = ["completed", "failed", "blocked", "handoff", "conflict", "update"];
  return order.flatMap((outcome) => {
    const grouped = groups.get(outcome);
    return grouped?.length ? [{ outcome, events: grouped }] : [];
  });
}

function activityOutcome(event: ActivityEvent): OpsFloorActivityOutcome {
  const evidence = `${event.kind} ${event.status} ${event.message}`.toLocaleLowerCase();
  if (["failed", "error", "disconnected", "canceled", "interrupted"].includes(event.status) || /\bfail(?:ed|ure)?\b|\berror\b/.test(evidence)) return "failed";
  if (["blocked", "needs_input", "attention"].includes(event.status)) return "blocked";
  if (["completed", "done", "passed", "approved"].includes(event.status)) return "completed";
  if (/handoff|handed off|transfer(?:red)?|review requested/.test(evidence)) return "handoff";
  if (/resolved?.*conflict|conflict.*resolved?|released.*(?:file claims?|overlap)|remove(?:d)? the overlap|ownership.*(?:chosen|assigned)/.test(evidence)) return "conflict";
  return "update";
}

function downstreamBlockedCount(cards: OpsCard[], blockerId: string, doneColumnIds: ReadonlySet<string>): number {
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const dependsOn = (card: OpsCard, targetId: string, seen: Set<string>): boolean => {
    if (seen.has(card.id)) return false;
    seen.add(card.id);
    return (card.dependencyIds ?? []).some((dependencyId) => {
      if (card.dependencyKinds?.[dependencyId] === "soft") return false;
      if (dependencyId === targetId) return true;
      const dependency = cardById.get(dependencyId);
      return dependency ? dependsOn(dependency, targetId, seen) : false;
    });
  };
  return cards.filter((card) =>
    card.id !== blockerId
    && !doneColumnIds.has(card.columnId)
    && dependsOn(card, blockerId, new Set())).length;
}

function stringPayload(payload: Record<string, unknown>, key: string): string | undefined {
  return typeof payload[key] === "string" ? payload[key] : undefined;
}

export function floorRuntimeCanRecover(status?: string): boolean {
  return Boolean(status && terminalStatuses.has(status) && status !== "completed" && status !== "canceled");
}
