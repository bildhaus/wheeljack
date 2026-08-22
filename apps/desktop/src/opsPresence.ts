import type { OpsCard, OpsDecompositionTaskDraft, OpsState, OpsSteeringDirective, PaneRuntime } from "./types";
import { resolveRunState, visibleRunStateDetail } from "./runState";

const presenceStatuses = new Set(["running", "in_progress", "blocked", "needs_input", "review"]);
const attentionStatuses = new Set(["blocked", "needs_input", "failed", "disconnected"]);
const coordinatingStatuses = new Set(["starting", "running", "in_progress"]);

export type OpsExecutionLane = "ready" | "running" | "attention" | "verifying" | "done";

export function opsNextAutonomousTask(state: Pick<OpsState, "cards" | "columns">): OpsCard | undefined {
  const queuedColumnIds = new Set(state.columns.filter((column) => column.role === "queued").map((column) => column.id));
  const doneColumnIds = new Set(state.columns.filter((column) => column.role === "done").map((column) => column.id));
  const byId = new Map(state.cards.map((card) => [card.id, card]));
  return state.cards.find((card) =>
    queuedColumnIds.has(card.columnId)
    && !card.paused
    && !card.assigneeIds.length
    && !card.taskLane?.closedAt
    && (card.dependencyIds ?? []).every((id) => {
      const dependency = byId.get(id);
      return dependency ? doneColumnIds.has(dependency.columnId) : false;
    }));
}

export function opsStatusAttentionReason(status: string): string | undefined {
  if (status === "needs_input") return "Agent needs an answer";
  if (status === "blocked") return "Agent reported a blocker";
  if (status === "failed") return "Agent run failed";
  if (status === "disconnected") return "Agent disconnected";
  return undefined;
}

export function opsAgentsCoordinating(statuses: string[], hasFileConflict: boolean): boolean {
  return hasFileConflict && statuses.some((status) => coordinatingStatuses.has(status));
}

export function opsCardActivitySummary(
  card: Pick<OpsCard, "lastNote" | "paused">,
  runtimes: Array<Pick<PaneRuntime, "status" | "statusSummary">>,
  conflictCount: number,
): string {
  const note = card.lastNote?.trim();
  if (note) return note;
  const statuses = runtimes.map((runtime) => runtime.status);
  if (opsAgentsCoordinating(statuses, conflictCount > 0)) {
    return `Coordinating on ${conflictCount} file ${conflictCount === 1 ? "conflict" : "conflicts"}`;
  }
  const detail = runtimes.reduce<string | undefined>(
    (summary, runtime) => summary ?? visibleRunStateDetail(runtime.status, runtime.statusSummary),
    undefined,
  );
  if (detail) return detail;
  if (card.paused) return "Paused";
  return runtimes.length ? resolveRunState(runtimes[0].status).label : "No active agent";
}

export function opsAttentionReason(
  card: OpsCard,
  role: "queued" | "active" | "review" | "done",
  statuses: string[],
  hasFileConflict: boolean,
): string | undefined {
  if (role === "done") return undefined;
  const attentionStatus = statuses.find((status) => attentionStatuses.has(status));
  if (attentionStatus) return opsStatusAttentionReason(attentionStatus);
  if (hasFileConflict && !opsAgentsCoordinating(statuses, hasFileConflict)) return "Overlapping file claims";
  if (card.paused) return "Work is paused";
  if (role === "review" && opsVerificationContractIssues(card).length) return "Verification contract is incomplete";
  if (role === "review" && opsReviewVerdict(card)?.status === "changes_requested") return "Reviewer requested changes";
  if (role === "review" && ["failed", "canceled", "interrupted"].includes(card.verificationRun?.status ?? "")) return "Verification needs to be rerun";
  if (role === "review" && card.approvalAttempt?.status === "blocked") return `Automatic approval blocked: ${card.approvalAttempt.message}`;
  if (role === "review" && card.verificationRun?.status === "running") return undefined;
  if (role === "active" && card.assigneeIds.length > 0 && statuses.length === 0) return "Assigned agent is no longer connected";
  if (role === "review" && card.reviewerId && statuses.length === 0 && !["completed", "done", "review"].includes(card.agentStatuses[card.reviewerId] ?? "")) return "Reviewer is no longer connected";
  if (role === "review" && card.reviewPolicy === "agent" && !card.reviewerId) return undefined;
  if (role === "review" && card.reviewPolicy === "agent" && card.reviewerId && !opsReviewVerdict(card)) {
    return statuses.some((status) => coordinatingStatuses.has(status)) ? undefined : "Reviewer verdict is missing";
  }
  if (role === "review" && !card.reviewerId && !opsHasReviewEvidence(card)) return "Verification needs an owner";
  return undefined;
}

export function opsExecutionLane(
  card: OpsCard,
  role: "queued" | "active" | "review" | "done",
  statuses: string[],
  hasFileConflict: boolean,
): OpsExecutionLane {
  if (role === "done") return "done";
  if (opsAttentionReason(card, role, statuses, hasFileConflict)) return "attention";
  if (role === "review") return "verifying";
  if (role === "active") return "running";
  return "ready";
}

export function opsVerificationProgress(card: OpsCard, hasFileConflict: boolean) {
  const checks = [
    { label: "Definition of done", passed: Boolean(card.definitionOfDone?.trim()) },
    { label: "Verification command", passed: Boolean(card.verificationCommand?.trim()) },
    { label: "Handoff recorded", passed: opsHasReviewEvidence(card) },
    { label: "No file conflicts", passed: !hasFileConflict },
    { label: "Verification passed", passed: card.verificationRun?.status === "passed" && card.verificationRun.exitCode === 0 && Boolean(card.verificationRun.snapshotId) },
    { label: "Approval finalized", passed: opsHasApprovalEvidence(card) },
  ];
  return { checks, passed: checks.filter((check) => check.passed).length, total: checks.length };
}

export function opsVerificationContractIssues(card: OpsCard): string[] {
  return [
    ...(!card.definitionOfDone?.trim() ? ["Definition of done is missing"] : []),
    ...(!card.verificationCommand?.trim() ? ["Verification command is missing"] : []),
  ];
}

export interface OpsReviewVerdict {
  status: "approved" | "changes_requested";
  message: string;
}

function currentWorkCycleEvents(card: OpsCard) {
  const events = card.events ?? [];
  let workRestart = -1;
  for (let index = events.length - 1; index >= 0; index--) {
    if (/^manual:(?:assign|transfer|resume):/.test(events[index].id)) {
      workRestart = index;
      break;
    }
  }
  return events.slice(workRestart + 1);
}

function reviewVerdictFromMessage(message: string): OpsReviewVerdict | undefined {
  const verdict = message.match(/REVIEW\s+VERDICT\s*:\s*([^\r\n]+)/i)?.[1]?.trim() ?? "";
  if (/^(?:APPROVE|APPROVED|PASS|PASSED)\b/i.test(verdict)) return { status: "approved", message };
  if (/^(?:REJECT|REJECTED|FAIL|FAILED|REQUEST(?:ED)?\s+CHANGES|CHANGES\s+REQUESTED)\b/i.test(verdict)) {
    return { status: "changes_requested", message };
  }
  return undefined;
}

export function opsReviewVerdict(card: OpsCard): OpsReviewVerdict | undefined {
  return currentWorkCycleEvents(card).slice().reverse().flatMap((event) => {
    if (event.id.startsWith("manual:")) return [];
    const verdict = reviewVerdictFromMessage(event.message);
    return verdict ? [verdict] : [];
  })[0];
}

export function opsReviewLabel(
  card: OpsCard,
  reviewerName?: string,
): string {
  if (!card.reviewerId) {
    if (card.reviewPolicy === "human") return "Human approval · Required";
    if (card.reviewPolicy === "either") return "Agent or human · Either";
    return "Agent · Automatic";
  }

  const verdict = opsReviewVerdict(card);
  const status = card.agentStatuses[card.reviewerId];
  const state = verdict?.status === "approved"
    ? "Approved"
    : verdict?.status === "changes_requested"
      ? "Changes requested"
      : status === "running" || status === "in_progress"
        ? "Running"
        : status ? resolveRunState(status).label : "Assigned";
  return `${reviewerName || card.reviewerId} · ${state}`;
}

function opsHasReviewEvidence(card: OpsCard): boolean {
  return Boolean(opsReviewVerdict(card)) || currentWorkCycleEvents(card).some((event) =>
    (event.kind === "handoff" || event.kind === "review")
    && !event.id.startsWith("manual:")
    && !reviewVerdictFromMessage(event.message));
}

function opsHasApprovalEvidence(card: OpsCard): boolean {
  return currentWorkCycleEvents(card).some((event) =>
    event.kind === "completion" && event.id.startsWith("manual:approve:"));
}

function sameWorkspacePath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "");
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  const windowsPaths = /^(?:[a-z]:\/|\/\/)/i.test(normalizedLeft) && /^(?:[a-z]:\/|\/\/)/i.test(normalizedRight);
  return Boolean(normalizedLeft) && (windowsPaths
    ? normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase()
    : normalizedLeft === normalizedRight);
}

export function opsVerificationStaleReason(card: OpsCard, snapshotId?: string): string | undefined {
  const run = card.verificationRun;
  if (!run || run.status !== "passed") return undefined;
  if (run.command !== card.verificationCommand) return "Verification command changed";
  if (!card.taskLane || card.taskLane.closedAt) return "Task worktree is no longer open";
  if (!sameWorkspacePath(run.worktreePath, card.taskLane.worktreePath)) return "Task worktree changed";
  if (!sameWorkspacePath(run.cwd, card.taskLane.cwd)) return "Task working directory changed";
  if (run.baseCommit !== card.taskLane.baseCommit) return "Task base commit changed";
  if (!run.snapshotId || !snapshotId || run.snapshotId !== snapshotId) return "Task snapshot changed";
  return undefined;
}

export function opsVerificationApproval(
  card: OpsCard,
  hasFileConflict: boolean,
  snapshotId?: string,
  approver: "human" | "agent" = "human",
): { ready: boolean; reason?: string } {
  const contractIssue = opsVerificationContractIssues(card)[0];
  if (contractIssue) return { ready: false, reason: contractIssue };
  if (!opsHasReviewEvidence(card)) {
    return { ready: false, reason: "Handoff or review evidence is missing" };
  }
  const verdict = opsReviewVerdict(card);
  if (verdict?.status === "changes_requested") return { ready: false, reason: "Reviewer requested changes" };
  const policy = card.reviewPolicy ?? "agent";
  if (approver === "human" && policy === "agent") return { ready: false, reason: "Agent reviewer approval is required" };
  if (approver === "agent" && policy === "human") return { ready: false, reason: "Human approval is required" };
  if (approver === "agent" && verdict?.status !== "approved") return { ready: false, reason: "Agent reviewer approval is missing" };
  if (hasFileConflict) return { ready: false, reason: "Task has a claimed-file conflict" };
  if (card.verificationRun?.status !== "passed" || card.verificationRun.exitCode !== 0) {
    return { ready: false, reason: "Verification has not passed" };
  }
  const stale = opsVerificationStaleReason(card, snapshotId);
  return stale ? { ready: false, reason: stale } : { ready: true };
}

export function opsCanCompleteWithOverride(card: OpsCard): boolean {
  return !card.taskLane;
}

export function opsVerificationCompletion(
  canceled: boolean,
  exitCode: number | undefined,
  snapshotId: string | undefined,
  endedAt: string,
): Pick<NonNullable<OpsCard["verificationRun"]>, "status" | "endedAt" | "exitCode" | "snapshotId" | "message"> {
  if (canceled) return { status: "canceled", endedAt, exitCode, snapshotId: undefined, message: "Verification canceled." };
  if (exitCode === 0 && snapshotId) return { status: "passed", endedAt, exitCode, snapshotId, message: "Verification passed." };
  return {
    status: "failed",
    endedAt,
    exitCode,
    snapshotId: undefined,
    message: exitCode === 0
      ? "Verification failed because its Git snapshot could not be captured."
      : exitCode === undefined
        ? "Verification ended without an exit code."
        : `Verification failed with exit code ${exitCode}.`,
  };
}

export function opsAgentPresence(cards: OpsCard[], runtimes: PaneRuntime[], activeColumnIds: ReadonlySet<string>) {
  const runtimeById = new Map(runtimes.map((runtime) => [runtime.nodeId, runtime]));
  const assigned = new Set<string>();
  return cards.flatMap((card) => {
    if (!activeColumnIds.has(card.columnId)) return [];
    return opsCardParticipantIds(card, runtimes).flatMap((agentId) => {
      const status = runtimeById.get(agentId)?.status;
      if (!status || !presenceStatuses.has(status) || assigned.has(agentId)) return [];
      assigned.add(agentId);
      return [{ agentId, cardId: card.id, status }];
    });
  });
}

export function opsCardParticipantIds(card: OpsCard, runtimes: PaneRuntime[]): string[] {
  const liveIds = new Set(runtimes.map((runtime) => runtime.nodeId));
  return [...new Set([
    ...card.assigneeIds,
    ...(card.reviewerId ? [card.reviewerId] : []),
    ...Object.keys(card.agentStatuses).filter((id) => liveIds.has(id)),
  ])];
}

export function opsCurrentCardForAgent(
  state: Pick<OpsState, "cards" | "columns">,
  agentId: string,
): OpsCard | undefined {
  const activeColumnIds = new Set(state.columns.filter((column) => ["active", "review"].includes(column.role)).map((column) => column.id));
  const assignedCards = state.cards.filter((card) => card.assigneeIds.includes(agentId) || card.reviewerId === agentId);
  return assignedCards.find((card) => activeColumnIds.has(card.columnId)) ?? assignedCards[0];
}

export function opsFileConflicts(cards: OpsCard[], activeColumnIds: ReadonlySet<string>) {
  const claims = new Map<string, { file: string; cardIds: Set<string> }>();
  for (const card of cards) {
    if (!activeColumnIds.has(card.columnId)) continue;
    for (const file of card.expectedFiles) {
      const key = opsFileClaimKey(file);
      if (!key) continue;
      const claim = claims.get(key) ?? { file: file.trim(), cardIds: new Set<string>() };
      claim.cardIds.add(card.id);
      claims.set(key, claim);
    }
  }
  return [...claims.values()]
    .filter((claim) => claim.cardIds.size > 1)
    .map((claim) => ({ file: claim.file, cardIds: [...claim.cardIds] }));
}

export function opsActiveFileConflicts(state: Pick<OpsState, "cards" | "columns">) {
  const activeColumnIds = new Set(state.columns.filter((column) => column.role === "active").map((column) => column.id));
  return opsFileConflicts(state.cards, activeColumnIds);
}

export interface OpsAutomaticFileConflictInstruction {
  cardId: string;
  claims: Array<{ file: string; ownerCardId: string }>;
}

export function opsFileConflictDirectiveIsCurrent(
  directive: OpsSteeringDirective | undefined,
  conflictFiles: string[],
): boolean {
  return directive?.kind === "file_conflict"
    && directive.status !== "canceled"
    && JSON.stringify([...(directive.conflictFiles ?? [])].sort()) === JSON.stringify([...conflictFiles].sort());
}

function fileConflictOwner(cards: OpsCard[], cardIds: string[]): string | undefined {
  const cardOrder = new Map(cards.map((card, index) => [card.id, index]));
  const priorityRank = (priority: string) => priority === "high" ? 0 : priority === "normal" ? 1 : 2;
  return cardIds
    .flatMap((id) => cards.find((card) => card.id === id) ?? [])
    .sort((left, right) =>
      priorityRank(left.priority) - priorityRank(right.priority)
      || (left.startedAt ?? "9999").localeCompare(right.startedAt ?? "9999")
      || (cardOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (cardOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER))[0]?.id;
}

export function opsAutomaticFileConflictInstructions(
  state: Pick<OpsState, "cards" | "columns">,
): OpsAutomaticFileConflictInstruction[] {
  const claimsByCard = new Map<string, Array<{ file: string; ownerCardId: string }>>();
  for (const conflict of opsActiveFileConflicts(state)) {
    const ownerCardId = fileConflictOwner(state.cards, conflict.cardIds);
    if (!ownerCardId) continue;
    for (const cardId of conflict.cardIds) {
      if (cardId === ownerCardId) continue;
      claimsByCard.set(cardId, [
        ...(claimsByCard.get(cardId) ?? []),
        { file: conflict.file, ownerCardId },
      ]);
    }
  }
  return [...claimsByCard.entries()].map(([cardId, claims]) => ({ cardId, claims }));
}

export function opsFileConflictNeedsAttention(
  state: Pick<OpsState, "cards" | "columns">,
  conflict: { file: string; cardIds: string[] },
  runtimes: PaneRuntime[],
): boolean {
  const runtimeById = new Map(runtimes.map((runtime) => [runtime.nodeId, runtime]));
  const instructionCardIds = new Set(opsAutomaticFileConflictInstructions(state)
    .filter((instruction) => instruction.claims.some((claim) => opsFileClaimKey(claim.file) === opsFileClaimKey(conflict.file)))
    .map((instruction) => instruction.cardId));
  return conflict.cardIds.some((cardId) => {
    if (!instructionCardIds.has(cardId)) return false;
    const card = state.cards.find((candidate) => candidate.id === cardId);
    const directive = card?.steeringDirective;
    if (directive?.kind !== "file_conflict" || !(directive.conflictFiles ?? []).some((file) => opsFileClaimKey(file) === opsFileClaimKey(conflict.file))) {
      return false;
    }
    if (directive.status === "failed") return true;
    if (directive.status === "canceled") return false;
    if (directive.status !== "delivered") return false;
    return card!.assigneeIds.some((id) => ["completed", "canceled", "failed", "disconnected"].includes(runtimeById.get(id)?.status ?? ""));
  });
}

export interface OpsAutomaticApprovalCandidate {
  card: OpsCard;
  hasFileConflict: boolean;
  key: string;
}

export function opsAutomaticApprovalCandidates(
  state: Pick<OpsState, "cards" | "columns">,
): OpsAutomaticApprovalCandidate[] {
  const reviewColumnIds = new Set(state.columns.filter((column) => column.role === "review").map((column) => column.id));
  return state.cards.flatMap((card) => {
    if (
      !reviewColumnIds.has(card.columnId)
      || !["agent", "either"].includes(card.reviewPolicy ?? "agent")
      || opsReviewVerdict(card)?.status !== "approved"
      || card.verificationRun?.status !== "passed"
      || !card.taskLane
      || card.taskLane.closedAt
    ) return [];
    const hasFileConflict = false;
    return [{
      card,
      hasFileConflict,
      key: JSON.stringify([
        card.id,
        card.reviewPolicy ?? "agent",
        card.verificationCommand ?? "",
        card.verificationRun.sessionId,
        card.verificationRun.snapshotId ?? "",
        card.events?.length ?? 0,
        card.taskLane.worktreePath,
        card.taskLane.cwd,
        card.taskLane.baseCommit,
        hasFileConflict,
      ]),
    }];
  });
}

export function opsNextAutomaticApprovalCandidate(
  candidates: OpsAutomaticApprovalCandidate[],
  retryAtByKey: ReadonlyMap<string, number>,
  now: number,
): { candidate?: OpsAutomaticApprovalCandidate; nextRetryAt?: number } {
  const candidate = candidates.find((item) => (retryAtByKey.get(item.key) ?? 0) <= now);
  if (candidate) return { candidate };
  const retryTimes = candidates.flatMap((item) => {
    const retryAt = retryAtByKey.get(item.key);
    return retryAt === undefined ? [] : [retryAt];
  });
  return { nextRetryAt: retryTimes.length ? Math.min(...retryTimes) : undefined };
}

export function opsAutomaticApprovalRetryDelay(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, Math.min(attempt - 1, 5)));
}

function opsFileClaimKey(file: string): string {
  const segments: string[] = [];
  for (const segment of file.trim().replaceAll("\\", "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === ".." && segments.length && segments.at(-1) !== "..") segments.pop();
    else segments.push(segment.toLowerCase());
  }
  return segments.join("/");
}

export function opsResolveFileConflict(
  state: OpsState,
  cardId: string,
  agentId: string,
  remainingFiles: string[],
): OpsState {
  const card = state.cards.find((candidate) => candidate.id === cardId);
  if (!card) throw new Error(`Task ${cardId} was not found.`);
  if (!card.assigneeIds.includes(agentId)) throw new Error("The requesting agent does not own this task.");

  const conflictsBefore = opsActiveFileConflicts(state)
    .filter((conflict) => conflict.cardIds.includes(cardId));
  if (!conflictsBefore.length) throw new Error("This task has no overlapping file claims to resolve.");

  const attributedFiles = card.agentFiles?.[agentId];
  if (!attributedFiles && card.assigneeIds.length !== 1) {
    throw new Error("This task's file claims are not attributed to the requesting agent.");
  }
  const currentFiles = attributedFiles ?? card.expectedFiles;
  const currentByKey = new Map(currentFiles.flatMap((file) => {
    const key = opsFileClaimKey(file);
    return key ? [[key, file.trim()] as const] : [];
  }));
  const remaining = [...new Set(remainingFiles.flatMap((file) => {
    const key = opsFileClaimKey(file);
    if (!key) return [];
    const claimed = currentByKey.get(key);
    if (!claimed) throw new Error(`Cannot claim ${file.trim()}: it was not already claimed by this agent.`);
    return [claimed];
  }))];
  const agentFiles = { ...card.agentFiles, [agentId]: remaining };
  const next: OpsState = {
    ...state,
    cards: state.cards.map((candidate) => candidate.id === cardId
      ? { ...candidate, agentFiles, expectedFiles: [...new Set(Object.values(agentFiles).flat())] }
      : candidate),
  };
  const conflictsAfter = opsActiveFileConflicts(next)
    .filter((conflict) => conflict.cardIds.includes(cardId));
  if (conflictsAfter.length >= conflictsBefore.length) {
    throw new Error("The remaining file claims must remove at least one overlap.");
  }
  return next;
}

export function opsDependencyPath(cards: OpsCard[], rootId: string): Set<string> {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const dependents = new Map<string, string[]>();
  for (const card of cards) {
    for (const dependencyId of card.dependencyIds ?? []) {
      dependents.set(dependencyId, [...(dependents.get(dependencyId) ?? []), card.id]);
    }
  }
  const path = new Set<string>();
  const visit = (id: string) => {
    if (path.has(id) || !byId.has(id)) return;
    path.add(id);
    for (const dependencyId of byId.get(id)?.dependencyIds ?? []) visit(dependencyId);
    for (const dependentId of dependents.get(id) ?? []) visit(dependentId);
  };
  visit(rootId);
  return path;
}

export function opsWouldCreateDependencyCycle(cards: OpsCard[], cardId: string, dependencyId: string): boolean {
  if (cardId === dependencyId) return true;
  const byId = new Map(cards.map((card) => [card.id, card]));
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (id === cardId) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return (byId.get(id)?.dependencyIds ?? []).some(visit);
  };
  return visit(dependencyId);
}

export function opsWaitingRelationships(cards: OpsCard[], doneColumnIds: ReadonlySet<string>) {
  const byId = new Map(cards.map((card) => [card.id, card]));
  return cards.flatMap((card) => {
    const waitingOnCardIds = (card.dependencyIds ?? []).filter((id) => {
      const dependency = byId.get(id);
      return dependency && !doneColumnIds.has(dependency.columnId);
    });
    if (!waitingOnCardIds.length) return [];
    const waitingOnAgentIds = [...new Set(waitingOnCardIds.flatMap((id) => byId.get(id)?.assigneeIds ?? []))];
    return [{ cardId: card.id, waitingOnCardIds, waitingOnAgentIds }];
  });
}

export function opsDecompositionHasCycle(tasks: OpsDecompositionTaskDraft[]): boolean {
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): boolean => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    const cyclic = (byKey.get(key)?.dependencyKeys ?? []).some((dependencyKey) => byKey.has(dependencyKey) && visit(dependencyKey));
    visiting.delete(key);
    visited.add(key);
    return cyclic;
  };
  return tasks.some((task) => visit(task.key));
}

export function opsDispatchableDecompositionKeys(
  tasks: OpsDecompositionTaskDraft[],
  readyAgentIds: ReadonlySet<string>,
): string[] {
  const selectedAgents = new Set<string>();
  const selectedFiles = new Set<string>();
  return tasks.flatMap((task) => {
    if (!task.agentId || !readyAgentIds.has(task.agentId) || task.dependencyKeys.length || selectedAgents.has(task.agentId)) return [];
    const files = task.expectedFiles.map((file) => file.trim().replaceAll("\\", "/").toLowerCase()).filter(Boolean);
    if (files.some((file) => selectedFiles.has(file))) return [];
    selectedAgents.add(task.agentId);
    files.forEach((file) => selectedFiles.add(file));
    return [task.key];
  });
}

export function opsChildProgress(cards: OpsCard[], parentId: string, doneColumnIds: ReadonlySet<string>) {
  const children = cards.filter((card) => card.parentId === parentId);
  return {
    done: children.filter((card) => doneColumnIds.has(card.columnId)).length,
    total: children.length,
  };
}
