import { defaultKanbanColumns, defaultOpsState } from "./state/opsStore";
import type {
  GitStatus,
  JsonObject,
  OpsCard,
  OpsRunProgress,
  OpsRunStepState,
  OpsState,
  OpsSteeringDirective,
  OpsTaskEvent,
  ProjectDocuments,
} from "./types";

function normalizedWorkspacePath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/^\/\/\?\/UNC\//i, "//")
    .replace(/^\/\/\?\//, "")
    .replace(/\/+$/, "");
}

export function workspacePathsEqual(left: string, right: string): boolean {
  const normalizedLeft = normalizedWorkspacePath(left);
  const normalizedRight = normalizedWorkspacePath(right);
  if (!normalizedLeft) return false;
  const windowsPaths = /^(?:[a-z]:\/|\/\/)/i.test(normalizedLeft) && /^(?:[a-z]:\/|\/\/)/i.test(normalizedRight);
  return windowsPaths
    ? normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase()
    : normalizedLeft === normalizedRight;
}

export function canonicalTaskLaneCwd(
  projectPath: string,
  worktrees: Array<Pick<GitStatus["worktrees"][number], "path">>,
  taskWorktreePath: string,
): string | undefined {
  const project = normalizedWorkspacePath(projectPath);
  const windowsPath = /^(?:[a-z]:\/|\/\/)/i.test(project);
  const comparable = (value: string) => windowsPath ? value.toLocaleLowerCase() : value;
  const source = worktrees
    .filter((worktree) => {
      const root = normalizedWorkspacePath(worktree.path);
      return comparable(project) === comparable(root) || comparable(project).startsWith(`${comparable(root)}/`);
    })
    .sort((left, right) =>
      normalizedWorkspacePath(right.path).length - normalizedWorkspacePath(left.path).length)[0];
  const target = worktrees.find((worktree) => workspacePathsEqual(worktree.path, taskWorktreePath));
  if (!source || !target || workspacePathsEqual(source.path, target.path)) return undefined;
  const relative = project.slice(normalizedWorkspacePath(source.path).length).replace(/^\/+/, "");
  const targetRoot = target.path.replace(/[\\/]+$/, "");
  if (!relative) return targetRoot;
  const separator = target.path.includes("\\") ? "\\" : "/";
  return `${targetRoot}${separator}${relative.replaceAll("/", separator)}`;
}

export function resolveAgentCwd(
  projectPath: string,
  taskLane?: OpsCard["taskLane"],
  persistedCwd?: string,
): string {
  if (taskLane?.closedAt) throw new Error(`Task worktree ${taskLane.branch} has been removed.`);
  return taskLane?.cwd || persistedCwd || projectPath;
}

export function hasMeaningfulPlanState(state: OpsState): boolean {
  const defaults = defaultKanbanColumns();
  return state.cards.length > 0
    || Boolean(state.prd.trim() || state.tdd.trim())
    || state.columns.length !== defaults.length
    || state.columns.some((column, index) => {
      const fallback = defaults[index];
      return !fallback
        || column.id !== fallback.id
        || column.title !== fallback.title
        || column.role !== fallback.role;
    });
}

export function focusedPaneElement(id: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>("[data-pane-id]")].find((pane) => pane.dataset.paneId === id);
}

export function hasProjectPlanDocuments(documents?: ProjectDocuments): boolean {
  return Boolean(documents && Object.values(documents.documents).some((document) => document.exists));
}

function parseOpsTaskLane(value: unknown): OpsCard["taskLane"] {
  if (!value || typeof value !== "object") return undefined;
  const lane = value as Record<string, unknown>;
  if (
    lane.kind !== "git-worktree" ||
    typeof lane.worktreePath !== "string" ||
    typeof lane.cwd !== "string" ||
    typeof lane.branch !== "string" ||
    typeof lane.baseCommit !== "string" ||
    !lane.worktreePath ||
    !lane.cwd ||
    !lane.branch ||
    !lane.baseCommit
  ) return undefined;
  return {
    kind: "git-worktree",
    worktreePath: lane.worktreePath,
    cwd: lane.cwd,
    branch: lane.branch,
    baseCommit: lane.baseCommit,
    closedAt: typeof lane.closedAt === "string" ? lane.closedAt : undefined,
  };
}

function parseOpsVerificationRun(value: unknown): OpsCard["verificationRun"] {
  if (!value || typeof value !== "object") return undefined;
  const run = value as Record<string, unknown>;
  if (
    typeof run.sessionId !== "string" ||
    typeof run.command !== "string" ||
    typeof run.worktreePath !== "string" ||
    typeof run.cwd !== "string" ||
    typeof run.baseCommit !== "string" ||
    typeof run.startedAt !== "string" ||
    !["running", "passed", "failed", "canceled", "interrupted"].includes(String(run.status))
  ) return undefined;
  return {
    sessionId: run.sessionId,
    command: run.command,
    worktreePath: run.worktreePath,
    cwd: run.cwd,
    baseCommit: run.baseCommit,
    status: run.status as NonNullable<OpsCard["verificationRun"]>["status"],
    startedAt: run.startedAt,
    endedAt: typeof run.endedAt === "string" ? run.endedAt : undefined,
    exitCode: typeof run.exitCode === "number" ? run.exitCode : undefined,
    snapshotId: typeof run.snapshotId === "string" ? run.snapshotId : undefined,
    message: typeof run.message === "string" ? run.message : undefined,
  };
}

function parseOpsApprovalAttempt(value: unknown): OpsCard["approvalAttempt"] {
  if (!value || typeof value !== "object") return undefined;
  const attempt = value as Record<string, unknown>;
  if (
    !["blocked", "retrying"].includes(String(attempt.status))
    || typeof attempt.message !== "string"
    || typeof attempt.attemptedAt !== "string"
  ) return undefined;
  return {
    status: attempt.status as NonNullable<OpsCard["approvalAttempt"]>["status"],
    message: attempt.message,
    attemptedAt: attempt.attemptedAt,
  };
}

export function recoverOpsVerificationRuns(
  state: OpsState,
  runningSessionIds: ReadonlySet<string>,
  pendingExitSessionIds: ReadonlySet<string>,
  timestamp = new Date().toISOString(),
): OpsState {
  return {
    ...state,
    cards: state.cards.map((card) =>
      card.verificationRun?.status === "running" &&
      !runningSessionIds.has(card.verificationRun.sessionId) &&
      !pendingExitSessionIds.has(card.verificationRun.sessionId)
        ? {
            ...card,
            verificationRun: {
              ...card.verificationRun,
              status: "interrupted",
              endedAt: timestamp,
              message: "Verification was interrupted when wheeljack restarted.",
            },
          }
        : card),
  };
}

const opsRunStepStates = new Set<OpsRunStepState>(["pending", "running", "blocked", "done", "failed"]);

export function parseOpsRunProgress(value: unknown): OpsRunProgress | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.runId !== "string" || !item.runId.trim() || item.runId.length > 160) return undefined;
  if (typeof item.updatedAt !== "string" || !Number.isFinite(Date.parse(item.updatedAt))) return undefined;
  if (!Array.isArray(item.steps) || item.steps.length > 32) return undefined;
  const steps = item.steps.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const step = candidate as Record<string, unknown>;
    if (
      typeof step.id !== "string" || !step.id.trim() || step.id.length > 120
      || typeof step.label !== "string" || !step.label.trim() || step.label.length > 500
      || !opsRunStepStates.has(step.state as OpsRunStepState)
    ) return [];
    return [{ id: step.id, label: step.label, state: step.state as OpsRunStepState }];
  });
  if (steps.length !== item.steps.length) return undefined;
  const currentStepId = typeof item.currentStepId === "string" && steps.some((step) => step.id === item.currentStepId)
    ? item.currentStepId
    : undefined;
  return { runId: item.runId, updatedAt: item.updatedAt, currentStepId, steps };
}

export function parseOpsSteeringDirective(value: unknown): OpsSteeringDirective | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" || !item.id.trim() || item.id.length > 160
    || typeof item.text !== "string" || !item.text.trim() || item.text.length > 4_000
    || typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt))
    || !["queued", "delivering", "delivered", "canceled", "failed"].includes(String(item.status))
  ) return undefined;
  return {
    id: item.id,
    text: item.text,
    createdAt: item.createdAt,
    status: item.status === "delivering" ? "failed" : item.status as OpsSteeringDirective["status"],
    kind: item.kind === "file_conflict" ? "file_conflict" : undefined,
    conflictFiles: item.kind === "file_conflict" && Array.isArray(item.conflictFiles)
      ? item.conflictFiles.filter((file): file is string => typeof file === "string" && Boolean(file.trim())).slice(0, 64)
      : undefined,
    deliveredAt: typeof item.deliveredAt === "string" && Number.isFinite(Date.parse(item.deliveredAt)) ? item.deliveredAt : undefined,
    error: item.status === "delivering"
      ? "Direction delivery was interrupted. Retry or cancel it."
      : typeof item.error === "string" ? item.error.slice(0, 2_000) : undefined,
  };
}

function parseOpsCards(value: unknown): OpsCard[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.title !== "string") return [];
    return [{
      id: item.id,
      columnId: typeof item.columnId === "string" ? item.columnId : "queued",
      title: item.title,
      detail: typeof item.detail === "string" ? item.detail : "",
      assignee: typeof item.assignee === "string" ? item.assignee : "Unassigned",
      priority: typeof item.priority === "string" ? item.priority : "normal",
      assigneeIds: Array.isArray(item.assigneeIds) ? item.assigneeIds.filter((id): id is string => typeof id === "string") : [],
      agentStatuses: item.agentStatuses && typeof item.agentStatuses === "object"
        ? Object.fromEntries(Object.entries(item.agentStatuses).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
        : {},
      expectedFiles: Array.isArray(item.expectedFiles) ? item.expectedFiles.filter((file): file is string => typeof file === "string") : [],
      lastNote: typeof item.lastNote === "string" ? item.lastNote : "",
      agentFiles: item.agentFiles && typeof item.agentFiles === "object"
        ? Object.fromEntries(Object.entries(item.agentFiles).flatMap(([id, files]) =>
            Array.isArray(files) ? [[id, files.filter((file): file is string => typeof file === "string")]] : []))
        : {},
      dependencyIds: Array.isArray(item.dependencyIds) ? item.dependencyIds.filter((id): id is string => typeof id === "string") : [],
      parentId: typeof item.parentId === "string" ? item.parentId : undefined,
      events: Array.isArray(item.events) ? item.events.flatMap((event) => {
        if (!event || typeof event !== "object") return [];
        const entry = event as Record<string, unknown>;
        if (
          typeof entry.id !== "string" ||
          typeof entry.timestamp !== "string" ||
          typeof entry.message !== "string" ||
          !["assignment", "handoff", "blocker", "review", "completion", "pause", "update"].includes(String(entry.kind))
        ) return [];
        return [{
          id: entry.id,
          kind: entry.kind as OpsTaskEvent["kind"],
          timestamp: entry.timestamp,
          message: entry.message,
          callsign: typeof entry.callsign === "string" ? entry.callsign : undefined,
          targetId: typeof entry.targetId === "string" ? entry.targetId : undefined,
          files: Array.isArray(entry.files) ? entry.files.filter((file): file is string => typeof file === "string") : undefined,
          status: typeof entry.status === "string" ? entry.status : undefined,
          runId: typeof entry.runId === "string" ? entry.runId : undefined,
        }];
      }) : [],
      startedAt: typeof item.startedAt === "string" ? item.startedAt : undefined,
      completedAt: typeof item.completedAt === "string" ? item.completedAt : undefined,
      pausedAt: typeof item.pausedAt === "string" ? item.pausedAt : undefined,
      paused: item.paused === true,
      reviewerId: typeof item.reviewerId === "string" ? item.reviewerId : undefined,
      definitionOfDone: typeof item.definitionOfDone === "string" ? item.definitionOfDone : "",
      constraints: typeof item.constraints === "string" ? item.constraints : "",
      verificationCommand: typeof item.verificationCommand === "string" ? item.verificationCommand : "",
      verificationRun: parseOpsVerificationRun(item.verificationRun),
      runProgress: parseOpsRunProgress(item.runProgress),
      steeringDirective: parseOpsSteeringDirective(item.steeringDirective),
      approvalAttempt: parseOpsApprovalAttempt(item.approvalAttempt),
      reviewPolicy: ["human", "agent", "either"].includes(String(item.reviewPolicy))
        ? item.reviewPolicy as "human" | "agent" | "either"
        : "agent",
      taskLane: parseOpsTaskLane(item.taskLane),
    }];
  });
}

export function parseOpsState(value?: JsonObject): OpsState {
  if (!value || value.version !== 2 || !Array.isArray(value.cards)) {
    return defaultOpsState();
  }
  const cards = parseOpsCards(value.cards);
  const liveCardIds = new Set(cards.map((card) => card.id));
  const archivedCards = parseOpsCards(value.archivedCards).filter((card) => !liveCardIds.has(card.id));
  const columns = Array.isArray(value.columns)
    ? value.columns.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const item = candidate as Record<string, unknown>;
        if (
          typeof item.id !== "string" ||
          typeof item.title !== "string" ||
          !["queued", "active", "review", "done"].includes(String(item.role))
        ) return [];
        return [{ id: item.id, title: item.title, role: item.role as "queued" | "active" | "review" | "done" }];
      })
    : [];
  return {
    version: 2,
    columns: columns.length ? columns : defaultKanbanColumns(),
    cards,
    archivedCards,
    prd: typeof value.prd === "string" ? value.prd : "",
    tdd: typeof value.tdd === "string" ? value.tdd : "",
    eventCursors: value.eventCursors && typeof value.eventCursors === "object"
      ? value.eventCursors as Record<string, number>
      : {},
    agentLabels: value.agentLabels as Record<string, string> ?? {},
  };
}

export function columnIdForRole(state: OpsState, role: string): string {
  return state.columns.find((column) => column.role === role)?.id
    ?? state.columns[0]?.id
    ?? role;
}

export function kanbanVerificationContractIssues(content: string): string[] {
  const issues: string[] = [];
  const lines = content.split(/\r?\n/);
  let columnRole = "queued";
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line.startsWith("<!-- wheeljack:column ") && line.endsWith(" -->")) {
      try {
        const metadata = JSON.parse(line.slice("<!-- wheeljack:column ".length, -" -->".length)) as Record<string, unknown>;
        columnRole = typeof metadata.role === "string" ? metadata.role : "queued";
      } catch {
        columnRole = "queued";
      }
      continue;
    }
    const title = line.match(/^- \[[ xX]\] (.+)$/)?.[1]?.trim();
    if (!title || columnRole === "done") continue;
    const metadataLine = lines[index + 1]?.trim() ?? "";
    try {
      if (!metadataLine.startsWith("<!-- wheeljack:task ") || !metadataLine.endsWith(" -->")) throw new Error();
      const metadata = JSON.parse(metadataLine.slice("<!-- wheeljack:task ".length, -" -->".length)) as Record<string, unknown>;
      if (
        typeof metadata.definitionOfDone !== "string" || !metadata.definitionOfDone.trim() ||
        typeof metadata.verificationCommand !== "string" || !metadata.verificationCommand.trim()
      ) issues.push(title);
    } catch {
      issues.push(title);
    }
  }
  return issues;
}

export function renderKanban(state: OpsState): string {
  let output = "---\nwheeljack-kanban: 1\n---\n\n# Kanban\n";
  for (const column of state.columns) {
    output += `\n## ${column.title.trim()}\n<!-- wheeljack:column ${JSON.stringify({ id: column.id, role: column.role })} -->\n`;
    for (const card of state.cards.filter((candidate) => candidate.columnId === column.id)) {
      output += `\n- [${column.role === "done" ? "x" : " "}] ${card.title.trim()}\n`;
      output += `  <!-- wheeljack:task ${JSON.stringify({
        id: card.id,
        priority: card.priority,
        assignee: card.assignee,
        parentId: card.parentId,
        definitionOfDone: card.definitionOfDone ?? "",
        constraints: card.constraints ?? "",
        verificationCommand: card.verificationCommand ?? "",
        reviewPolicy: card.reviewPolicy ?? "agent",
      })} -->\n`;
      const detailLines = card.detail ? card.detail.split(/\r?\n/) : [];
      if (detailLines.at(-1) === "") detailLines.pop();
      for (const line of detailLines) {
        output += `  ${line.trimEnd()}\n`;
      }
    }
  }
  return output;
}

export function mergeProjectDocuments(current: OpsState, documents: ProjectDocuments): OpsState {
  const kanban = documents.documents.kanban;
  const existing = new Map(current.cards.map((card) => [card.id, card]));
  const board = kanban.exists && kanban.board
    ? {
        columns: kanban.board.columns,
        cards: kanban.board.cards.map((card) => {
          const currentCard = existing.get(card.id);
          const currentRole = current.columns.find((column) => column.id === currentCard?.columnId)?.role;
          const importedRole = kanban.board?.columns.find((column) => column.id === card.columnId)?.role;
          const protectedColumnId = kanban.board?.columns.find((column) => column.role === currentRole)?.id
            ?? currentCard?.columnId;
          const columnId = currentCard?.taskLane && !currentCard.taskLane.closedAt && currentRole !== "done" && importedRole === "done"
            ? protectedColumnId ?? card.columnId
            : card.columnId;
          return {
            ...card,
            columnId,
            assigneeIds: currentCard?.assigneeIds ?? [],
            agentStatuses: currentCard?.agentStatuses ?? {},
            expectedFiles: currentCard?.expectedFiles ?? [],
            lastNote: currentCard?.lastNote ?? "",
            agentFiles: currentCard?.agentFiles ?? {},
            dependencyIds: currentCard?.dependencyIds ?? [],
            parentId: currentCard?.parentId,
            events: currentCard?.events ?? [],
            startedAt: currentCard?.startedAt,
            completedAt: currentCard?.completedAt,
            pausedAt: currentCard?.pausedAt,
            paused: currentCard?.paused ?? false,
            reviewerId: currentCard?.reviewerId,
            definitionOfDone: currentCard?.definitionOfDone || card.definitionOfDone || "",
            constraints: currentCard?.constraints || card.constraints || "",
            verificationCommand: currentCard?.verificationCommand || card.verificationCommand || "",
            verificationRun: currentCard?.verificationRun,
            runProgress: currentCard?.runProgress,
            steeringDirective: currentCard?.steeringDirective,
            approvalAttempt: currentCard?.approvalAttempt,
            reviewPolicy: currentCard?.reviewPolicy ?? card.reviewPolicy ?? "agent",
            taskLane: currentCard?.taskLane,
            workerSpecialist: currentCard?.workerSpecialist,
            reviewerSpecialist: currentCard?.reviewerSpecialist,
          };
        }),
      }
    : { columns: current.columns, cards: current.cards };
  return {
    ...current,
    ...board,
    prd: documents.documents.prd.exists ? documents.documents.prd.content : current.prd,
    tdd: documents.documents.tdd.exists ? documents.documents.tdd.content : current.tdd,
  };
}
