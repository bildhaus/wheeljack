import {
  appendPendingAgentUserMessage,
  agentLaunchArgs,
  agentLaunchConfig,
  agentProjectAccessConfig,
  agentStatusAfterInteraction,
  agentRuntimeCapabilities,
  agentTaskCardsFromProposal,
  applyCoordinationEvents,
  applyOpsOrchestration,
  applyOpsPauseRequest,
  cachedAgentModels,
  defaultAgentProfiles,
  dedupeActivity,
  desktopOnboardingStep,
  hydratedRuntimeStatus,
  isSuccessfulOnboardingTurn,
  kanbanVerificationContractIssues,
  mergeAgentProjectDocumentProposal,
  mergeAgentMessages,
  mergeProjectDocuments,
  nodeTranscript,
  nodeHistorySessionId,
  normalizeLegacyWindowsPreferences,
  normalizeOpsAgentIdentities,
  normalizeUiFont,
  opsAgentAliases,
  parseOpsState,
  parseAgentControlRequests,
  parseAgentTaskCardProposals,
  parseOpsDecompositionProposal,
  parseOpsTaskContractProposal,
  parseProjectDocumentDiff,
  parseProjectDocumentProposal,
  parseProjectDocumentProposals,
  preferencesFromSettings,
  preferredCodingAdapterId,
  reconcileParsedAgentMessages,
  renderKanban,
  resolveDesktopOnboardingVersion,
  selectedAgentAdapterIdFromSettings,
  setAgentInteractionState,
  staleAdapterAfterProfileChange,
  terminalFrameRuntimeStatus,
  utilityPanelSelection,
} from "./App";
import { groupAgentMessages } from "./AgentChat";
import { opsActiveFileConflicts, opsFileConflictNeedsAttention } from "./opsPresence";
import { humanizeFloorAttentionDetail, normalizeFloorRailWidth, opsCanReturnDirectlyToReady, panelResizeResult, projectEmptyTypewriterDelays } from "./ParitySurfaces";

test("paces spaces in the project empty-state typewriter", () => {
  expect(projectEmptyTypewriterDelays("A B")).toEqual([14, 23, 39]);
});

test("builds the exact adapter launch arguments used for probe, verify, and spawn", () => {
  expect(agentLaunchArgs({
    adapterId: "codex-cli",
    provider: "openai",
    model: "gpt-5.6",
    thinking: "high",
    approvalPolicy: "on-request",
  })).toEqual([
    "-c",
    'model="gpt-5.6"',
    "-c",
    'model_reasoning_effort="high"',
    "-c",
    'approval_policy="on-request"',
  ]);
  expect(agentLaunchArgs({
    adapterId: "claude-code",
    provider: "anthropic",
    model: "sonnet",
    thinking: "medium",
    approvalPolicy: "manual",
  })).toEqual(["--model", "sonnet", "--effort", "medium", "--permission-mode", "manual"]);
  expect(agentLaunchArgs({
    ...defaultAgentProfiles().find((profile) => profile.adapterId === "claude-code")!,
    thinking: "minimal",
  })).toEqual(["--model", "haiku", "--permission-mode", "manual"]);
  expect(agentLaunchArgs({
    ...defaultAgentProfiles().find((profile) => profile.adapterId === "claude-code")!,
    approvalPolicy: "",
  })).toEqual(["--model", "haiku", "--effort", "low"]);
  expect(agentLaunchArgs(defaultAgentProfiles().find((profile) => profile.adapterId === "opencode"))).toEqual([]);
  expect(agentLaunchArgs({
    adapterId: "pi-coding-agent",
    provider: "openai-codex",
    model: "gpt-5.4-mini",
    thinking: "minimal",
    approvalPolicy: "",
  })).toEqual(["--provider", "openai-codex", "--model", "gpt-5.4-mini", "--thinking", "minimal"]);
});

test("derives pending onboarding without flashing it for existing profiles", () => {
  const footprint = { migrated: false, projects: [], sessions: [], activity: [] };

  expect(resolveDesktopOnboardingVersion({ workspace: {} }, footprint)).toBe(0);
  expect(resolveDesktopOnboardingVersion({ desktopOnboardingVersion: 0 }, {
    ...footprint,
    projects: [{}],
  })).toBe(0);
  expect(resolveDesktopOnboardingVersion({ desktopOnboardingVersion: 1 }, footprint)).toBe(1);
  expect(resolveDesktopOnboardingVersion({}, { ...footprint, migrated: true })).toBe(1);
  expect(resolveDesktopOnboardingVersion({}, { ...footprint, projects: [{}] })).toBe(1);
  expect(resolveDesktopOnboardingVersion({}, { ...footprint, sessions: [{}] })).toBe(1);
  expect(resolveDesktopOnboardingVersion({}, { ...footprint, activity: [{}] })).toBe(1);
  expect(resolveDesktopOnboardingVersion({ theme: "paper" }, footprint)).toBe(1);
});

test("derives fresh, missing-folder, adapter, and resumed task steps", () => {
  const project = {
    id: "project",
    name: "Project",
    path: "C:\\repo",
    branch: "",
    dirty: false,
    pathExists: true,
  };

  expect(desktopOnboardingStep(undefined, false)).toBe(1);
  expect(desktopOnboardingStep({ ...project, pathExists: false }, true)).toBe(1);
  expect(desktopOnboardingStep(project, false)).toBe(2);
  expect(desktopOnboardingStep(project, true)).toBe(3);
});

test("prefers ready, authenticated installed, installed, then first supported coding adapter", () => {
  const profiles = defaultAgentProfiles();
  const candidate = (
    id: string,
    status: string,
    authStatus?: string,
    verificationStatus = "unverified",
  ) => {
    const profile = profiles.find((item) => item.adapterId === id);
    return {
      id,
      displayName: id,
      status,
      setupHint: "",
      enabled: true,
      supportsStructured: true,
      supportedApprovalPolicies: [],
      probe: authStatus ? {
        adapterId: id,
        authStatus,
        verificationStatus,
        verifiedArgs: verificationStatus === "verified" ? agentLaunchArgs(profile) : [],
        message: "",
        checkedAt: "",
      } : undefined,
    };
  };
  const missing = candidate("claude-code", "missing");
  const installed = candidate("codex-cli", "installed", "unknown");
  const authenticated = candidate("opencode", "installed", "authenticated");
  const ready = candidate("pi-coding-agent", "installed", "authenticated", "verified");

  expect(preferredCodingAdapterId([missing, installed, authenticated, ready], profiles)).toBe("pi-coding-agent");
  expect(preferredCodingAdapterId([missing, installed, authenticated], profiles)).toBe("opencode");
  expect(preferredCodingAdapterId([missing, installed], profiles)).toBe("codex-cli");
  expect(preferredCodingAdapterId([missing], profiles)).toBe("claude-code");
  expect(preferredCodingAdapterId([ready, candidate("codex-cli", "installed", "authenticated", "verified")], profiles, "codex-cli")).toBe("codex-cli");
  expect(preferredCodingAdapterId([ready, missing], profiles, "claude-code")).toBe("claude-code");
  expect(selectedAgentAdapterIdFromSettings({ selectedAgentAdapterId: "opencode" })).toBe("opencode");
});

test("returns stopped tasks directly to Ready while live tasks still require a pause", () => {
  const task = parseOpsState({
    version: 2,
    cards: [{ id: "task", title: "Task", columnId: "active", assigneeIds: ["agent"] }],
  }).cards[0];
  const runtime = (status: string) => ({ nodeId: "agent", status, structured: true }) as never;

  expect(opsCanReturnDirectlyToReady(task, [runtime("canceled")])).toBe(true);
  expect(opsCanReturnDirectlyToReady(task, [runtime("failed")])).toBe(true);
  expect(opsCanReturnDirectlyToReady(task, [runtime("running")])).toBe(false);
});

test("completes onboarding only for a successful parsed assistant result", () => {
  const result = (events: Array<{ type: string }>, text: string, active = false) => ({
    events,
    messages: text ? [{ id: "assistant", role: "assistant", kind: "message", text }] : [],
    active,
  });

  expect(isSuccessfulOnboardingTurn(result([{ type: "turn_done" }], "Repository summary"), "completed")).toBe(true);
  expect(isSuccessfulOnboardingTurn(result([], "Partial output", true), "running")).toBe(false);
  expect(isSuccessfulOnboardingTurn(result([{ type: "approval" }], "Approve this?", true), "needs_input")).toBe(false);
  expect(isSuccessfulOnboardingTurn(result([{ type: "turn_canceled" }], "Stopped"), "canceled")).toBe(false);
  expect(isSuccessfulOnboardingTurn(result([{ type: "error" }], "Failed"), "failed")).toBe(false);
  expect(isSuccessfulOnboardingTurn(result([{ type: "turn_done" }], ""), "completed")).toBe(false);
});

test("parses exact autonomous agent controls and ignores partial or unsupported directives", () => {
  expect(parseAgentControlRequests('wheeljack.control {"id":"msg-1","action":"send_message","target":"Peer","message":"Review this"}')).toEqual([{
    id: "msg-1",
    action: "send_message",
    target: "Peer",
    message: "Review this",
    taskId: undefined,
    adapterId: undefined,
    files: undefined,
  }]);
  expect(parseAgentControlRequests('wheeljack.control {"id":"resolve-1","action":"resolve_file_conflict","taskId":"task-1","files":[],"message":"Peer owns the shared file"}')).toEqual([{
    id: "resolve-1",
    action: "resolve_file_conflict",
    target: undefined,
    message: "Peer owns the shared file",
    taskId: "task-1",
    adapterId: undefined,
    files: [],
  }]);
  expect(parseAgentControlRequests('wheeljack.control {"id":"spawn-1","action":"spawn_agent"')).toEqual([]);
  expect(parseAgentControlRequests('wheeljack.control {"id":"resolve-bad","action":"resolve_file_conflict","taskId":"task-1","files":["src/App.tsx",42]}')).toEqual([]);
  expect(parseAgentControlRequests('wheeljack.control {"id":"bad","action":"delete_workspace"}')).toEqual([]);
});

test("defaults cards without an explicit policy to agent review", () => {
  const state = parseOpsState({
    version: 2,
    cards: [{
      id: "task",
      title: "Task",
      approvalAttempt: { status: "retrying", message: "Git was busy", attemptedAt: "2026-08-11T17:00:00Z" },
    }],
  });
  expect(state.cards[0].reviewPolicy).toBe("agent");
  expect(state.cards[0].approvalAttempt).toEqual({ status: "retrying", message: "Git was busy", attemptedAt: "2026-08-11T17:00:00Z" });
  const kanban = renderKanban(state);
  expect(kanban).toContain('"reviewPolicy":"agent"');
  expect(kanban).not.toContain("approvalAttempt");
});

test("does not duplicate an unanswered resume prompt", () => {
  const pending = [
    { id: "answer", role: "assistant", kind: "message", text: "Working" },
    { id: "resume-1", role: "user", kind: "message", text: "Resume task" },
    { id: "failure", role: "system", kind: "error", text: "Active writer" },
  ];
  const retry = { id: "resume-2", role: "user", kind: "message", text: "Resume task" };

  expect(appendPendingAgentUserMessage(pending, retry)).toBe(pending);
  expect(appendPendingAgentUserMessage([
    ...pending,
    { id: "answer-2", role: "assistant", kind: "message", text: "Recovered" },
  ], retry)).toHaveLength(pending.length + 2);
});

test("keeps OpenCode process arguments empty while forwarding every protocol profile field", () => {
  const profile = defaultAgentProfiles().find((candidate) => candidate.adapterId === "opencode")!;
  const config = agentLaunchConfig(profile);

  expect(config).toEqual({
    args: [],
    provider: "openai",
    model: "openai/gpt-5.6-luna",
    thinking: "minimal",
    approvalPolicy: "ask",
  });
  expect(agentLaunchConfig({ ...profile, model: "openai/gpt-5.6" })).not.toEqual(config);
  expect(agentLaunchConfig({ ...profile, thinking: "high" })).not.toEqual(config);
  expect(agentLaunchConfig({ ...profile, approvalPolicy: "deny" })).not.toEqual(config);
});

test("maps project full access to each agent's native permission policy", () => {
  const profiles = defaultAgentProfiles();
  expect(agentProjectAccessConfig(profiles.find((profile) => profile.adapterId === "codex-cli"), "full"))
    .toEqual({ approvalPolicy: "never", sandbox: "danger-full-access" });
  expect(agentProjectAccessConfig(profiles.find((profile) => profile.adapterId === "claude-code"), "full"))
    .toEqual({ approvalPolicy: "bypassPermissions" });
  expect(agentProjectAccessConfig(profiles.find((profile) => profile.adapterId === "opencode"), "full"))
    .toEqual({ approvalPolicy: "allow" });
  expect(agentLaunchConfig(profiles.find((profile) => profile.adapterId === "claude-code"), "full").args)
    .toContain("bypassPermissions");
  expect(agentLaunchConfig(profiles.find((profile) => profile.adapterId === "pi-coding-agent"), "full").args)
    .toContain("--approve");
  expect(agentLaunchConfig(profiles.find((profile) => profile.adapterId === "pi-coding-agent"), "default").args)
    .toContain("--no-approve");
});

test("marks every effective OpenCode profile change stale immediately", () => {
  const profile = defaultAgentProfiles().find((candidate) => candidate.adapterId === "opencode")!;
  const verifiedAdapter = {
    id: "opencode",
    displayName: "OpenCode",
    status: "installed",
    setupHint: "",
    enabled: true,
    supportsStructured: true,
    supportedApprovalPolicies: ["ask", "allow", "deny"],
    probe: {
      adapterId: "opencode",
      authStatus: "authenticated",
      verificationStatus: "verified",
      message: "Real agent turn verified.",
      checkedAt: "now",
      verifiedArgs: [],
    },
  };

  expect(staleAdapterAfterProfileChange(verifiedAdapter, profile, profile)).toBe(verifiedAdapter);
  for (const changedProfile of [
    { ...profile, model: "openai/gpt-5.6" },
    { ...profile, thinking: "high" as const },
    { ...profile, approvalPolicy: "deny" },
  ]) {
    expect(
      staleAdapterAfterProfileChange(verifiedAdapter, profile, changedProfile)
        .probe?.verificationStatus,
    ).toBe("stale");
  }
});

test("uses only fresh non-empty model catalog cache entries", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null } });
  const catalog = { models: [{ id: "model", label: "Model", efforts: ["medium"] }] };
  try {
    values.set("models", JSON.stringify({ updatedAt: Date.now(), catalog }));
    expect(cachedAgentModels("models")).toEqual(catalog);
    values.set("models", JSON.stringify({ updatedAt: Date.now() - 60 * 60 * 1000 - 1, catalog }));
    expect(cachedAgentModels("models")).toBeUndefined();
    values.set("models", JSON.stringify({ updatedAt: Date.now(), catalog: { models: [] } }));
    expect(cachedAgentModels("models")).toBeUndefined();
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

test("keeps persistent structured session status separate from turn status", () => {
  expect(hydratedRuntimeStatus(true, false, "running", "running")).toBe("ready");
  expect(hydratedRuntimeStatus(true, true, "running", "completed")).toBe("completed");
  expect(hydratedRuntimeStatus(false, false, "running", "ready")).toBe("running");
});

test("panel resizing collapses only after dragging beyond its minimum", () => {
  expect(panelResizeResult(175, 176, 320, true)).toEqual({ value: 176, collapse: false });
  expect(panelResizeResult(163, 176, 320, true)).toEqual({ value: 176, collapse: true });
  expect(panelResizeResult(120, 176, 320, false)).toEqual({ value: 176, collapse: false });
  expect(panelResizeResult(400, 176, 320, true)).toEqual({ value: 320, collapse: false });
});

test("normalizes floor rail widths into the supported desktop range", () => {
  expect(normalizeFloorRailWidth(undefined)).toBe(420);
  expect(normalizeFloorRailWidth(220)).toBe(340);
  expect(normalizeFloorRailWidth(420)).toBe(420);
  expect(normalizeFloorRailWidth(900)).toBe(680);
});

test("humanizes serialized permission paths for the Floor intervention queue", () => {
  expect(humanizeFloorAttentionDetail('["C:\\\\workspace\\\\coordination\\\\agents\\\\*"]')).toBe("Access to 1 path · …\\agents\\*");
  expect(humanizeFloorAttentionDetail("Agent asked for a decision")).toBe("Agent asked for a decision");
});

test("toggles the active utility tab and keeps a newly selected tab open", () => {
  expect(utilityPanelSelection(false, "inbox", "inbox")).toEqual({ open: true, tab: "inbox" });
  expect(utilityPanelSelection(true, "inbox", "inbox")).toEqual({ open: false, tab: "inbox" });
  expect(utilityPanelSelection(true, "inbox", "git")).toEqual({ open: true, tab: "git" });
  expect(utilityPanelSelection(false, "git", "history")).toEqual({ open: true, tab: "history" });
});

test("terminal frames do not revive completed structured agents", () => {
  expect(terminalFrameRuntimeStatus({ structured: true, status: "completed" })).toBe("completed");
  expect(terminalFrameRuntimeStatus({ structured: true, status: "needs_input" })).toBe("needs_input");
  expect(terminalFrameRuntimeStatus({ structured: false, status: "starting" })).toBe("running");
});

test("accepts only complete runtime capability contracts", () => {
  const capabilities = { cancel: true, interact: false, resume: true, attachedTerminal: false };
  expect(agentRuntimeCapabilities(capabilities)).toEqual(capabilities);
  expect(agentRuntimeCapabilities({ cancel: true })).toBeUndefined();
});

test("canonicalizes coordination callsigns to pane identities", () => {
  const aliases = opsAgentAliases([
    { id: "node-claude", title: "Claude Code 1" },
    { id: "node-pi", title: "Pi 2" },
  ]);
  const current = parseOpsState({
    version: 2,
    cards: [{
      id: "task-1",
      title: "Identity",
      columnId: "active",
      assigneeIds: ["node-claude", "node-pi"],
      agentStatuses: {
        "node-claude": "running",
        "Claude Code 1": "completed",
        "Pi 2": "needs_input",
      },
      agentFiles: {
        "node-claude": ["src/App.tsx"],
        "Claude Code 1": ["src/types.ts"],
      },
    }],
  });

  const normalized = normalizeOpsAgentIdentities(current, aliases);
  const updated = applyCoordinationEvents(normalized, {
    events: [{
      id: "event-1",
      taskId: "task-1",
      task: "Identity",
      callsign: "Pi 2",
      status: "completed",
      expectedFiles: [],
      timestamp: "2026-07-23T12:00:00Z",
    }],
    cursors: { "Pi 2": 1 },
    warnings: [],
  }, aliases);

  expect(Object.keys(updated.cards[0].agentStatuses)).toEqual(["node-claude", "node-pi"]);
  expect(updated.cards[0].agentStatuses).toEqual({ "node-claude": "completed", "node-pi": "completed" });
  expect(updated.cards[0].agentFiles?.["node-claude"]).toEqual(["src/App.tsx", "src/types.ts"]);
  expect(updated.cards[0].events?.[0].callsign).toBe("node-pi");
});

test("migrates only the former bundled UI font defaults", () => {
  expect(normalizeUiFont("Segoe UI Variable Text")).toBe("Geist Variable");
  expect(normalizeUiFont("Inter")).toBe("Geist Variable");
  expect(normalizeUiFont("Satoshi")).toBe("Satoshi");
});

test("recovers the legacy desktop ops payload without trusting malformed cards", () => {
  const state = parseOpsState({
    version: 2,
    cards: [
      { id: "task_1", title: "Port Home", columnId: "active", expectedFiles: ["Home.xaml"] },
      { title: "missing id" },
    ],
    prd: "# Product",
    tdd: "# Design",
  });

  expect(state.cards).toHaveLength(1);
  expect(state.cards[0]).toMatchObject({ id: "task_1", columnId: "active", priority: "normal" });
  expect(state.prd).toBe("# Product");
  expect(state.columns.map((column) => column.role)).toEqual(["queued", "active", "review", "done"]);
});

test("keeps task lanes local, durable, and structurally validated", () => {
  const state = parseOpsState({
    version: 2,
    cards: [{
      id: "task-lane",
      title: "Isolated task",
      columnId: "active",
      taskLane: {
        kind: "git-worktree",
        worktreePath: "C:\\repo-task-123",
        cwd: "C:\\repo-task-123\\apps\\desktop",
        branch: "wheeljack/task-1234567890abcdef1234",
        baseCommit: "a".repeat(40),
      },
    }, {
      id: "broken-lane",
      title: "Broken",
      taskLane: {
        kind: "git-worktree",
        worktreePath: "C:\\missing-fields",
      },
    }],
  });

  expect(state.cards[0].taskLane).toMatchObject({
    cwd: "C:\\repo-task-123\\apps\\desktop",
    branch: "wheeljack/task-1234567890abcdef1234",
  });
  expect(state.cards[1].taskLane).toBeUndefined();
  const markdown = renderKanban(state);
  expect(markdown).not.toContain("repo-task-123");
  expect(markdown).not.toContain("1234567890abcdef1234");
  expect(markdown).not.toContain("a".repeat(40));

  const merged = mergeProjectDocuments(state, {
    projectPath: "C:\\repo",
    documents: {
      kanban: {
        kind: "kanban",
        path: "C:\\repo\\KANBAN.md",
        exists: true,
        content: markdown,
        revision: "one",
        format: "wheeljack-v1",
        warnings: [],
        board: {
          version: 1,
          columns: state.columns,
          cards: [
            { id: "task-lane", columnId: "done", title: "Renamed", detail: "", assignee: "Alpha", priority: "normal" },
            { id: "broken-lane", columnId: "done", title: "Broken", detail: "", assignee: "Unassigned", priority: "normal" },
          ],
        },
      },
      prd: { kind: "prd", path: "C:\\repo\\PRD.md", exists: false, content: "", revision: "missing", format: "missing", warnings: [] },
      tdd: { kind: "tdd", path: "C:\\repo\\TDD.md", exists: false, content: "", revision: "missing", format: "missing", warnings: [] },
    },
  });
  expect(merged.cards[0].taskLane).toEqual(state.cards[0].taskLane);
  expect(merged.cards[0].columnId).toBe("active");
  expect(merged.cards[1].columnId).toBe("done");
});

test("renders and imports dynamic project-file kanban columns", () => {
  const state = parseOpsState({
    version: 2,
    columns: [
      { id: "ideas", title: "Ideas", role: "queued" },
      { id: "shipping", title: "Shipping", role: "active" },
      { id: "landed", title: "Landed", role: "done" },
    ],
    cards: [{ id: "task-1", title: "Ship it", columnId: "landed", priority: "high", assignee: "Alpha" }],
  });
  const markdown = renderKanban(state);

  expect(markdown).toContain('## Landed\n<!-- wheeljack:column {"id":"landed","role":"done"} -->');
  expect(markdown).toContain('- [x] Ship it');

  const documents = {
    projectPath: "C:\\repo",
    documents: {
      kanban: {
        kind: "kanban" as const,
        path: "C:\\repo\\KANBAN.md",
        exists: true,
        content: markdown,
        revision: "one",
        format: "wheeljack-v1" as const,
        warnings: [],
        board: {
          version: 1 as const,
          columns: state.columns,
          cards: [{ id: "task-1", columnId: "landed", title: "Renamed", detail: "", assignee: "Alpha", priority: "high" }],
        },
      },
      prd: { kind: "prd" as const, path: "C:\\repo\\PRD.md", exists: true, content: "# PRD", revision: "two", format: "markdown" as const, warnings: [] },
      tdd: { kind: "tdd" as const, path: "C:\\repo\\TDD.md", exists: false, content: "", revision: "missing", format: "missing" as const, warnings: [] },
    },
  };
  state.cards[0].lastNote = "Keep runtime evidence";
  const merged = mergeProjectDocuments(state, documents);

  expect(merged.cards[0]).toMatchObject({ title: "Renamed", lastNote: "Keep runtime evidence" });
  expect(merged.prd).toBe("# PRD");
});

test("extracts an agent project-document proposal from structured protocol JSON", () => {
  const proposal = 'wheeljack.project_document {"requestId":"request-1","kind":"prd","content":"# Product"}';
  expect(parseProjectDocumentProposal(JSON.stringify({ message: { content: proposal } }))).toEqual({
    requestId: "request-1",
    kind: "prd",
    content: "# Product",
  });
  expect(parseProjectDocumentProposal(`${proposal} trailing prose`)).toBeUndefined();
});

test("parses agent task-card controls and materializes linked backlog contracts", () => {
  const control = `wheeljack.task_cards ${JSON.stringify({
    requestId: "request-tasks",
    cards: [
      {
        key: "index-search",
        title: "Index project search",
        detail: "Build a reusable project search index from repository documents.",
        priority: "high",
        definitionOfDone: "Repeated project searches use the persisted index and return the same results.",
        constraints: "Keep project data local.",
        verificationCommand: "bun run test",
        reviewPolicy: "agent",
        dependencyKeys: [],
        existingDependencyIds: ["existing-task"],
      },
      {
        key: "surface-search",
        title: "Surface indexed search",
        detail: "Use indexed results in the project search workflow with clear empty and error states.",
        definitionOfDone: "Search renders indexed results plus accessible empty and error states.",
        verificationCommand: "bun run test",
        dependencyKeys: ["index-search"],
      },
    ],
  })}`;
  const proposal = parseAgentTaskCardProposals(JSON.stringify({ message: { content: control } }))[0];
  expect(proposal).toMatchObject({
    requestId: "request-tasks",
    cards: [
      { key: "index-search", priority: "high", reviewPolicy: "agent" },
      { key: "surface-search", priority: "normal", reviewPolicy: "agent" },
    ],
  });

  const state = parseOpsState({
    version: 2,
    cards: [{ id: "existing-task", columnId: "queued", title: "Prepare search fixtures" }],
  });
  const ids = ["generated-index", "generated-surface"];
  const cards = agentTaskCardsFromProposal(proposal, state, () => ids.shift()!);
  expect(cards).toHaveLength(2);
  expect(cards[0]).toMatchObject({
    id: "generated-index",
    columnId: "queued",
    dependencyIds: ["existing-task"],
    reviewPolicy: "agent",
  });
  expect(cards[1].dependencyIds).toEqual(["generated-index"]);
});

test("rejects malformed or cyclic generated task-card contracts", () => {
  expect(parseAgentTaskCardProposals('wheeljack.task_cards {"requestId":"request-bad","cards":[]}')).toEqual([]);
  const state = parseOpsState({ version: 2 });
  expect(() => agentTaskCardsFromProposal({
    requestId: "request-cycle",
    cards: [
      { key: "first", title: "First task", detail: "First outcome", priority: "normal", definitionOfDone: "First passes", constraints: "", verificationCommand: "bun run test", reviewPolicy: "agent", dependencyKeys: ["second"], existingDependencyIds: [] },
      { key: "second", title: "Second task", detail: "Second outcome", priority: "normal", definitionOfDone: "Second passes", constraints: "", verificationCommand: "bun run test", reviewPolicy: "agent", dependencyKeys: ["first"], existingDependencyIds: [] },
    ],
  }, state)).toThrow("dependencies contain a cycle");
});

test("accumulates staged project-document proposals until the requested bundle is complete", () => {
  const kinds: Array<"kanban" | "prd" | "tdd"> = ["kanban", "prd", "tdd"];
  const first = mergeAgentProjectDocumentProposal("request-2", kinds, {}, {
    requestId: "request-2",
    kind: "prd",
    content: "# Product",
  });
  expect(first).toEqual({ prd: "# Product" });

  const second = mergeAgentProjectDocumentProposal("request-2", kinds, first!, {
    requestId: "request-2",
    kind: "tdd",
    content: "# Design",
  });
  expect(second).toEqual({ prd: "# Product", tdd: "# Design" });

  const complete = mergeAgentProjectDocumentProposal("request-2", kinds, second!, {
    requestId: "request-2",
    kind: "kanban",
    content: "# Kanban",
  });
  expect(complete).toEqual({ kanban: "# Kanban", prd: "# Product", tdd: "# Design" });
  expect(mergeAgentProjectDocumentProposal("wrong-request", kinds, complete!, {
    requestId: "request-2",
    kind: "prd",
    content: "ignored",
  })).toBeUndefined();
});

test("extracts every staged project-document control from one agent response", () => {
  const controls = [
    'wheeljack.project_document {"requestId":"request-3","kind":"prd","content":"# Product\\n\\nOutcome"}',
    'wheeljack.project_document {"requestId":"request-3","kind":"tdd","content":"# Design"}',
    'wheeljack.project_document {"requestId":"request-3","kind":"kanban","content":"# Kanban"}',
  ].join("\n");
  expect(parseProjectDocumentProposals(JSON.stringify({ message: { content: controls } }))).toEqual([
    { requestId: "request-3", kind: "prd", content: "# Product\n\nOutcome" },
    { requestId: "request-3", kind: "tdd", content: "# Design" },
    { requestId: "request-3", kind: "kanban", content: "# Kanban" },
  ]);
});

test("persists and imports verification contracts through KANBAN metadata", () => {
  const state = parseOpsState({
    version: 2,
    cards: [{
      id: "task-contract",
      columnId: "queued",
      title: "Contract task",
      definitionOfDone: "The contract round-trips",
      constraints: "Keep compatibility",
      verificationCommand: "bun run test",
      reviewPolicy: "agent",
    }],
  });
  const markdown = renderKanban(state);
  expect(markdown).toContain('"definitionOfDone":"The contract round-trips"');
  expect(markdown).toContain('"verificationCommand":"bun run test"');
  expect(kanbanVerificationContractIssues(markdown)).toEqual([]);
  expect(kanbanVerificationContractIssues(markdown.replace('"verificationCommand":"bun run test"', '"verificationCommand":""'))).toEqual(["Contract task"]);

  const imported = mergeProjectDocuments(parseOpsState({ version: 2, cards: [] }), {
    projectPath: "C:\\repo",
    documents: {
      kanban: {
        kind: "kanban",
        path: "C:\\repo\\KANBAN.md",
        exists: true,
        content: markdown,
        revision: "one",
        format: "wheeljack-v1",
        warnings: [],
        board: { version: 1, columns: state.columns, cards: state.cards },
      },
      prd: { kind: "prd", path: "C:\\repo\\PRD.md", exists: false, content: "", revision: "missing", format: "missing", warnings: [] },
      tdd: { kind: "tdd", path: "C:\\repo\\TDD.md", exists: false, content: "", revision: "missing", format: "missing", warnings: [] },
    },
  });
  expect(imported.cards[0]).toMatchObject({
    definitionOfDone: "The contract round-trips",
    constraints: "Keep compatibility",
    verificationCommand: "bun run test",
    reviewPolicy: "agent",
  });
});

test("loads desktop preferences with legacy settings fallbacks", () => {
  const preferences = preferencesFromSettings({
    theme: "mono-light",
    appFontFamily: "Inter",
    monoFontFamily: "Cascadia Code",
    desktopUiPreferences: {
      sidebarWidth: 288,
      paneHeaderHeight: 40,
      showSuggestions: false,
    },
  });

  expect(preferences).toMatchObject({
    theme: "paper",
    headingFontFamily: "Geist Pixel",
    uiFontFamily: "Geist Variable",
    codeFontFamily: "Cascadia Code",
    sidebarWidth: 288,
    utilityPanelWidth: 400,
    utilityPanelTab: "inbox",
  });
  expect(preferences).not.toHaveProperty("paneHeaderHeight");
  expect(preferences).not.toHaveProperty("showSuggestions");
  expect(preferencesFromSettings({
    desktopUiPreferences: { utilityPanelWidth: 900, utilityPanelTab: "unknown" },
  })).toMatchObject({ utilityPanelWidth: 560, utilityPanelTab: "inbox" });
  expect(preferencesFromSettings({
    desktopUiPreferences: { utilityPanelWidth: 420, utilityPanelTab: "history" },
  })).toMatchObject({ utilityPanelWidth: 420, utilityPanelTab: "history" });
  expect(preferencesFromSettings({
    desktopUiPreferences: { uiFontFamily: "Inter" },
  })).toMatchObject({ uiFontFamily: "Inter Variable" });
  expect(preferencesFromSettings({})).toMatchObject({
    headingFontFamily: "Geist Pixel",
    uiFontFamily: "Geist Variable",
    codeFontFamily: "JetBrains Mono Variable",
    showStickerLensBackground: true,
  });
  expect(preferencesFromSettings({
    desktopUiPreferences: { showStickerLensBackground: false },
  })).toMatchObject({ showStickerLensBackground: false });
  expect(preferencesFromSettings({
    desktopUiPreferences: {
      sidebarCollapsed: true,
      expandedProjectIds: ["project-a", "project-a", 42, "project-b"],
      lastCanvasByProject: { "project-a": "canvas-a", "project-b": 42 },
      floorRailWidthByProject: { "project-a": 420, "project-b": 900, invalid: "wide" },
    },
  })).toMatchObject({
    sidebarCollapsed: true,
    expandedProjectIds: ["project-a", "project-b"],
    lastCanvasByProject: { "project-a": "canvas-a" },
    floorRailWidthByProject: { "project-a": 420, "project-b": 680 },
  });
});

test("maps the legacy appearance document into desktop preferences", () => {
  const legacy = normalizeLegacyWindowsPreferences({
    version: 1,
    mode: "system",
    fixedThemeId: "mono-light",
    systemLightThemeId: "mono-light",
    systemDarkThemeId: "mono-dark",
    customThemes: [],
    uiFontFamily: "Inter",
    codeFontFamily: "Cascadia Code",
    uiFontSize: 12,
    terminalFontSize: 14,
    sidebarExpandedWidth: 272,
    paneHeaderHeight: 30,
    showSuggestions: false,
    showPaneActions: true,
    showProjectPaths: true,
    showRecentActivity: false,
    showAgentRail: true,
  });
  expect(legacy).toMatchObject({
    theme: "paper",
    appearanceMode: "system",
    fixedThemeId: "mono-light",
    sidebarWidth: 272,
    uiFontSize: 12,
  });
  expect(legacy).not.toHaveProperty("paneHeaderHeight");
  expect(legacy).not.toHaveProperty("showSuggestions");
  expect(normalizeLegacyWindowsPreferences({ version: 2 })).toBeUndefined();
});

test("accepts only bounded acyclic Ops decomposition proposals", () => {
  const proposal = {
    requestId: "request-1",
    parentId: "parent-1",
    tasks: [
      { key: "core", title: "Core", detail: "Implement core", definitionOfDone: "Core works", verificationCommand: "bun test core", dependencyKeys: [], expectedFiles: [] },
      { key: "ui", title: "UI", detail: "Implement UI", definitionOfDone: "UI works", verificationCommand: "bun test ui", dependencyKeys: ["core"], expectedFiles: [] },
    ],
  };
  expect(parseOpsDecompositionProposal(`wheeljack.ops_decomposition ${JSON.stringify(proposal)}`)?.tasks).toHaveLength(2);
  expect(parseOpsDecompositionProposal(`wheeljack.ops_decomposition ${JSON.stringify({
    ...proposal,
    tasks: proposal.tasks.map((task) => ({ ...task, verificationCommand: "" })),
  })}`)).toBeUndefined();
  expect(parseOpsDecompositionProposal(`wheeljack.ops_decomposition ${JSON.stringify({
    ...proposal,
    tasks: [
      { ...proposal.tasks[0], dependencyKeys: ["ui"] },
      { ...proposal.tasks[1], dependencyKeys: ["core"] },
    ],
  })}`)).toBeUndefined();
});

test("deduplicates and bounds activity newest-first", () => {
  const activity = Array.from({ length: 55 }, (_, index) => ({
    id: index,
    sessionId: "session-1",
    seq: index,
    kind: "terminal",
    status: "completed",
    message: `event ${index}`,
    payload: {},
    isRead: false,
    createdAt: `2026-07-23T12:${String(index).padStart(2, "0")}:00Z`,
  }));

  const deduped = dedupeActivity([activity[10], ...activity, activity[10]]);

  expect(deduped).toHaveLength(50);
  expect(deduped[0].id).toBe(54);
  expect(deduped.at(-1)?.id).toBe(5);
  expect(deduped.filter((item) => item.id === 10)).toHaveLength(1);
});

test("applies coordination events without changing unrelated cards", () => {
  const current = parseOpsState({
    version: 2,
    cards: [
      {
        id: "task-1",
        title: "Terminal parity",
        columnId: "queued",
        agentStatuses: { alpha: "running", beta: "running" },
      },
      { id: "task-2", title: "Unrelated", columnId: "queued" },
    ],
    eventCursors: { before: 2 },
  });

  const active = applyCoordinationEvents(current, {
    events: [
      {
        id: "event-1",
        taskId: "task-1",
        task: "Terminal parity",
        callsign: "alpha",
        status: "in_progress",
        expectedFiles: ["TerminalSurface.tsx"],
        note: "Rendering frames",
        runId: "run-1",
        progress: {
          runId: "run-1",
          updatedAt: "2026-07-23T12:00:00Z",
          currentStepId: "render",
          steps: [{ id: "render", label: "Render frames", state: "running" }],
        },
        timestamp: "2026-07-23T12:00:00Z",
      },
    ],
    cursors: { alpha: 3 },
    warnings: [],
  });
  const review = applyCoordinationEvents(active, {
    events: [
      {
        id: "event-2",
        taskId: "task-1",
        task: "Terminal parity",
        callsign: "beta",
        status: "blocked",
        expectedFiles: [],
        note: "Needs review",
        timestamp: "2026-07-23T12:01:00Z",
      },
    ],
    cursors: { alpha: 3, beta: 1 },
    warnings: [],
  });

  expect(active.cards[0]).toMatchObject({
    columnId: "active",
    agentStatuses: { alpha: "in_progress", beta: "running" },
    expectedFiles: ["TerminalSurface.tsx"],
    lastNote: "Rendering frames",
    runProgress: { runId: "run-1", currentStepId: "render" },
  });
  expect(active.cards[0].events?.at(-1)).toMatchObject({ status: "in_progress", runId: "run-1" });
  expect(review.cards[0]).toMatchObject({
    columnId: "review",
    agentStatuses: { alpha: "in_progress", beta: "blocked" },
    lastNote: "Needs review",
  });
  expect(review.cards[1]).toEqual(current.cards[1]);
  expect(review.eventCursors).toEqual({ alpha: 3, beta: 1 });
});

test("moves a coordinated task to verification when every agent is done", () => {
  const current = parseOpsState({
    version: 2,
    cards: [
      {
        id: "task-1",
        title: "Ship",
        columnId: "active",
        agentStatuses: { alpha: "running", beta: "running" },
      },
    ],
  });

  const result = applyCoordinationEvents(current, {
    events: [
      {
        id: "event-1",
        taskId: "task-1",
        task: "Ship",
        callsign: "alpha",
        status: "done",
        expectedFiles: [],
        timestamp: "2026-07-23T12:00:00Z",
      },
      {
        id: "event-2",
        taskId: "task-1",
        task: "Ship",
        callsign: "beta",
        status: "done",
        expectedFiles: [],
        timestamp: "2026-07-23T12:01:00Z",
      },
    ],
    cursors: { alpha: 1, beta: 1 },
    warnings: [],
  });

  expect(result.cards[0].columnId).toBe("review");
});

test("persists a deduplicated coordination timeline and elapsed boundaries", () => {
  const current = parseOpsState({
    version: 2,
    cards: [{ id: "task-1", title: "Timeline", columnId: "queued" }],
  });
  const response = {
    events: [{
      id: "event-1",
      taskId: "task-1",
      task: "Timeline",
      callsign: "claude",
      status: "in_progress",
      expectedFiles: ["src/App.tsx"],
      note: "Implementing the reducer",
      timestamp: "2026-07-23T12:00:00Z",
    }],
    cursors: { claude: 1 },
    warnings: [],
  };

  const first = applyCoordinationEvents(current, response);
  const duplicate = applyCoordinationEvents(first, response);

  expect(duplicate.cards[0]).toMatchObject({
    startedAt: "2026-07-23T12:00:00Z",
    expectedFiles: ["src/App.tsx"],
    events: [{
      id: "event-1",
      kind: "assignment",
      message: "Implementing the reducer",
    }],
  });
  expect(duplicate.cards[0].events).toHaveLength(1);
});

test("applies semantic task orchestration without raw column offsets", () => {
  const current = parseOpsState({
    version: 2,
    cards: [{
      id: "task-1",
      title: "Control room",
      columnId: "queued",
      steeringDirective: {
        id: "stale-conflict",
        text: "Yield src/App.tsx",
        createdAt: "2026-07-23T10:00:00Z",
        status: "canceled",
        kind: "file_conflict",
        conflictFiles: ["src/App.tsx"],
      },
      verificationRun: {
        sessionId: "verification-1",
        command: "bun run test",
        worktreePath: "C:\\repo-task",
        cwd: "C:\\repo-task",
        baseCommit: "base",
        status: "passed",
        startedAt: "2026-07-23T11:00:00Z",
        endedAt: "2026-07-23T11:01:00Z",
        exitCode: 0,
        snapshotId: "snapshot-1",
      },
    }],
  });
  const assigned = applyOpsOrchestration(current, "task-1", "assign", "claude", "Claude Code 1", "2026-07-23T12:00:00Z");
  const review = applyOpsOrchestration(assigned, "task-1", "review", "pi", "Pi 1", "2026-07-23T12:10:00Z");
  const done = applyOpsOrchestration(review, "task-1", "complete", undefined, undefined, "2026-07-23T12:15:00Z");
  const approved = applyOpsOrchestration(review, "task-1", "approve", undefined, undefined, "2026-07-23T12:15:00Z");
  const isolated = parseOpsState({
    version: 2,
    cards: [{
      id: "isolated",
      title: "Isolated",
      columnId: "active",
      taskLane: {
        kind: "git-worktree",
        worktreePath: "C:\\repo-task",
        cwd: "C:\\repo-task",
        branch: "wheeljack/task",
        baseCommit: "a".repeat(40),
      },
    }],
  });
  const bypassed = applyOpsOrchestration(isolated, "isolated", "complete", undefined, undefined, "2026-07-23T12:15:00Z");

  expect(assigned.cards[0]).toMatchObject({
    columnId: "active",
    assigneeIds: ["claude"],
    assignee: "Claude Code 1",
    startedAt: "2026-07-23T12:00:00Z",
  });
  expect(assigned.cards[0].verificationRun).toBeUndefined();
  expect(assigned.cards[0].steeringDirective).toBeUndefined();
  expect(review.cards[0]).toMatchObject({ columnId: "review", reviewerId: "pi" });
  expect(done.cards[0]).toMatchObject({ columnId: "done", completedAt: "2026-07-23T12:15:00Z" });
  expect(done.cards[0].events?.map((event) => event.kind)).toEqual(["assignment", "update", "completion"]);
  expect(approved.cards[0].columnId).toBe("done");
  expect(approved.cards[0].events?.at(-1)?.message).toBe("Verification approved");
  expect(bypassed.cards[0].columnId).toBe("active");
  expect(bypassed.cards[0].events).toEqual([]);
});

test("starts a reassigned file overlap with fresh automatic arbitration state", () => {
  const current = parseOpsState({
    version: 2,
    cards: [
      {
        id: "owner",
        title: "Owner",
        columnId: "active",
        priority: "high",
        assigneeIds: ["owner-agent"],
        expectedFiles: ["src/shared.ts"],
      },
      {
        id: "yielding",
        title: "Yielding",
        columnId: "queued",
        expectedFiles: ["src/shared.ts"],
        steeringDirective: {
          id: "stale-conflict",
          text: "Yield src/shared.ts",
          createdAt: "2026-07-23T10:00:00Z",
          status: "canceled",
          kind: "file_conflict",
          conflictFiles: ["src/shared.ts"],
        },
      },
    ],
  });

  const assigned = applyOpsOrchestration(current, "yielding", "assign", "yielding-agent", "Yielding agent", "2026-07-23T12:00:00Z");
  const conflict = opsActiveFileConflicts(assigned)[0];

  expect(assigned.cards[1].steeringDirective).toBeUndefined();
  expect(conflict).toEqual({ file: "src/shared.ts", cardIds: ["owner", "yielding"] });
  expect(opsFileConflictNeedsAttention(assigned, conflict, [
    { nodeId: "owner-agent", status: "running" },
    { nodeId: "yielding-agent", status: "running" },
  ] as Parameters<typeof opsFileConflictNeedsAttention>[2])).toBe(false);
});

test("requests a pause without committing state until the agent reports paused", () => {
  const current = parseOpsState({
    version: 2,
    cards: [{
      id: "task-1",
      title: "Pause safely",
      columnId: "active",
      assigneeIds: ["claude"],
      agentStatuses: { claude: "running" },
      agentFiles: { claude: ["src/App.tsx"] },
      startedAt: "2026-07-23T12:00:00Z",
      verificationRun: {
        sessionId: "verification",
        command: "bun test",
        worktreePath: "C:\\repo-task",
        cwd: "C:\\repo-task",
        baseCommit: "a".repeat(40),
        status: "failed",
        startedAt: "2026-07-23T12:02:00Z",
      },
      runProgress: { runId: "run", updatedAt: "2026-07-23T12:03:00Z", steps: [{ id: "one", label: "Work", state: "running" }] },
      steeringDirective: { id: "steer", text: "Continue", createdAt: "2026-07-23T12:04:00Z", status: "queued" },
    }],
  });

  const requested = applyOpsPauseRequest(current, "task-1", "claude", "2026-07-23T12:05:00Z");
  expect(requested.cards[0]).toMatchObject({
    columnId: "active",
    agentStatuses: { claude: "running" },
    lastNote: "Pause requested; waiting for the agent to report paused.",
    events: [expect.objectContaining({ kind: "update", message: "Pause requested" })],
  });
  expect(requested.cards[0].paused).not.toBe(true);

  const paused = applyCoordinationEvents(requested, {
    events: [{
      id: "event-paused",
      taskId: "task-1",
      task: "Pause safely",
      callsign: "claude",
      status: "paused",
      expectedFiles: [],
      note: "Progress saved and work paused",
      timestamp: "2026-07-23T12:06:00Z",
    }],
    cursors: { claude: 1 },
    warnings: [],
  });
  expect(paused.cards[0]).toMatchObject({
    columnId: "queued",
    paused: true,
    pausedAt: "2026-07-23T12:06:00Z",
    agentStatuses: { claude: "paused" },
  });
  expect(applyOpsOrchestration(paused, "task-1", "resume", "claude", "Claude Code 1", "2026-07-23T12:10:00Z").cards[0]).toMatchObject({
    columnId: "active",
    assigneeIds: ["claude"],
    paused: false,
    pausedAt: undefined,
    events: [
      expect.objectContaining({ kind: "update", message: "Pause requested" }),
      expect.objectContaining({ kind: "pause", message: "Progress saved and work paused" }),
      expect.objectContaining({ kind: "update", message: "Work resumed" }),
    ],
  });
  expect(applyOpsOrchestration(paused, "task-1", "release", undefined, undefined, "2026-07-23T12:12:00Z").cards[0]).toMatchObject({
    columnId: "queued",
    assignee: "Unassigned",
    assigneeIds: [],
    agentStatuses: {},
    paused: false,
    agentFiles: undefined,
    startedAt: undefined,
    verificationRun: undefined,
    runProgress: undefined,
    steeringDirective: undefined,
    events: [
      expect.objectContaining({ kind: "update", message: "Pause requested" }),
      expect.objectContaining({ kind: "pause", message: "Progress saved and work paused" }),
      expect.objectContaining({ kind: "update", message: "Returned to Ready; previous ownership released" }),
    ],
  });
});

test("preserves user turns while replacing streamed agent messages", () => {
  const user = { id: "user-1", role: "user", kind: "message", text: "Run tests" } as const;
  const streaming = { id: "assistant-1", role: "assistant", kind: "message", text: "Running", streaming: true } as const;
  const completed = { ...streaming, text: "Tests passed", streaming: false };

  expect(mergeAgentMessages([user, streaming], [completed, completed])).toEqual([user, completed]);
});

test("preserves structured reviewer verdicts from coordination handoffs", () => {
  const current = parseOpsState({
    version: 2,
    cards: [{ id: "task-review", title: "Review", columnId: "review" }],
  });
  const reviewed = applyCoordinationEvents(current, {
    events: [{
      id: "reviewer.ndjson:2",
      taskId: "task-review",
      task: "Review",
      callsign: "reviewer",
      status: "completed",
      expectedFiles: [],
      note: "Review complete",
      handoff: "REVIEW VERDICT: REQUEST CHANGES\nMissing coverage.",
      timestamp: "2026-07-23T12:00:00Z",
    }],
    cursors: { reviewer: 2 },
    warnings: [],
  });

  expect(reviewed.cards[0].lastNote).toContain("REVIEW VERDICT: REQUEST CHANGES");
  expect(reviewed.cards[0].events?.at(-1)?.message).toContain("REVIEW VERDICT: REQUEST CHANGES");
});

test("backfills a legacy task contract from its worker's completion handoff", () => {
  const directive = 'wheeljack.ops_contract {"taskId":"legacy-task","definitionOfDone":"Shortcut settings persist after restart","constraints":"Preserve existing bindings","verificationCommand":"bun run test"}';
  expect(parseOpsTaskContractProposal(directive)).toEqual({
    taskId: "legacy-task",
    definitionOfDone: "Shortcut settings persist after restart",
    constraints: "Preserve existing bindings",
    verificationCommand: "bun run test",
  });
  expect(parseOpsTaskContractProposal('wheeljack.ops_contract {"taskId":"legacy-task","definitionOfDone":"","verificationCommand":""}')).toBeUndefined();

  const state = parseOpsState({
    version: 2,
    cards: [{ id: "legacy-task", title: "Legacy task", columnId: "active" }],
  });
  state.cards[0].verificationRun = {
    sessionId: "verification-old",
    command: "old command",
    worktreePath: "C:\\repo-task",
    cwd: "C:\\repo-task",
    baseCommit: "a".repeat(40),
    status: "passed",
    startedAt: "2026-08-08T11:00:00Z",
  };
  const completed = applyCoordinationEvents(state, {
    events: [{
      id: "worker.ndjson:2",
      taskId: "legacy-task",
      task: "Legacy task",
      callsign: "worker",
      status: "completed",
      expectedFiles: ["src/shortcuts.ts"],
      handoff: `${directive}\nImplemented persistence and ran the focused suite.`,
      timestamp: "2026-08-08T12:00:00Z",
    }],
    cursors: { worker: 2 },
    warnings: [],
  });

  expect(completed.cards[0]).toMatchObject({
    columnId: "review",
    definitionOfDone: "Shortcut settings persist after restart",
    constraints: "Preserve existing bindings",
    verificationCommand: "bun run test",
    verificationRun: undefined,
    lastNote: "Implemented persistence and ran the focused suite.",
  });
  expect(completed.cards[0].events?.at(-1)?.message).toBe("Implemented persistence and ran the focused suite.");
});

test("parses project-document previews into file and line changes", () => {
  const files = parseProjectDocumentDiff([
    "--- a/KANBAN.md",
    "+++ b/KANBAN.md",
    "@@ full file @@",
    "-Old task",
    "+New task",
    "+Next task",
    "--- a/PRD.md",
    "+++ b/PRD.md",
    "@@ full file @@",
    "+# Product",
  ].join("\n"));
  expect(files).toMatchObject([
    { name: "KANBAN.md", additions: 2, deletions: 1, lines: [
      { kind: "removed", content: "Old task", oldLine: 1 },
      { kind: "added", content: "New task", newLine: 1 },
      { kind: "added", content: "Next task", newLine: 2 },
    ] },
    { name: "PRD.md", additions: 1, deletions: 0 },
  ]);
});

test("replaces parsed streaming responses with Codex working commentary", () => {
  const user = { id: "user-1", role: "user", kind: "message", text: "Inspect the repo" } as const;
  const streamed = { id: "node-1-agent-2-message", role: "assistant", kind: "message", text: "Reading files", streaming: true } as const;
  const working = { id: "node-1-agent-3-commentary", role: "system", kind: "commentary", title: "Working", text: "Reading files" } as const;

  expect(reconcileParsedAgentMessages([user, streamed], [working], "node-1")).toEqual([user, working]);
});

test("merges agent messages only by stable id and preserves resolved interactions", () => {
  const repeated = { role: "assistant", kind: "message", text: "Same answer" };
  const approval = {
    id: "approval-1",
    role: "system",
    kind: "approval",
    text: "cargo test",
    interactionState: "approved",
  } as const;

  expect(mergeAgentMessages(
    [{ id: "answer-1", ...repeated }, approval],
    [{ id: "answer-2", ...repeated }, { ...approval, interactionState: undefined }],
  )).toEqual([
    { id: "answer-1", ...repeated },
    approval,
    { id: "answer-2", ...repeated },
  ]);
  expect(setAgentInteractionState([approval], approval.id, "denied")[0].interactionState).toBe("denied");
  expect(agentStatusAfterInteraction("completed", [approval])).toBe("completed");
  expect(agentStatusAfterInteraction("running", [{ ...approval, interactionState: "pending" }])).toBe("needs_input");
  expect(agentStatusAfterInteraction("needs_input", [{ ...approval, interactionState: "approved" }])).toBe("running");
});

test("condenses streamed tool fragments into their originating call", () => {
  const tools = [
    { id: "node-agent-1-tool-call-1", role: "system", kind: "tool", text: "KAN", streaming: true },
    { id: "node-agent-2-tool", role: "system", kind: "tool", text: "BAN.md", streaming: false },
  ];
  const request = {
    id: "assistant-1",
    role: "assistant",
    kind: "message",
    text: "I need permission to write to KANBAN.md. Can you approve the file write?",
  };

  expect(groupAgentMessages([...tools, request])).toEqual([[
    { ...tools[0], text: "KANBAN.md", streaming: false },
  ], request]);
});

test("hydrates persisted legacy terminal transcript chunks", () => {
  expect(nodeTranscript({ transcript: ["first", "second", { ignored: true }] })).toBe("first\nsecond");
  expect(nodeTranscript({ transcript: "single transcript" })).toBe("single transcript");
});

test("uses the completed session id only for transcript recovery", () => {
  expect(nodeHistorySessionId({ sessionId: "running", lastSessionId: "prior" })).toBe("running");
  expect(nodeHistorySessionId({ lastSessionId: "completed" })).toBe("completed");
  expect(nodeHistorySessionId({})).toBe("");
});
