import { describe, expect, it } from "vitest";
import {
  opsAgentsCoordinating,
  opsAgentPresence,
  opsActiveFileConflicts,
  opsAttentionReason,
  opsAutomaticApprovalCandidates,
  opsAutomaticApprovalRetryDelay,
  opsAutomaticFileConflictInstructions,
  opsCardActivitySummary,
  opsCardParticipantIds,
  opsCanCompleteWithOverride,
  opsCurrentCardForAgent,
  opsNextAutonomousTask,
  opsNextAutomaticApprovalCandidate,
  opsDecompositionHasCycle,
  opsDependencyPath,
  opsDispatchableDecompositionKeys,
  opsExecutionLane,
  opsFileConflictDirectiveIsCurrent,
  opsFileConflicts,
  opsFileConflictNeedsAttention,
  opsChildProgress,
  opsStatusAttentionReason,
  opsReviewLabel,
  opsReviewVerdict,
  opsResolveFileConflict,
  opsVerificationContractIssues,
  opsVerificationProgress,
  opsVerificationApproval,
  opsVerificationCompletion,
  opsVerificationStaleReason,
  opsWaitingRelationships,
  opsWouldCreateDependencyCycle,
} from "./opsPresence";
import type { OpsCard, OpsState, PaneRuntime } from "./types";

const card = (id: string, columnId: string, expectedFiles: string[]): OpsCard => ({
  id,
  columnId,
  expectedFiles,
  title: id,
  detail: "",
  assignee: "Unassigned",
  priority: "normal",
  assigneeIds: [],
  agentStatuses: {},
  lastNote: "",
});

describe("ops presence", () => {
  it("presents review policy as automatic until the assigned reviewer takes over", () => {
    const review = { ...card("review", "review", []), reviewPolicy: "agent" as const };
    expect(opsReviewLabel(review)).toBe("Reconciler · Automatic");
    expect(opsReviewLabel({ ...review, reviewPolicy: "human" })).toBe("Human acceptance · Required");
    expect(opsReviewLabel({ ...review, reviewerId: "reviewer", agentStatuses: { reviewer: "running" } }, "Codex")).toBe("Codex · Running");
    expect(opsReviewLabel({ ...review, reviewerId: "removed-reviewer", agentStatuses: { "removed-reviewer": "completed" } })).toBe("Reviewer · Verdict missing");
    expect(opsReviewLabel({
      ...review,
      reviewerId: "reviewer",
      agentStatuses: { reviewer: "completed" },
      events: [{ id: "reviewer.ndjson:1", kind: "handoff", timestamp: "2026-08-22T10:00:00Z", message: "REVIEW VERDICT: APPROVE — verified." }],
    }, "Codex")).toBe("Codex · Approved");
  });

  it("lets an owning agent release overlapping claims without changing its peer", () => {
    const state: OpsState = {
      version: 2,
      columns: [
        { id: "queued", title: "Queued", role: "queued" },
        { id: "active", title: "Active", role: "active" },
        { id: "review", title: "Review", role: "review" },
        { id: "done", title: "Done", role: "done" },
      ],
      cards: [
        { ...card("first", "active", ["src/App.tsx"]), assigneeIds: ["alpha"], agentFiles: { alpha: ["src/App.tsx"] } },
        { ...card("second", "active", ["src/App.tsx"]), assigneeIds: ["beta"], agentFiles: { beta: ["src/App.tsx"] } },
      ],
      prd: "",
      tdd: "",
      eventCursors: {},
    };

    const resolved = opsResolveFileConflict(state, "first", "alpha", []);
    expect(opsFileConflicts(resolved.cards, new Set(["active", "review"]))).toEqual([]);
    expect(resolved.cards[0].expectedFiles).toEqual([]);
    expect(resolved.cards[1].expectedFiles).toEqual(["src/App.tsx"]);
    expect(() => opsResolveFileConflict(state, "first", "beta", [])).toThrow(/does not own/);
    expect(() => opsResolveFileConflict(state, "first", "alpha", ["src/new.ts"])).toThrow(/already claimed/);
  });

  it("reports normalized overlapping file claims only across running tasks", () => {
    const conflicts = opsActiveFileConflicts({
      columns: [
        { id: "active", title: "Active", role: "active" },
        { id: "review", title: "Review", role: "review" },
        { id: "done", title: "Done", role: "done" },
      ],
      cards: [
        card("a", "active", ["src\\App.tsx", "src/App.tsx"]),
        card("b", "review", ["./src//nested/../App.tsx"]),
        card("c", "active", ["./src//nested/../App.tsx"]),
        card("d", "done", ["src/App.tsx"]),
      ],
    });

    expect(conflicts).toEqual([{ file: "src\\App.tsx", cardIds: ["a", "c"] }]);
  });

  it("elects deterministic owners and escalates only stalled automatic conflict resolution", () => {
    const state: OpsState = {
      version: 2,
      columns: [
        { id: "queued", title: "Queued", role: "queued" },
        { id: "active", title: "Active", role: "active" },
      ],
      cards: [
        { ...card("first", "active", ["src/shared.ts", "src/other.ts"]), assigneeIds: ["alpha"], startedAt: "2026-08-19T10:00:00Z" },
        { ...card("priority", "active", ["src/shared.ts"]), priority: "high", assigneeIds: ["beta"], startedAt: "2026-08-19T11:00:00Z" },
        { ...card("later", "active", ["src/other.ts"]), assigneeIds: ["gamma"], startedAt: "2026-08-19T12:00:00Z" },
      ],
      prd: "",
      tdd: "",
      eventCursors: {},
    };

    expect(opsAutomaticFileConflictInstructions(state)).toEqual([
      { cardId: "first", claims: [{ file: "src/shared.ts", ownerCardId: "priority" }] },
      { cardId: "later", claims: [{ file: "src/other.ts", ownerCardId: "first" }] },
    ]);
    const conflict = opsActiveFileConflicts(state)[0];
    const runtimes = [
      { nodeId: "alpha", status: "running" },
      { nodeId: "beta", status: "running" },
    ] as PaneRuntime[];
    expect(opsFileConflictNeedsAttention(state, conflict, runtimes)).toBe(false);

    const stalled = {
      ...state,
      cards: state.cards.map((item) => item.id === "first" ? {
        ...item,
        steeringDirective: {
          id: "resolve-shared",
          text: "Yield shared",
          createdAt: "2026-08-19T12:01:00Z",
          status: "failed" as const,
          kind: "file_conflict" as const,
          conflictFiles: ["src/shared.ts"],
        },
      } : item),
    };
    expect(opsFileConflictNeedsAttention(stalled, conflict, runtimes)).toBe(true);
    const canceled = {
      ...stalled,
      cards: stalled.cards.map((item) => item.id === "first" && item.steeringDirective
        ? { ...item, steeringDirective: { ...item.steeringDirective, status: "canceled" as const } }
        : item),
    };
    expect(opsFileConflictNeedsAttention(canceled, conflict, runtimes)).toBe(false);
  });

  it("does not reuse a canceled automatic conflict directive when the overlap returns", () => {
    const directive = {
      id: "resolve-shared",
      text: "Yield shared",
      createdAt: "2026-08-19T12:01:00Z",
      status: "canceled" as const,
      kind: "file_conflict" as const,
      conflictFiles: ["src/shared.ts"],
    };

    expect(opsFileConflictDirectiveIsCurrent(directive, ["src/shared.ts"])).toBe(false);
    expect(opsFileConflictDirectiveIsCurrent({ ...directive, status: "queued" }, ["src/shared.ts"])).toBe(true);
    expect(opsFileConflictDirectiveIsCurrent({ ...directive, status: "failed" }, ["src/shared.ts"])).toBe(true);
  });

  it("places only active agents on their current active task", () => {
    const active = card("active", "active", []);
    active.assigneeIds = ["claude", "codex"];
    active.agentStatuses = { claude: "running", codex: "completed" };
    const runtimes = [
      { nodeId: "claude", status: "needs_input" },
      { nodeId: "codex", status: "completed" },
    ] as PaneRuntime[];

    expect(opsAgentPresence([active], runtimes, new Set(["active", "review"]))).toEqual([
      { agentId: "claude", cardId: "active", status: "needs_input" },
    ]);
    expect(opsAgentPresence([active], [], new Set(["active", "review"]))).toEqual([]);
  });

  it("keeps historical status keys from duplicating assigned participants", () => {
    const active = card("active", "active", []);
    active.assigneeIds = ["node-claude"];
    active.agentStatuses = { "node-claude": "running", "Claude Code 1": "running" };

    expect(opsCardParticipantIds(active, [])).toEqual(["node-claude"]);
    expect(opsCardParticipantIds(active, [{ nodeId: "node-claude", status: "running" } as PaneRuntime])).toEqual(["node-claude"]);
  });

  it("finds dependency paths, waits, and cycles", () => {
    const foundation = card("foundation", "active", []);
    foundation.assigneeIds = ["claude"];
    const feature = { ...card("feature", "queued", []), dependencyIds: ["foundation"] };
    const release = { ...card("release", "queued", []), dependencyIds: ["feature"] };

    expect([...opsDependencyPath([foundation, feature, release], "feature")]).toEqual([
      "feature",
      "foundation",
      "release",
    ]);
    expect(opsWaitingRelationships([foundation, feature, release], new Set(["done"]))).toEqual([
      { cardId: "feature", waitingOnCardIds: ["foundation"], waitingOnAgentIds: ["claude"] },
      { cardId: "release", waitingOnCardIds: ["feature"], waitingOnAgentIds: [] },
    ]);
    expect(opsWouldCreateDependencyCycle([foundation, feature, release], "foundation", "release")).toBe(true);
    expect(opsWouldCreateDependencyCycle([foundation, feature, release], "release", "foundation")).toBe(false);
  });

  it("selects only the next unassigned ready task whose dependencies are done", () => {
    const blocked = { ...card("blocked", "queued", []), dependencyIds: ["foundation"] };
    const ready = card("ready", "queued", []);
    const foundation = card("foundation", "active", []);
    const state = {
      columns: [
        { id: "queued", title: "Ready", role: "queued" as const },
        { id: "active", title: "Active", role: "active" as const },
        { id: "done", title: "Done", role: "done" as const },
      ],
      cards: [blocked, ready, foundation],
    };

    expect(opsNextAutonomousTask(state)?.id).toBe("ready");
    expect(opsNextAutonomousTask({ ...state, cards: [blocked, { ...foundation, columnId: "done" }] })?.id).toBe("blocked");
  });

  it("never schedules an objective parent as executable work", () => {
    const objective = { ...card("objective", "queued", []), kind: "objective" as const };
    const child = { ...card("child", "queued", []), parentId: objective.id };
    const state = {
      columns: [
        { id: "queued", title: "Ready", role: "queued" as const },
        { id: "done", title: "Done", role: "done" as const },
      ],
      cards: [objective, child],
    };

    expect(opsNextAutonomousTask(state)?.id).toBe("child");
  });

  it("lets soft relationships coordinate without serializing scheduler pickup", () => {
    const upstream = card("upstream", "active", []);
    const soft = { ...card("soft", "queued", []), dependencyIds: ["upstream"], dependencyKinds: { upstream: "soft" as const } };
    const hard = { ...card("hard", "queued", []), dependencyIds: ["upstream"], dependencyKinds: { upstream: "hard" as const } };
    const state = {
      columns: [
        { id: "queued", title: "Ready", role: "queued" as const },
        { id: "active", title: "Active", role: "active" as const },
        { id: "done", title: "Done", role: "done" as const },
      ],
      cards: [hard, soft, upstream],
    };

    expect(opsNextAutonomousTask(state)?.id).toBe("soft");
    expect(opsWaitingRelationships(state.cards, new Set(["done"]))).toEqual([
      { cardId: "hard", waitingOnCardIds: ["upstream"], waitingOnAgentIds: [] },
    ]);
  });

  it("derives execution lanes, intervention reasons, and verification progress", () => {
    const active = card("active", "active", []);
    active.assigneeIds = ["claude"];
    expect(opsAgentsCoordinating(["running"], true)).toBe(true);
    expect(opsAgentsCoordinating(["needs_input"], true)).toBe(false);
    expect(opsExecutionLane(active, "active", ["running"], false)).toBe("running");
    expect(opsExecutionLane(active, "active", ["running"], true)).toBe("running");
    expect(opsAttentionReason(active, "active", ["running"], true)).toBeUndefined();
    expect(opsAttentionReason(active, "active", ["starting"], true)).toBeUndefined();
    expect(opsExecutionLane(active, "active", ["needs_input"], true)).toBe("attention");
    expect(opsAttentionReason(active, "active", ["needs_input"], true)).toBe("Agent needs an answer");
    expect(opsAttentionReason(active, "active", ["completed"], true)).toBe("Overlapping file claims");
    expect(opsExecutionLane(active, "active", ["needs_input"], false)).toBe("attention");
    expect(opsAttentionReason(active, "active", ["needs_input"], false)).toBe("Agent needs an answer");
    expect(opsAttentionReason(active, "active", [], false)).toBe("Assigned agent is no longer connected");

    const review = { ...card("review", "review", []), reviewerId: "pi", definitionOfDone: "Tests pass", verificationCommand: "bun run test" };
    review.events = [{ id: "one", kind: "handoff", timestamp: "2026-07-24T10:00:00Z", message: "Ready" }];
    expect(opsExecutionLane(review, "review", ["completed"], false)).toBe("verifying");
    expect(opsAttentionReason(review, "review", [], false)).toBe("Reviewer is no longer connected");
    expect(opsVerificationProgress(review, false)).toMatchObject({ passed: 4, total: 6 });
    expect(opsExecutionLane({ ...review, reviewerId: undefined }, "review", ["completed"], false)).toBe("verifying");
    review.agentStatuses.pi = "completed";
    expect(opsAttentionReason(review, "review", [], false)).toBeUndefined();
    expect(opsAttentionReason({ ...review, reviewerId: undefined }, "review", [], false)).toBeUndefined();

    const automaticReview = {
      ...review,
      reviewPolicy: "agent" as const,
      reviewerId: undefined,
      verificationRun: {
        sessionId: "verify",
        command: "bun run test",
        worktreePath: "C:\\repo-task",
        cwd: "C:\\repo-task",
        baseCommit: "a".repeat(40),
        status: "running" as const,
        startedAt: "2026-08-19T10:00:00Z",
      },
    };
    expect(opsAttentionReason(automaticReview, "review", [], false)).toBeUndefined();
    expect(opsExecutionLane(automaticReview, "review", [], false)).toBe("verifying");
    expect(opsAttentionReason({ ...automaticReview, verificationRun: { ...automaticReview.verificationRun, status: "passed", exitCode: 0 } }, "review", [], false)).toBeUndefined();
    expect(opsAttentionReason({ ...automaticReview, reviewerId: "pi" }, "review", ["running"], false)).toBeUndefined();
    expect(opsAttentionReason({ ...automaticReview, reviewerId: "pi", verificationRun: { ...automaticReview.verificationRun, status: "passed", exitCode: 0 } }, "review", ["completed"], false)).toBe("Reviewer verdict is missing");
  });

  it("keeps card activity specific while collapsing routine runtime noise", () => {
    const active = card("active", "active", []);
    expect(opsCardActivitySummary({ ...active, lastNote: "  Running focused tests  " }, [{ status: "running" }], 0)).toBe("Running focused tests");
    expect(opsCardActivitySummary(active, [{ status: "running" }], 2)).toBe("Coordinating on 2 file conflicts");
    expect(opsCardActivitySummary(active, [{ status: "running", statusSummary: "Inspecting the failed review" }], 0)).toBe("Inspecting the failed review");
    expect(opsCardActivitySummary(active, [{ status: "running", statusSummary: "Agent is working..." }], 0)).toBe("Working");
    expect(opsCardActivitySummary({ ...active, paused: true }, [], 0)).toBe("Paused");
    expect(opsCardActivitySummary(active, [], 0)).toBe("No active agent");
  });

  it("rejects stale verification command, cwd, base, snapshot, and approval evidence", () => {
    const review: OpsCard = {
      ...card("review", "review", []),
      reviewPolicy: "human",
      definitionOfDone: "Tests pass",
      verificationCommand: "bun run test",
      events: [{ id: "handoff", kind: "handoff", timestamp: "2026-08-03T10:00:00Z", message: "Ready" }],
      taskLane: {
        kind: "git-worktree",
        worktreePath: "C:\\repo-task",
        cwd: "C:\\repo-task",
        branch: "wheeljack/task",
        baseCommit: "base",
      },
      verificationRun: {
        sessionId: "session-1",
        command: "bun run test",
        worktreePath: "C:\\repo-task",
        cwd: "c:/repo-task/",
        baseCommit: "base",
        status: "passed",
        startedAt: "2026-08-03T10:00:00Z",
        endedAt: "2026-08-03T10:01:00Z",
        exitCode: 0,
        snapshotId: "snapshot-1",
      },
    };

    expect(opsVerificationApproval(review, false, "snapshot-1")).toEqual({ ready: true });
    expect(opsVerificationStaleReason({ ...review, verificationCommand: "bun run build" }, "snapshot-1")).toBe("Verification command changed");
    expect(opsVerificationStaleReason({ ...review, taskLane: { ...review.taskLane!, worktreePath: "C:\\other" } }, "snapshot-1")).toBe("Task worktree changed");
    expect(opsVerificationStaleReason({ ...review, taskLane: { ...review.taskLane!, cwd: "C:\\other" } }, "snapshot-1")).toBe("Task working directory changed");
    expect(opsVerificationStaleReason({ ...review, taskLane: { ...review.taskLane!, baseCommit: "other" } }, "snapshot-1")).toBe("Task base commit changed");
    expect(opsVerificationStaleReason(review, "snapshot-2")).toBe("Task snapshot changed");
    expect(opsVerificationApproval(review, true, "snapshot-1").ready).toBe(false);
    expect(opsVerificationApproval({ ...review, events: [] }, false, "snapshot-1").ready).toBe(false);

    for (const event of [
      { id: "manual:review:2026-08-03T10:00:00Z:", kind: "review" as const, timestamp: "2026-08-03T10:00:00Z", message: "Review requested" },
      { id: "manual:transfer:2026-08-03T10:00:00Z:agent", kind: "handoff" as const, timestamp: "2026-08-03T10:00:00Z", message: "Ownership transferred" },
    ]) {
      const syntheticEvidence = { ...review, events: [event] };
      expect(opsVerificationProgress(syntheticEvidence, false).checks.find((check) => check.label === "Handoff recorded")?.passed).toBe(false);
      expect(opsVerificationApproval(syntheticEvidence, false, "snapshot-1").ready).toBe(false);
    }
    expect(opsVerificationApproval({
      ...review,
      events: [{ id: "coordination:review:one", kind: "review", timestamp: "2026-08-03T10:00:00Z", message: "Review completed" }],
    }, false, "snapshot-1").ready).toBe(true);
  });

  it("treats incomplete contracts and explicit reviewer verdicts as actionable gates", () => {
    const incomplete = { ...card("review", "review", []), taskLane: {
      kind: "git-worktree" as const,
      worktreePath: "C:\\repo-task",
      cwd: "C:\\repo-task",
      branch: "wheeljack/task",
      baseCommit: "base",
    } };
    expect(opsVerificationContractIssues(incomplete)).toEqual([
      "Definition of done is missing",
      "Verification command is missing",
    ]);
    expect(opsAttentionReason(incomplete, "review", [], false)).toBe("Verification contract is incomplete");

    const rejected = {
      ...incomplete,
      definitionOfDone: "Tests pass",
      verificationCommand: "bun run test",
      reviewPolicy: "agent" as const,
      reviewerId: "reviewer",
      agentStatuses: { reviewer: "completed" },
      events: [{
        id: "reviewer.ndjson:2",
        kind: "handoff" as const,
        timestamp: "2026-08-03T10:00:00Z",
        callsign: "reviewer",
        message: "REVIEW VERDICT: REJECT — implementation is missing.",
      }],
    };
    expect(opsReviewVerdict(rejected)?.status).toBe("changes_requested");
    expect(opsVerificationProgress(rejected, false).checks.find((check) => check.label === "Handoff recorded")?.passed).toBe(true);
    expect(opsAttentionReason(rejected, "review", [], false)).toBe("Reviewer requested changes");
    expect(opsVerificationApproval(rejected, false, "snapshot-1", "agent")).toEqual({ ready: false, reason: "Reviewer requested changes" });

    const restarted = {
      ...rejected,
      events: [
        ...rejected.events,
        { id: "manual:assign:2026-08-03T11:00:00Z:worker", kind: "assignment" as const, timestamp: "2026-08-03T11:00:00Z", message: "Task assigned" },
      ],
    };
    expect(opsReviewVerdict(restarted)).toBeUndefined();
    expect(opsVerificationProgress(restarted, false).checks.find((check) => check.label === "Handoff recorded")?.passed).toBe(false);

    const approved = {
      ...rejected,
      events: [
        { id: "worker.ndjson:2", kind: "handoff" as const, timestamp: "2026-08-03T09:00:00Z", callsign: "worker", message: "Implementation ready." },
        { id: "reviewer.ndjson:2", kind: "handoff" as const, timestamp: "2026-08-03T10:00:00Z", callsign: "reviewer", message: "REVIEW VERDICT: APPROVE — evidence is complete." },
      ],
      expectedFiles: ["src/App.tsx"],
      verificationRun: {
        sessionId: "session-1",
        command: "bun run test",
        worktreePath: "C:\\repo-task",
        cwd: "C:\\repo-task",
        baseCommit: "base",
        status: "passed" as const,
        startedAt: "2026-08-03T10:00:00Z",
        endedAt: "2026-08-03T10:01:00Z",
        exitCode: 0,
        snapshotId: "snapshot-1",
      },
    };
    expect(opsReviewVerdict(approved)?.status).toBe("approved");
    expect(opsVerificationProgress(approved, false)).toMatchObject({ passed: 5, total: 6 });
    expect(opsVerificationProgress({
      ...approved,
      events: [
        ...(approved.events ?? []),
        { id: "manual:approve:2026-08-03T10:01:00Z:", kind: "completion", timestamp: "2026-08-03T10:01:00Z", message: "Verification approved" },
      ],
    }, false)).toMatchObject({ passed: 6, total: 6 });
    expect(opsVerificationApproval(approved, false, "snapshot-1", "human")).toEqual({ ready: false, reason: "Agent reviewer approval is required" });
    expect(opsVerificationApproval(approved, false, "snapshot-1", "agent")).toEqual({ ready: true });
    expect(opsVerificationApproval({ ...approved, reviewPolicy: "either" }, false, "snapshot-1", "human")).toEqual({ ready: true });
    const verdictOnly = {
      ...approved,
      events: [approved.events[1]],
    };
    expect(opsVerificationProgress(verdictOnly, false)).toMatchObject({ passed: 5, total: 6 });
    expect(opsVerificationApproval(verdictOnly, false, "snapshot-1", "agent")).toEqual({ ready: true });

    const second = {
      ...approved,
      id: "second-review",
      title: "Second review",
      verificationRun: { ...approved.verificationRun, sessionId: "session-2" },
    };
    const state = {
      columns: [
        { id: "active", title: "Active", role: "active" as const },
        { id: "review", title: "Review", role: "review" as const },
      ],
      cards: [approved, second],
    };
    const candidates = opsAutomaticApprovalCandidates(state);
    expect(candidates.map((candidate) => candidate.card.id)).toEqual(["review", "second-review"]);
    expect(candidates.every((candidate) => !candidate.hasFileConflict)).toBe(true);
    const now = Date.parse("2026-08-03T10:02:00Z");
    const retryAt = new Map([[candidates[0].key, now + 5_000]]);
    expect(opsNextAutomaticApprovalCandidate(candidates, retryAt, now).candidate?.card.id).toBe("second-review");
    retryAt.set(candidates[1].key, now + 2_000);
    expect(opsNextAutomaticApprovalCandidate(candidates, retryAt, now)).toEqual({ nextRetryAt: now + 2_000 });
    expect([1, 2, 3, 4, 5, 6, 7].map(opsAutomaticApprovalRetryDelay)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
  });

  it("keeps human override on shared checkouts only", () => {
    expect(opsCanCompleteWithOverride(card("shared", "review", []))).toBe(true);
    expect(opsCanCompleteWithOverride({
      ...card("isolated", "review", []),
      taskLane: {
        kind: "git-worktree",
        worktreePath: "C:\\repo-task",
        cwd: "C:\\repo-task",
        branch: "wheeljack/task",
        baseCommit: "base",
      },
    })).toBe(false);
  });

  it("completes verification as canceled, failed, passed, or snapshot-failed", () => {
    const endedAt = "2026-08-03T10:01:00Z";
    expect(opsVerificationCompletion(true, 1, undefined, endedAt)).toMatchObject({ status: "canceled", exitCode: 1 });
    expect(opsVerificationCompletion(false, 2, undefined, endedAt)).toMatchObject({ status: "failed", exitCode: 2 });
    expect(opsVerificationCompletion(false, 0, "snapshot", endedAt)).toMatchObject({ status: "passed", exitCode: 0, snapshotId: "snapshot" });
    expect(opsVerificationCompletion(false, 0, undefined, endedAt)).toMatchObject({ status: "failed", exitCode: 0, snapshotId: undefined });
  });

  it("shares agent attention reasons with terminal surfaces", () => {
    expect(opsStatusAttentionReason("needs_input")).toBe("Agent needs an answer");
    expect(opsStatusAttentionReason("blocked")).toBe("Agent reported a blocker");
    expect(opsStatusAttentionReason("failed")).toBe("Agent run failed");
    expect(opsStatusAttentionReason("disconnected")).toBe("Agent disconnected");
    expect(opsStatusAttentionReason("running")).toBeUndefined();
  });

  it("selects an active or review card before historical assignments", () => {
    const done = card("done", "done", []);
    done.assigneeIds = ["agent-1"];
    const review = card("review", "review", []);
    review.reviewerId = "agent-1";
    const active = card("active", "active", []);
    active.assigneeIds = ["agent-2"];
    const state = {
      columns: [
        { id: "active", title: "Active", role: "active" as const },
        { id: "review", title: "Review", role: "review" as const },
        { id: "done", title: "Done", role: "done" as const },
      ],
      cards: [done, review, active],
    };

    expect(opsCurrentCardForAgent(state, "agent-1")?.id).toBe("review");
    expect(opsCurrentCardForAgent(state, "agent-2")?.id).toBe("active");
    expect(opsCurrentCardForAgent(state, "unassigned")).toBeUndefined();
    expect(opsCurrentCardForAgent({ ...state, cards: [done] }, "agent-1")?.id).toBe("done");
  });

  it("starts only independent decomposition tasks with unique idle owners and files", () => {
    const tasks = [
      { key: "ui", title: "UI", detail: "", definitionOfDone: "", constraints: "", verificationCommand: "", expectedFiles: ["src/App.tsx"], dependencyKeys: [], agentId: "a" },
      { key: "api", title: "API", detail: "", definitionOfDone: "", constraints: "", verificationCommand: "", expectedFiles: ["src/api.ts"], dependencyKeys: [], agentId: "a" },
      { key: "test", title: "Test", detail: "", definitionOfDone: "", constraints: "", verificationCommand: "", expectedFiles: ["src\\App.tsx"], dependencyKeys: [], agentId: "b" },
      { key: "docs", title: "Docs", detail: "", definitionOfDone: "", constraints: "", verificationCommand: "", expectedFiles: ["README.md"], dependencyKeys: ["ui"], agentId: "b" },
    ];

    expect(opsDispatchableDecompositionKeys(tasks, new Set(["a", "b"]))).toEqual(["ui", "docs"]);
    expect(opsDecompositionHasCycle(tasks)).toBe(false);
    expect(opsDecompositionHasCycle([
      { ...tasks[0], dependencyKeys: ["api"] },
      { ...tasks[1], dependencyKeys: ["ui"] },
    ])).toBe(true);

    const done = { ...card("done", "done", []), parentId: "parent" };
    expect(opsChildProgress([done, { ...card("ready", "queued", []), parentId: "parent" }], "parent", new Set(["done"]))).toEqual({ done: 1, total: 2 });
  });
});
