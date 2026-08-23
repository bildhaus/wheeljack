import type { GitStatus, GitWorktree, OpsCard } from "./types";

export interface TaskWorktreeRow {
  path: string;
  branch: string;
  dirty?: boolean;
  registered: boolean;
  primary: boolean;
  worktree?: GitWorktree;
  card?: OpsCard;
}

function normalizedPath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/\/+$/, "").toLocaleLowerCase();
}

export function taskWorktreeRows(git: GitStatus, cards: OpsCard[]): TaskWorktreeRow[] {
  const openLaneCards = cards.filter((card) => card.taskLane && !card.taskLane.closedAt);
  const linkedCard = (path: string) => openLaneCards.find((card) =>
    normalizedPath(card.taskLane!.worktreePath) === normalizedPath(path));
  const registered = git.worktrees.map((worktree) => ({
    path: worktree.path,
    branch: worktree.branch,
    dirty: worktree.dirty,
    registered: true,
    primary: worktree.branch === git.branch,
    worktree,
    card: linkedCard(worktree.path),
  }));
  const registeredPaths = new Set(registered.map((row) => normalizedPath(row.path)));
  const stale = openLaneCards.flatMap((card) => {
    const lane = card.taskLane!;
    return registeredPaths.has(normalizedPath(lane.worktreePath)) ? [] : [{
      path: lane.worktreePath,
      branch: lane.branch,
      registered: false,
      primary: false,
      card,
    }];
  });
  return [...registered, ...stale].sort((left, right) =>
    Number(right.primary) - Number(left.primary) || left.branch.localeCompare(right.branch));
}

export function taskWorktreeCleanupPrompt(card: OpsCard): string {
  const action = card.taskLane?.cleanup?.action ?? "remove";
  const outcome = action === "delete"
    ? "remove its worktree and delete the task"
    : action === "archive"
      ? "remove its worktree and archive the task"
      : "remove its worktree";
  return [
    `Prepare task worktree ${card.taskLane?.branch ?? ""} for safe cleanup so wheeljack can ${outcome}.`,
    "Inspect every staged, unstaged, and untracked change. Preserve all valuable work by committing it to this task branch; do not discard changes just to make the tree clean.",
    "Resolve any unfinished repository work you can resolve autonomously, then verify `git status --short` is empty.",
    "If safe cleanup is impossible, report the exact blocker. Otherwise finish normally; wheeljack will close the pane and complete the requested cleanup automatically.",
  ].join("\n\n");
}
