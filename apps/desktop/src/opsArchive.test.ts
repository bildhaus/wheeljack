import { describe, expect, test } from "vitest";
import { archiveDoneOpsCards, archiveDoneOpsCardsSafely, restoreArchivedOpsCards } from "./opsArchive";
import { parseOpsState, renderKanban } from "./opsOrchestration";
import { opsNextAutonomousTask } from "./opsPresence";
import type { OpsCard, OpsState } from "./types";

const columns: OpsState["columns"] = [
  { id: "ready", title: "Ready", role: "queued" },
  { id: "working", title: "Working", role: "active" },
  { id: "checking", title: "Checking", role: "review" },
  { id: "landed", title: "Landed", role: "done" },
];

function card(id: string, columnId: string, patch: Partial<OpsCard> = {}): OpsCard {
  return {
    id,
    columnId,
    title: id,
    detail: "",
    assignee: "Unassigned",
    priority: "normal",
    assigneeIds: [],
    agentStatuses: {},
    expectedFiles: [],
    lastNote: "",
    ...patch,
  };
}

function state(cards: OpsCard[]): OpsState {
  return { version: 2, columns, cards, prd: "", tdd: "", eventCursors: {} };
}

describe("completed task archive", () => {
  test("archives only requested Done cards and removes them from KANBAN.md", () => {
    const completed = card("completed", "landed", {
      events: [{ id: "event-1", kind: "completion", timestamp: "2026-08-23T10:00:00Z", message: "Verified" }],
    });
    const current = card("current", "working");

    const archived = archiveDoneOpsCards(state([completed, current]), ["completed", "current"]);

    expect(archived.cards).toEqual([current]);
    expect(archived.archivedCards).toEqual([completed]);
    expect(renderKanban(archived)).not.toContain("completed");
  });

  test("round-trips archived task history through durable ops state", () => {
    const archived = archiveDoneOpsCards(state([card("completed", "landed", {
      events: [{ id: "event-1", kind: "completion", timestamp: "2026-08-23T10:00:00Z", message: "Verified" }],
      verificationRun: { sessionId: "verify-1", command: "bun test", worktreePath: "C:\\repo", cwd: "C:\\repo", baseCommit: "abc123", status: "passed", startedAt: "2026-08-23T10:00:00Z", endedAt: "2026-08-23T10:01:00Z", exitCode: 0 },
    })]), ["completed"]);

    const parsed = parseOpsState(JSON.parse(JSON.stringify(archived)));

    expect(parsed.archivedCards?.[0]).toMatchObject({
      id: "completed",
      events: [{ id: "event-1", message: "Verified" }],
      verificationRun: { sessionId: "verify-1", status: "passed", exitCode: 0 },
    });
  });

  test("treats archived dependencies as completed and restores them to the current Done column", () => {
    const ready = card("ready", "ready", { dependencyIds: ["completed"] });
    const archived = archiveDoneOpsCards(state([card("completed", "landed"), ready]), ["completed"]);

    expect(opsNextAutonomousTask(archived)?.id).toBe("ready");

    const restored = restoreArchivedOpsCards(archived, ["completed"]);
    expect(restored.cards.find((item) => item.id === "completed")?.columnId).toBe("landed");
    expect(restored.archivedCards).toEqual([]);
  });

  test("rejects completed cards with active agents or worktrees", () => {
    const activeAgent = card("agent-task", "landed", { assigneeIds: ["agent-1"] });
    const activeWorktree = card("lane-task", "landed", {
      taskLane: { kind: "git-worktree", worktreePath: "C:\\worktree", cwd: "C:\\worktree", branch: "task/lane", baseCommit: "abc123" },
    });

    expect(() => archiveDoneOpsCardsSafely(state([activeAgent]), [activeAgent.id], [{ nodeId: "agent-1", status: "running" } as never])).toThrow("active agent or worktree");
    expect(() => archiveDoneOpsCardsSafely(state([activeWorktree]), [activeWorktree.id], [])).toThrow("active agent or worktree");
  });
});
