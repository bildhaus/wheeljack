import { describe, expect, test } from "vitest";
import { taskWorktreeCleanupPrompt, taskWorktreeRows } from "./taskWorktrees";
import type { GitStatus, OpsCard } from "./types";

const card = (overrides: Partial<OpsCard> = {}): OpsCard => ({
  id: "task-1",
  columnId: "done",
  title: "Preserve lane work",
  detail: "",
  assignee: "",
  priority: "medium",
  assigneeIds: [],
  agentStatuses: {},
  expectedFiles: [],
  lastNote: "",
  taskLane: {
    kind: "git-worktree",
    worktreePath: "C:\\repo-task",
    cwd: "C:\\repo-task",
    branch: "wheeljack/task-1",
    baseCommit: "abc",
  },
  ...overrides,
});

const git: GitStatus = {
  isRepo: true,
  pathExists: true,
  branch: "main",
  dirty: false,
  githubRemote: false,
  changedFiles: [],
  worktrees: [
    { path: "C:/repo", branch: "main", head: "abc", detached: false, bare: false, dirty: false },
    { path: "C:/repo-task", branch: "wheeljack/task-1", head: "def", detached: false, bare: false, dirty: true },
  ],
};

describe("task worktrees", () => {
  test("combines registered worktrees with linked and stale task lanes", () => {
    const stale = card({ id: "task-2", taskLane: { ...card().taskLane!, worktreePath: "C:\\missing", branch: "wheeljack/task-2" } });
    const rows = taskWorktreeRows(git, [card(), stale]);

    expect(rows.map((row) => [row.branch, row.registered, row.card?.id])).toEqual([
      ["main", true, undefined],
      ["wheeljack/task-1", true, "task-1"],
      ["wheeljack/task-2", false, "task-2"],
    ]);
    expect(rows[1].dirty).toBe(true);
  });

  test("tells cleanup agents to preserve work and finish cleanly", () => {
    const prompt = taskWorktreeCleanupPrompt(card({ taskLane: { ...card().taskLane!, cleanup: { action: "delete", status: "resolving", requestedAt: "now" } } }));
    expect(prompt).toContain("delete the task");
    expect(prompt).toContain("Preserve all valuable work by committing it");
    expect(prompt).toContain("git status --short");
    expect(prompt).toContain("automatically");
  });
});
