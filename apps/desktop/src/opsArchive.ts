import { isTerminalSessionStatus } from "./agentRuntime";
import { opsCardParticipantIds } from "./opsPresence";
import type { OpsState, PaneRuntime } from "./types";

export function archiveDoneOpsCardsSafely(
  state: OpsState,
  cardIds: readonly string[],
  runtimes: PaneRuntime[],
): OpsState {
  const requestedIds = new Set(cardIds);
  const doneColumnIds = new Set(state.columns.filter((column) => column.role === "done").map((column) => column.id));
  const selected = state.cards.filter((card) => requestedIds.has(card.id) && doneColumnIds.has(card.columnId));
  if (selected.length !== requestedIds.size) throw new Error("The completed task list changed. Review it and try again.");
  const blocked = selected.filter((card) =>
    (card.taskLane && !card.taskLane.closedAt)
    || opsCardParticipantIds(card, runtimes).some((id) => runtimes.some((runtime) =>
      runtime.nodeId === id && !isTerminalSessionStatus(runtime.status))));
  if (blocked.length) throw new Error(`${blocked.length} completed ${blocked.length === 1 ? "task still has" : "tasks still have"} an active agent or worktree.`);
  return archiveDoneOpsCards(state, cardIds);
}

export function archiveDoneOpsCards(state: OpsState, cardIds: readonly string[]): OpsState {
  const doneColumnIds = new Set(state.columns.filter((column) => column.role === "done").map((column) => column.id));
  const requestedIds = new Set(cardIds);
  const cards = state.cards.filter((card) => requestedIds.has(card.id) && doneColumnIds.has(card.columnId));
  if (!cards.length) return state;

  const archivedIds = new Set(cards.map((card) => card.id));
  return {
    ...state,
    cards: state.cards.filter((card) => !archivedIds.has(card.id)),
    archivedCards: [
      ...(state.archivedCards ?? []).filter((card) => !archivedIds.has(card.id)),
      ...cards,
    ],
  };
}

export function restoreArchivedOpsCards(state: OpsState, cardIds: readonly string[]): OpsState {
  const requestedIds = new Set(cardIds);
  const liveIds = new Set(state.cards.map((card) => card.id));
  const doneColumnId = state.columns.find((column) => column.role === "done")?.id;
  if (!doneColumnId) return state;

  const restored = (state.archivedCards ?? []).filter((entry) =>
    requestedIds.has(entry.id) && !liveIds.has(entry.id));
  if (!restored.length) return state;

  const restoredIds = new Set(restored.map((card) => card.id));
  return {
    ...state,
    cards: [
      ...state.cards,
      ...restored.map((card) => ({ ...card, columnId: doneColumnId })),
    ],
    archivedCards: (state.archivedCards ?? []).filter((card) => !restoredIds.has(card.id)),
  };
}
