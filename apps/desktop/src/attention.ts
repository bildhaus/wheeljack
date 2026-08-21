import { opsActiveFileConflicts, opsAttentionReason } from "./opsPresence";
import { resolveRunState } from "./runState";
import type { ActivityEvent, AgentMessage, OpsCard, OpsState, PaneRuntime } from "./types";

export type AttentionSource = "runtime" | "activity" | "ops" | "review";

export type AttentionTarget =
  | { kind: "pane"; nodeId: string; sessionId?: string }
  | { kind: "ops"; cardId: string }
  | { kind: "review"; cardId: string };

export interface AttentionItem {
  id: string;
  sources: AttentionSource[];
  title: string;
  detail: string;
  status: string;
  target: AttentionTarget;
  runtimeNodeId?: string;
  activityIds: number[];
  createdAt?: string;
}

const attentionStatuses = new Set(["needs_input", "failed", "disconnected", "blocked", "review"]);

export function needsAttention(status: string): boolean {
  return attentionStatuses.has(status.toLowerCase());
}

export function pendingAgentInteraction(messages: AgentMessage[]): AgentMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "user" && message.kind !== "interaction_response") return undefined;
    if (
      (message.kind === "approval" || message.kind === "question")
      && (!message.interactionState || ["pending", "submitting"].includes(message.interactionState))
    ) {
      return message;
    }
  }
  return undefined;
}

export function deriveAttention({
  runtimes,
  activity,
  opsState,
}: {
  runtimes: PaneRuntime[];
  activity: ActivityEvent[];
  opsState: OpsState;
}): AttentionItem[] {
  const items = new Map<string, AttentionItem>();
  const runtimeById = new Map(runtimes.map((runtime) => [runtime.nodeId, runtime]));
  const runtimeBySessionId = new Map(runtimes.filter((runtime) => runtime.sessionId).map((runtime) => [runtime.sessionId, runtime]));
  const roleByColumnId = new Map(opsState.columns.map((column) => [column.id, column.role]));
  const conflictingCardIds = new Set(opsActiveFileConflicts(opsState).flatMap((conflict) => conflict.cardIds));
  const cardById = new Map(opsState.cards.map((card) => [card.id, card]));
  const cardForNode = new Map<string, OpsCard>();

  for (const card of opsState.cards) {
    for (const nodeId of [...card.assigneeIds, ...(card.reviewerId ? [card.reviewerId] : [])]) {
      const current = cardForNode.get(nodeId);
      if (!current || roleByColumnId.get(card.columnId) === "review") cardForNode.set(nodeId, card);
    }
  }

  const upsert = (candidate: AttentionItem) => {
    const current = items.get(candidate.id);
    if (!current) {
      items.set(candidate.id, candidate);
      return;
    }
    items.set(candidate.id, {
      ...current,
      sources: [...new Set([...current.sources, ...candidate.sources])],
      runtimeNodeId: current.runtimeNodeId ?? candidate.runtimeNodeId,
      activityIds: [...new Set([...current.activityIds, ...candidate.activityIds])],
      createdAt: [current.createdAt, candidate.createdAt].filter((value): value is string => Boolean(value)).sort().at(-1),
    });
  };

  for (const card of opsState.cards) {
    const role = roleByColumnId.get(card.columnId) ?? "queued";
    if (role === "done") continue;
    const cardRuntimes = [...new Set([...card.assigneeIds, ...(card.reviewerId ? [card.reviewerId] : [])])]
      .flatMap((nodeId) => runtimeById.get(nodeId) ?? []);
    const statuses = cardRuntimes.map((runtime) => runtime.status);
    const reason = opsAttentionReason(card, role, statuses, conflictingCardIds.has(card.id));
    if (!reason && role !== "review") continue;
    const target: AttentionTarget = role === "review"
      ? { kind: "review", cardId: card.id }
      : { kind: "ops", cardId: card.id };
    upsert({
      id: attentionTargetId(target),
      sources: role === "review" ? ["ops", "review"] : ["ops"],
      title: card.title,
      detail: reason ?? "Verification is ready for review.",
      status: statuses.find(needsAttention) ?? (role === "review" ? "review" : "attention"),
      target,
      runtimeNodeId: cardRuntimes.find((runtime) => needsAttention(runtime.status))?.nodeId,
      activityIds: [],
      createdAt: card.events?.at(-1)?.timestamp,
    });
  }

  for (const runtime of runtimes.filter((candidate) => needsAttention(candidate.status))) {
    const card = cardForNode.get(runtime.nodeId);
    const role = card ? roleByColumnId.get(card.columnId) : undefined;
    const target: AttentionTarget = card
      ? role === "review" ? { kind: "review", cardId: card.id } : { kind: "ops", cardId: card.id }
      : { kind: "pane", nodeId: runtime.nodeId, sessionId: runtime.sessionId };
    upsert({
      id: attentionTargetId(target),
      sources: ["runtime"],
      title: card?.title ?? runtime.nodeId,
      detail: runtime.statusSummary || `${runtime.adapterId} is ${resolveRunState(runtime.status).label.toLowerCase()}.`,
      status: runtime.status,
      target,
      runtimeNodeId: runtime.nodeId,
      activityIds: [],
    });
  }

  for (const event of activity.filter((candidate) => !candidate.isRead && needsAttention(candidate.status))) {
    const payloadCardId = stringField(event.payload, "taskId") ?? stringField(event.payload, "cardId");
    const payloadNodeId = event.nodeId ?? stringField(event.payload, "nodeId");
    const runtime = (payloadNodeId ? runtimeById.get(payloadNodeId) : undefined) ?? runtimeBySessionId.get(event.sessionId);
    const card = (payloadCardId ? cardById.get(payloadCardId) : undefined) ?? (runtime ? cardForNode.get(runtime.nodeId) : undefined);
    const role = card ? roleByColumnId.get(card.columnId) : undefined;
    const target: AttentionTarget | undefined = card
      ? role === "review" ? { kind: "review", cardId: card.id } : { kind: "ops", cardId: card.id }
      : runtime ? { kind: "pane", nodeId: runtime.nodeId, sessionId: runtime.sessionId }
      : payloadNodeId ? { kind: "pane", nodeId: payloadNodeId, sessionId: event.sessionId }
      : undefined;
    if (!target) continue;
    upsert({
      id: attentionTargetId(target),
      sources: ["activity"],
      title: card?.title ?? event.nodeTitle ?? (event.kind || "Activity"),
      detail: event.message,
      status: event.status,
      target,
      runtimeNodeId: runtime?.nodeId ?? payloadNodeId,
      activityIds: [event.id],
      createdAt: event.createdAt,
    });
  }

  return [...items.values()].sort((left, right) =>
    (right.createdAt ?? "").localeCompare(left.createdAt ?? "") || left.title.localeCompare(right.title));
}

function attentionTargetId(target: AttentionTarget): string {
  if (target.kind === "pane") return `pane:${target.nodeId}`;
  return `${target.kind}:${target.cardId}`;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}
