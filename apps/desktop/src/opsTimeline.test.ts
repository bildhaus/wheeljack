import { describe, expect, test } from "vitest";

import { opsTaskTimeline } from "./opsTimeline";
import type { CanvasNode, OpsCard } from "./types";

describe("task timeline", () => {
  test("combines lifecycle, agent, coordination, workspace, and verification evidence", () => {
    const card = {
      id: "task-1",
      columnId: "review",
      title: "Ship it",
      detail: "",
      assignee: "Agent 1",
      priority: "normal",
      assigneeIds: ["node-1"],
      agentStatuses: { "node-1": "completed" },
      expectedFiles: [],
      lastNote: "",
      startedAt: "2026-08-08T10:00:00Z",
      completedAt: "2026-08-08T10:20:00Z",
      events: [{ id: "handoff", kind: "handoff", timestamp: "2026-08-08T10:15:00Z", message: "Ready for review", callsign: "node-1" }],
      verificationRun: {
        sessionId: "verify-1",
        command: "bun test",
        worktreePath: "C:/task",
        cwd: "C:/task",
        baseCommit: "abc",
        status: "passed",
        startedAt: "2026-08-08T10:16:00Z",
        endedAt: "2026-08-08T10:19:00Z",
      },
      taskLane: {
        kind: "git-worktree",
        worktreePath: "C:/task",
        cwd: "C:/task",
        branch: "task-1",
        baseCommit: "abc",
        closedAt: "2026-08-08T10:21:00Z",
      },
    } satisfies OpsCard;
    const node = {
      id: "node-1",
      canvasId: "canvas-1",
      kind: "agent_terminal",
      title: "Codex 1",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      zIndex: 0,
      data: { taskId: "task-1", taskRole: "worker" },
      createdAt: "2026-08-08T10:01:00Z",
      updatedAt: "2026-08-08T10:20:00Z",
    } satisfies CanvasNode;

    const timeline = opsTaskTimeline(card, [node]);
    expect(timeline[0]).toMatchObject({ source: "workspace", message: "Task worktree removed" });
    expect(timeline.map((item) => item.source)).toEqual(expect.arrayContaining(["task", "agent", "verification", "workspace"]));
    expect(timeline.find((item) => item.id === "event:handoff")?.actor).toBe("node-1");
  });
});
