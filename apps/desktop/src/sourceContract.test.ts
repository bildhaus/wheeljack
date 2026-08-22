// Source-contract lint, not a behaviour suite.
//
// Every assertion here matches raw source text, so it pins file layout as well as
// behaviour. That is deliberate for invariants with no runtime surface, and it is a
// liability everywhere else: renaming a symbol or extracting a helper fails these
// checks while the behaviour is unchanged.
//
// Rule: do not add an assertion here unless the invariant is genuinely unobservable
// at runtime. Everything else belongs in a render or interaction test in App.test.ts
// or a surface-level suite. As surfaces are extracted from App.tsx, the checks that
// cover them should move with them and become behavioural.
import { readFileSync } from "node:fs";
import path from "node:path";
import appAsset from "./App.tsx?raw";
import paritySource from "./ParitySurfaces.tsx?raw";
import workspaceRuntimeSource from "./WorkspaceRuntimeSurface.tsx?raw";
import stylesAsset from "./styles.css?raw";
import shortcutsSource from "./shortcuts.ts?raw";
import terminalSurfaceSource from "./TerminalSurface.tsx?raw";
import messageScrollerSource from "./components/ui/message-scroller.tsx?raw";
import tabsSource from "./components/ui/tabs.tsx?raw";
import tauriSource from "../src-tauri/src/lib.rs?raw";
import {
  adapterRepairCommand,
  agentExitStatus,
  agentFailureNeedsRepair,
  agentParseStatus,
  canonicalTaskLaneCwd,
  agentAutonomyPolicyFromSettings,
  defaultAgentAutonomyPolicy,
  defaultOpsState,
  hasMeaningfulPlanState,
  hasProjectPlanDocuments,
  isLiveSessionStatus,
  isTerminalSessionStatus,
  mergeProjectDocuments,
  nextCanvasName,
  normalizeUiScale,
  parseOpsState,
  parseOpsRunProgress,
  parseOpsSteeringDirective,
  paneDropPosition,
  parseProjectDocumentProposal,
  renderKanban,
  recoverOpsVerificationRuns,
  resolveAgentCwd,
  shouldAutoCloseTaskAgent,
  supportsAttachedTerminal,
  supportsAgentImageInput,
  supportsAgentTurnCancel,
  shouldReloadStickerLens,
  workspacePathsEqual,
} from "./App";
import { messagesForAgentStatus } from "./AgentChat";

// Vitest stubs CSS raw imports, so this suite needs a filesystem fallback. Resolve
// from the vitest root rather than import.meta.url, which is not a file URL in jsdom.
const appSource = appAsset;
const stylesSource: string = stylesAsset || readFileSync(path.resolve(process.cwd(), "src/styles.css"), "utf8");

test("reloads the sticker lens only when entering a project surface after Home", () => {
  expect(shouldReloadStickerLens("terminal", true, true)).toBe(true);
  expect(shouldReloadStickerLens("ops", true, false)).toBe(false);
  expect(shouldReloadStickerLens("terminal", false, true)).toBe(false);
  expect(appSource.match(/<StickerLensBackground/g)).toHaveLength(1);
  expect(appSource).toContain("preferences.showStickerLensBackground && <StickerLensBackground");
  expect(paritySource).toContain('label="Sticker lens background"');
  expect(paritySource).not.toContain("<StickerLensBackground");
});

test("loads projects, probes and verifies exact profile args, and reuses adapter preference", () => {
  const startupProbe = "const probedAdapters = safeStartup ? detectedAdapters : await probeAdapters(detectedAdapters, savedProfiles)";
  expect(appSource.indexOf("setProjects(existingProjects)"))
    .toBeLessThan(appSource.indexOf(startupProbe));
  expect(appSource).toContain(startupProbe);
  expect(appSource).toContain("status.startupRecovery?.safeMode === true");
  const startupSource = appSource.slice(
    appSource.indexOf(startupProbe),
    appSource.indexOf("const startupProject"),
  );
  expect(startupSource).toContain("preferredCodingAdapterId(");
  const rescanSource = appSource.slice(
    appSource.indexOf("const rescanAdapters"),
    appSource.indexOf("const verifyAdapter"),
  );
  expect(rescanSource).toContain("preferredCodingAdapterId(");
  expect(appSource.match(/callCore<AdapterProbe>\("adapter_verify"/g)).toHaveLength(3);
  const verifySource = appSource.slice(
    appSource.indexOf("const verifyAdapter"),
    appSource.indexOf("const repairAdapter"),
  );
  expect(verifySource).toContain("...agentLaunchConfig(profile)");
  expect(appSource).toContain("attempt.attempts >= 2");
  expect(appSource).toContain("...agentLaunchConfig(target.profile)");
  const probeSource = appSource.slice(
    appSource.indexOf("async function probeAdapters"),
    appSource.indexOf("function percentile"),
  );
  expect(probeSource).toContain("...agentLaunchConfig(profile)");
  expect(appSource.match(/\.\.\.agentLaunchConfig\(profile\)/g)).toHaveLength(2);
  expect(appSource.match(/agentLaunchConfig\(profile, project\.agentAccess\)/g)).toHaveLength(2);
});

test("waits for a structured payload instead of treating shell preamble as agent output", () => {
  expect(appSource).toContain('if (!lines.some((line) => line.trimStart().startsWith("{"))) continue');
});

test("serializes Ops persistence and projection work", () => {
  const persistenceSource = appSource.slice(
    appSource.indexOf("const persistOps ="),
    appSource.indexOf("const changeOps"),
  );
  expect(persistenceSource).toContain("opsProjectionQueueRef.current");
  expect(persistenceSource.indexOf("opsPersistQueueRef.current = pending"))
    .toBeLessThan(persistenceSource.indexOf("opsProjectionQueueRef.current"));
});

test("flushes pending Ops state before approving a project-document write", () => {
  const commitSource = appSource.slice(
    appSource.indexOf("const commitPendingDocumentWrite"),
    appSource.indexOf("const createProjectDocument"),
  );
  expect(commitSource.indexOf("await persistOps(opsStateRef.current"))
    .toBeLessThan(commitSource.indexOf('"project_documents_commit_write"'));
});

test("supports missing-project recovery and avoids activating absent folders", () => {
  expect(appSource).toContain('callCore<Project>("project_relink"');
  expect(appSource).toContain("projectId: missingProject.id");
  expect(appSource).toContain("const startupProject = existingProjects.find((candidate) => candidate.pathExists !== false)");
  expect(paritySource).toContain("Folder missing");
  expect(paritySource).toContain("Relink folder");
});

test("gates the accessible three-step guide until desktop startup has hydrated", () => {
  const onboardingSource = paritySource.slice(
    paritySource.indexOf("export function OnboardingSurface"),
    paritySource.indexOf("function Metric"),
  );
  const titleBarSource = paritySource.slice(
    paritySource.indexOf("export function TitleBar"),
    paritySource.indexOf("function TitleAction"),
  );

  expect(appSource).toContain("const onboardingActive = onboardingVersion === 0");
  expect(appSource).toContain('const onboardingVisible = surface === "home" && startupReady && onboardingActive');
  expect(appSource).toContain("onboarding={onboardingVisible}");
  expect(appSource).toMatch(/\{!onboardingVisible && \(\s*<ProjectSidebar/);
  expect(titleBarSource).toContain('data-onboarding={onboarding || undefined}');
  expect(titleBarSource).toContain('{!onboarding && <span className="wj-title-name">{title}</span>}');
  expect(titleBarSource).toContain('<div className="wj-title-utilities">');
  expect(titleBarSource).toContain('{!onboarding && <><TitleAction label="Inbox"');
  expect(titleBarSource).toContain('data-updater-status={updater.status}');
  expect(titleBarSource).toContain('className="wj-window-actions"');
  expect(onboardingSource).toContain('aria-current={number === step ? "step" : undefined}');
  expect(onboardingSource).toContain("headingRef.current?.focus()");
  expect(onboardingSource).toContain('aria-busy={busy}');
  expect(onboardingSource).toContain('aria-live="polite"');
  expect(onboardingSource).toContain('role="alert"');
  expect(onboardingSource).toContain("Open project folder");
  expect(onboardingSource).toContain("wheeljack runs one real, non-mutating test turn.");
  expect(onboardingSource).toContain("Use wheeljack as a terminal");
  expect(onboardingSource).toContain("Skip guide");
  expect(paritySource).toContain("Review this repository and tell me what it does, how to run it, and one useful next task. Don’t change files.");
});

test("starts onboarding agents in the background but still reveals onboarding shells immediately", () => {
  const onboardingActions = appSource.slice(
    appSource.indexOf("const startOnboardingAgent"),
    appSource.indexOf("const terminalAgents"),
  );
  const agentAction = onboardingActions.slice(0, onboardingActions.indexOf("const startOnboardingShell"));
  const shellAction = onboardingActions.slice(onboardingActions.indexOf("const startOnboardingShell"));

  expect(agentAction).toContain("return spawnAgent(prompt)");
  expect(agentAction).not.toContain("setSurface(");
  expect(paritySource).toContain("Agent started in Work.");
  expect(shellAction.indexOf('setSurface("terminal")'))
    .toBeLessThan(shellAction.indexOf("await spawnShell()"));
  expect(shellAction.indexOf("if (!started) return false"))
    .toBeLessThan(shellAction.indexOf("await saveDesktopOnboardingVersion"));
  expect(appSource).toContain("const spawnShell = async (");
  expect(appSource).toContain("origin?: AgentSpawnOrigin, placement: PanePlacement = \"auto\"");
});

test("uses project-wide callsigns for every agent launch", () => {
  const spawnSource = appSource.slice(
    appSource.indexOf("const spawnAgent = async"),
    appSource.indexOf("const closePane = async"),
  );

  expect(spawnSource).toContain("reserveAgentCallsign(callsignCanvases, pendingAgentCallsignsRef.current)");
  expect(spawnSource).not.toContain("adapter?.displayName ?? launchAdapterId} ${nodes.filter");
});

test("keeps agent launches on the current surface while pane creation settles", () => {
  const navigationSource = appSource.slice(
    appSource.indexOf("const navigateProject = async"),
    appSource.indexOf("const resumeSafeStartup"),
  );
  expect(navigationSource.indexOf("setSurface(nextSurface)"))
    .toBeLessThan(navigationSource.indexOf("await activateProject"));
  expect(navigationSource).toContain("setSurface(previousSurface)");

  const planLaunchSource = appSource.slice(
    appSource.indexOf("const startAgentForOpsTask = async"),
    appSource.indexOf("const startReviewerForOpsTask"),
  );
  expect(planLaunchSource).toContain("return spawnAgent(prompt, card, prompt, role, schedulerLeaseId, launchAdapterId)");
  expect(planLaunchSource).not.toContain("setSurface(");
  expect(planLaunchSource).not.toContain("setAgentCreatorOpen(");

  const spawnSource = appSource.slice(
    appSource.indexOf("const spawnAgent = async"),
    appSource.indexOf("const closePane = async"),
  );
  expect(spawnSource.indexOf("setNodes((current) => [...current, optimisticNode])"))
    .toBeLessThan(spawnSource.indexOf("await ensureOpsTaskLane(opsTask)"));
  expect(spawnSource.indexOf("applyLayout(optimisticLayout.root"))
    .toBeLessThan(spawnSource.indexOf('"agent_structured_spawn"'));
  expect(spawnSource).toContain("rollbackOptimisticPane(nodeId");

  const shellSource = appSource.slice(
    appSource.indexOf("const spawnShell = async"),
    appSource.indexOf("const spawnDataPane = async"),
  );
  expect(shellSource.indexOf("setNodes((current) => [...current, optimisticNode])"))
    .toBeLessThan(shellSource.indexOf("await createShell"));
  expect(shellSource).toContain("rollbackOptimisticPane(nodeId");
  expect(appSource).toContain("const rollbackOptimisticPane = (");
  expect(appSource).toContain("removePane(layoutRef.current, nodeId)");
});

test("optimistically updates lightweight toggles and inbox actions", () => {
  const activitySource = appSource.slice(
    appSource.indexOf("const acknowledgeActivity = async"),
    appSource.indexOf("const clearSessionTranscripts = async"),
  );
  expect(activitySource.indexOf("setActivity"))
    .toBeLessThan(activitySource.indexOf('callCore("activity_mark_read"'));
  expect(activitySource.indexOf("setActivity([])"))
    .toBeLessThan(activitySource.indexOf('callCore("activity_clear"'));
  expect(activitySource).toContain("setActivity(previous)");

  const schedulerSource = appSource.slice(
    appSource.indexOf("const updateAutonomousPickup"),
    appSource.indexOf("const claimScheduledTask"),
  );
  expect(schedulerSource.indexOf("setAutonomousPickup(enabled)"))
    .toBeLessThan(schedulerSource.indexOf("saveSchedulerConfig"));
  expect(schedulerSource).toContain("setAutonomousPickup(previous)");
  expect(schedulerSource.indexOf("setAutonomousConcurrency(concurrencyLimit)"))
    .toBeLessThan(schedulerSource.lastIndexOf("saveSchedulerConfig"));
});

test("defaults autonomous collaboration on with bounded policy settings", () => {
  expect(defaultAgentAutonomyPolicy()).toEqual({
    enabled: true,
    listAgents: "allow",
    sendMessage: "allow",
    spawnAgent: "allow",
    handoffTask: "allow",
    requestReview: "allow",
    resolveFileConflict: "allow",
    maxDepth: 2,
    maxChildrenPerAgent: 3,
    maxConcurrentAgents: 8,
    maxActionsPerMinute: 20,
  });
  expect(agentAutonomyPolicyFromSettings({
    agentAutonomyPolicy: { maxDepth: 99, spawnAgent: "ask", sendMessage: "invalid" },
  })).toMatchObject({ maxDepth: 4, spawnAgent: "ask", sendMessage: "deny" });
  expect(paritySource).toContain('title="Agent autonomy"');
  expect(paritySource).toContain('title="Autonomy history"');
});

test("normalizes explicit run progress and restart-safe steering without serializing telemetry to KANBAN", () => {
  expect(parseOpsRunProgress({
    runId: "run-1",
    updatedAt: "2026-08-11T17:00:00Z",
    currentStepId: "verify",
    steps: [
      { id: "edit", label: "Edit files", state: "done" },
      { id: "verify", label: "Run tests", state: "running" },
    ],
  })?.steps).toHaveLength(2);
  expect(parseOpsRunProgress({
    runId: "run-1",
    updatedAt: "2026-08-11T17:00:00Z",
    steps: [{ id: "x", label: "Invented", state: "guessed" }],
  })).toBeUndefined();
  expect(parseOpsSteeringDirective({
    id: "directive-1",
    text: "Run the full test suite next",
    createdAt: "2026-08-11T17:00:00Z",
    status: "delivering",
  })).toMatchObject({ status: "failed", error: expect.stringContaining("interrupted") });

  const state = parseOpsState({
    version: 2,
    cards: [{
      id: "task",
      title: "Task",
      runProgress: { runId: "run-1", updatedAt: "2026-08-11T17:00:00Z", steps: [] },
      steeringDirective: { id: "directive-1", text: "Verify next", createdAt: "2026-08-11T17:00:00Z", status: "queued" },
    }],
  });
  expect(state.cards[0].runProgress?.runId).toBe("run-1");
  expect(state.cards[0].steeringDirective?.status).toBe("queued");
  expect(renderKanban(state)).not.toMatch(/runProgress|steeringDirective|run-1|Verify next/);
  expect(appSource).toContain('["queued", "delivering", "failed"].includes(card.steeringDirective.status)');
});

test("auto-closes task agents when their turn completes or their task reaches Done", () => {
  expect(shouldAutoCloseTaskAgent(true, "completed", "review")).toBe(true);
  expect(shouldAutoCloseTaskAgent(true, "failed", "done")).toBe(true);
  expect(shouldAutoCloseTaskAgent(true, "running", "done")).toBe(true);
  expect(shouldAutoCloseTaskAgent(true, "failed", "review")).toBe(false);
  expect(shouldAutoCloseTaskAgent(false, "completed", "done")).toBe(false);
  expect(appSource).toContain('closePane(node.id, { completedTaskCleanup: completedColumnRole === "done" })');
});

test("keeps intentional agent teardown distinct from process failure", () => {
  expect(agentExitStatus("completed", 1, false, "completed")).toBe("completed");
  expect(agentExitStatus("running", 1, true, "canceled")).toBe("canceled");
  expect(agentExitStatus("running", 1, true, "shutdown")).toBe("disconnected");
  expect(agentExitStatus("running", 1, false)).toBe("failed");
  expect(agentExitStatus("running", 0, false)).toBe("completed");
  expect(agentFailureNeedsRepair("Exit code 1")).toBe(false);
  expect(agentFailureNeedsRepair("Authentication required; sign in again.")).toBe(true);
  expect(appSource).toContain('terminationReason: taskIsComplete || runtime.status === "completed" ? "completed" : "canceled"');
});

test("presents app errors as a top-center motion-aware notification stack", () => {
  expect(appSource).toContain('<Toast.Provider duration={8000} swipeDirection="up">');
  expect(appSource).toContain("errorToasts.map((toast)");
  expect(appSource).toContain("].slice(0, 3)");
  expect(appSource).toContain('<Toast.Viewport className="wj-toast-viewport"');
  expect(stylesSource).toContain(".wj-toast-viewport { position: absolute; z-index: 20; top: 12px; left: 50%;");
  expect(stylesSource).toContain('.wj-error-toast[data-state="open"]');
  expect(stylesSource).toContain('.wj-error-toast[data-state] { animation: agent-fade-in 120ms');
});

test("quick starts the last-used agent with smart placement and keeps manual directions optional", () => {
  const launcherSource = appSource.slice(
    appSource.indexOf('className="wj-agent-launcher"'),
    appSource.indexOf('className="wj-canvas-bar"'),
  );
  expect(appSource).toContain("localStorage.getItem(AGENT_ADAPTER_STORAGE_KEY)");
  expect(appSource).not.toContain("AGENT_SPLIT_AXIS_STORAGE_KEY");
  expect(appSource).toContain("const [agentPlacement, setAgentPlacement] = useState<PanePlacement>(\"auto\")");
  expect(appSource).toContain("const optimisticLayout = insertPane(");
  expect(appSource).toContain("if (zoomedPaneId) setZoomedPaneId(nodeId)");
  expect(appSource).not.toContain("if (!initialPrompt.trim()) window.setTimeout");
  expect(workspaceRuntimeSource).toContain('autoFocusComposer={focused && runtime.status === "ready"}');
  expect(launcherSource).toContain('onClick={() => void spawnAgent("")}');
  expect(launcherSource).toContain('aria-label="Configure new agent"');
  expect(launcherSource).toContain("onOpenAutoFocus=");
  expect(launcherSource).toContain("onCloseAutoFocus=");
  expect(launcherSource).toContain("focusCreatedAgentRef.current = focusComposer");
  expect(launcherSource).toContain("event.currentTarget.form?.requestSubmit()");
  expect(launcherSource).toContain('"Create & start" : "Create & focus"');
  expect(launcherSource).toContain('aria-label="Arrange agent automatically"');
  expect(launcherSource).toContain('aria-label="Split agent right"');
  expect(launcherSource).toContain('aria-label="Split agent down"');
  expect(stylesSource).toContain(".wj-agent-launch-primary { border-radius: 6px 0 0 6px");
  expect(stylesSource).toContain(".wj-provider-mark { display: inline-block; width: 16px; height: 16px; flex: 0 0 auto; color: inherit;");
});

test("persists manual takeover and restores smart responsive layout explicitly", () => {
  expect(appSource).toContain("layout: { version: 1, mode, root }");
  expect(appSource).toContain('savedLayout ? savedLayout.mode === "auto" ? "auto" : "manual" : "auto"');
  expect(appSource).toContain('applyLayout(next, source, "manual")');
  expect(appSource).toContain('applyLayout(next, focusedPaneIdRef.current, "manual")');
  expect(appSource).toContain('applyLayout(buildSmartLayout(leaves(layoutRef.current), viewport), focusedPaneIdRef.current, "auto")');
  expect(appSource).toContain("new ResizeObserver");
  expect(appSource).toContain("smartLayoutColumns(paneIds.length, nextViewport)");
  expect(appSource).toContain("Smart arrange<");
});

test("kills a session before mutating or deleting its pane", () => {
  const closeSource = appSource.slice(
    appSource.indexOf("const closePane"),
    appSource.indexOf("const terminalWrite"),
  );
  const kill = closeSource.indexOf('await callCore("session_kill"');

  expect(kill).toBeGreaterThan(-1);
  expect(closeSource).not.toContain('callCore("session_kill", { sessionId: runtime.sessionId }).catch');
  expect(closeSource).toContain('terminationReason: taskIsComplete || runtime.status === "completed" ? "completed" : "canceled"');
  expect(kill).toBeLessThan(closeSource.indexOf("changeOps"));
  expect(kill).toBeLessThan(closeSource.indexOf('await callCore("canvas_delete_node"'));
});

test("keeps the animated expandable Plan stepper in the title bar while merging Work tabs", () => {
  const opsSource = paritySource.slice(
    paritySource.indexOf("export function OpsSurface"),
    paritySource.indexOf("export function SettingsSurface"),
  );
  const titleBarSource = paritySource.slice(
    paritySource.indexOf("export function TitleBar"),
    paritySource.indexOf("function TitleAction"),
  );
  const workToolbarSource = appSource.slice(
    appSource.indexOf('className="wj-surface-toolbar wj-work-toolbar"'),
    appSource.indexOf('className="wj-terminal-content"'),
  );

  expect(opsSource).not.toContain('className="wj-board-actions"');
  expect(opsSource).toContain("documentWarnings.join");
  expect(opsSource).toContain('className="wj-board-floor-link"');
  expect(opsSource).toContain('onClick={() => onPage("floor")}');
  expect(paritySource).toContain('<TabsTrigger value="floor">');
  expect(paritySource).toContain('<TabsTrigger value="spec">');
  expect(opsSource).toContain("const liveSummary = opsCardActivitySummary");
  expect(opsSource).not.toContain('className="wj-task-state"');
  expect(opsSource).not.toContain('className="wj-task-note"');
  expect(opsSource).not.toContain('className="wj-task-files"');
  expect(opsSource).not.toContain('className="wj-task-log-link"');
  expect(opsSource).toContain('className="wj-ops-actions"');
  expect(opsSource).toContain('className="wj-agent-control"');
  expect(opsSource).toContain('"0 agents"');
  expect(opsSource).toContain('className="wj-new-task-action"');
  expect(opsSource).toContain('missingDocumentCount > 0 && <Button variant="outline" size="sm" onClick={onBootstrapPlan}');
  expect(opsSource).toContain('>Re-analyze project</DropdownMenuItem>');
  expect(paritySource).toContain('<strong>Bootstrap plan</strong>');
  expect(opsSource).not.toContain("<ProjectModeSwitch");
  expect(opsSource).toContain('className="wj-surface-toolbar wj-plan-toolbar"');
  expect(paritySource).toContain('className="wj-project-mode-dock"');
  expect(titleBarSource).toContain('aria-label="Project navigation"');
  expect(titleBarSource).toContain('<ProjectModeSwitch surface={projectSurface} onSurface={onSurface} page={opsPage} onPage={onOpsPage} />');
  expect(paritySource).toContain('className="wj-project-plan-slot"');
  expect(paritySource).toContain('document.documentElement.dataset.planCollapsing = "true"');
  expect(paritySource).toContain('document.documentElement.dataset.projectEmptyExiting = "true"');
  expect(paritySource).toContain('document.documentElement.dataset.projectEmptyInstant = "true"');
  expect(paritySource).toContain('window.dispatchEvent(new Event(projectEmptyExitEvent))');
  expect(paritySource).toContain('characters.slice(0, typedCharacterCount).join("")');
  expect(paritySource).toContain('className="wj-empty-type-caret"');
  expect(paritySource).toContain('<TabsList aria-label="Plan views" data-page={page}><TabsTrigger value="floor"><span className="wj-mode-label">Floor</span></TabsTrigger><TabsTrigger value="board"><span className="wj-mode-label">Board</span></TabsTrigger><TabsTrigger value="spec"><span className="wj-mode-label">Spec</span></TabsTrigger></TabsList>');
  expect(opsSource).not.toContain('className="wj-project-plan-sections"');
  expect(titleBarSource).toContain('className="wj-title-branch"');
  expect(titleBarSource).toContain('{project.githubRemote ? <GitHub /> : <GitBranch />}{project.branch}');
  expect(workToolbarSource).toContain('className="wj-canvas-bar"');
  expect(workToolbarSource).not.toContain("project?.branch");
  expect(workToolbarSource).not.toContain("<ProjectModeSwitch");
  expect(workToolbarSource).not.toContain('{project?.name ?? "No project"}');
  expect(opsSource).toContain('aria-label="Columns view"');
  expect(opsSource).toContain("<ProjectEmptyState");
  expect(paritySource).toContain('className="wj-project-empty"');
  expect(opsSource).not.toContain('title="No tasks yet"');
});

test("targets the active state emitted by Radix tabs", () => {
  expect(tabsSource).toContain("data-[state=active]:bg-background");
  expect(tabsSource).not.toContain("data-active:");
});

test("offers responsive board and list task views without horizontal scrolling", () => {
  const opsSource = paritySource.slice(
    paritySource.indexOf("export function OpsSurface"),
    paritySource.indexOf("export function SettingsSurface"),
  );
  expect(opsSource).toContain('useState<"board" | "list">("board")');
  expect(opsSource).toContain('<TabsList aria-label="Task view"><TabsTrigger aria-label="Columns view" value="board">Columns</TabsTrigger><TabsTrigger aria-label="List view" value="list">List</TabsTrigger></TabsList>');
  expect(opsSource).not.toContain("horizontal=");
  expect(opsSource).toContain('data-view={boardView}');
  expect(opsSource.match(/renderTaskMenuItems\(card, cardRole, childProgress/g)).toHaveLength(2);
});

test("keeps Plan document chrome fixed while the editor owns scrolling", () => {
  const documentSource = paritySource.slice(
    paritySource.indexOf("function DocumentSurface"),
    paritySource.indexOf("export function SettingsSurface"),
  );

  expect(documentSource).toContain('className="wj-document-surface min-h-0 flex-1"');
  expect(documentSource).not.toContain("<ScrollArea");
  expect(documentSource).toContain('className="wj-document-editor min-h-0 flex-1');
  expect(documentSource).not.toContain("min-h-[34rem]");
});

test("uses pointer capture for task card dragging", () => {
  expect(paritySource).toContain("setPointerCapture");
  expect(paritySource).toContain("data-kanban-column-id");
  expect(paritySource).not.toContain("setDragImage");
});

test("repositions panes with pointer drag zones", () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  expect(paneDropPosition(rect, 10, 50)).toEqual({ edge: "left", axis: "columns", before: true });
  expect(paneDropPosition(rect, 90, 50)).toEqual({ edge: "right", axis: "columns", before: false });
  expect(paneDropPosition(rect, 50, 10)).toEqual({ edge: "top", axis: "rows", before: true });
  expect(paneDropPosition(rect, 50, 90)).toEqual({ edge: "bottom", axis: "rows", before: false });
  expect(paneDropPosition(rect, 50, 50)).toEqual({ edge: "center" });
  expect(workspaceRuntimeSource).toContain('classList.add("pane-drag-image")');
  expect(workspaceRuntimeSource).toContain("setPointerCapture");
  expect(workspaceRuntimeSource).not.toContain("application/x-wheeljack-pane");
});

test("adds context menus without removing existing pane, project, or task controls", () => {
  const sidebarSource = paritySource.slice(
    paritySource.indexOf("export function ProjectSidebar"),
    paritySource.indexOf("function SidebarButton"),
  );
  const homeSource = paritySource.slice(
    paritySource.indexOf("export function HomeSurface"),
    paritySource.indexOf("function Metric"),
  );
  const opsSource = paritySource.slice(
    paritySource.indexOf("export function OpsSurface"),
    paritySource.indexOf("export function SettingsSurface"),
  );

  expect(appSource).toContain("<ContextMenuTrigger asChild>");
  expect(workspaceRuntimeSource).toContain("onContextMenuSelection={setContextSelection}");
  expect(appSource).toContain("<DropdownMenuTrigger asChild>");
  expect(sidebarSource).toContain("<ProjectMenuItems context");
  expect(homeSource).toContain("<ProjectMenuItems context");
  expect(paritySource).toContain("Project settings");
  expect(paritySource).toContain('role="radiogroup" aria-label="Project icon"');
  expect(appSource).toContain('callCore<Project>("project_update", { project: nextProject })');
  expect(homeSource).toContain("<DropdownMenuTrigger asChild>");
  expect(opsSource).toContain("renderTaskMenuItems(card, cardRole, childProgress, true)");
  expect(opsSource).toContain("<DropdownMenuTrigger asChild>");
});

test("covers app objects and whitespace while preserving native editor menus", () => {
  expect(appSource).toContain('className="wj-shell-body" onContextMenuCapture');
  expect(appSource).toContain('closest("input, textarea, [contenteditable=true]")');
  expect(appSource).toContain(">Switch to canvas</");
  expect(appSource).toContain(">Delete canvas…</");
  expect(appSource).toContain("renderTerminalAgentMenu(runtime)");
  expect(paritySource).toContain(">Create KANBAN.md</");
  expect(paritySource).toContain(">Columns view</");
  expect(paritySource).toContain(">List view</");
  expect(paritySource).toContain(">Copy relative path</");
  expect(paritySource).toContain(">Open session</");
  expect(paritySource).toContain("renderAgentRailMenuItems(runtime)");
  expect(paritySource).toContain('closest("input, textarea, [contenteditable=true]")');
});

test("exposes DevTools only from development context menus", () => {
  expect(appSource).toContain("if (!import.meta.env.DEV) return null");
  expect(paritySource).toContain("if (!import.meta.env.DEV) return null");
  expect(appSource).toContain('invoke("open_devtools")');
  expect(paritySource).toContain('invoke("open_devtools")');
  expect(tauriSource).toContain("#[cfg(debug_assertions)]");
  expect(tauriSource).toContain("window.open_devtools()");
  expect(tauriSource).toMatch(/open_devtools\r?\n\s*\]\)/);
});

test("animates invalid drops and card layout settling without a motion dependency", () => {
  expect(paritySource).toContain("returnToOrigin");
  expect(paritySource).toContain("useLayoutEffect");
  expect(paritySource).toContain('prefers-reduced-motion: reduce');
});

test("uses one responsive tabbed utility panel and a separate review drawer", () => {
  const panelSource = paritySource.slice(
    paritySource.indexOf("export function UtilityPanelSurface"),
    paritySource.indexOf("export function ReviewDrawerSurface"),
  );

  expect(panelSource).toContain('<TabsTrigger value="inbox"');
  expect(panelSource).toContain('<TabsTrigger value="git"');
  expect(panelSource).toContain('<TabsTrigger value="history"');
  expect(panelSource).toContain('<div className="wj-utility-header">');
  expect(panelSource).not.toContain('{compact && <div className="wj-utility-header">');
  expect(panelSource).toContain("onOpenAttention(item)");
  expect(panelSource).toContain("const inboxCount = attention.length");
  expect(panelSource).toContain(">Mark all read</");
  expect(panelSource).toContain("onAcknowledgeAll");
  expect(appSource).toContain('callCore("activity_mark_read", { all: true })');
  expect(panelSource).toContain(">Clear activity</");
  expect(panelSource).toContain(">Clear transcripts</");
  expect(panelSource).toContain("onClearActivity");
  expect(panelSource).toContain("onClearTranscripts");
  expect(panelSource).toContain("if (compact)");
  expect(panelSource).toContain('className="wj-utility-panel"');
  expect(panelSource).toContain('title="Inbox clear"');
  expect(panelSource).toContain('title="Not a Git repository"');
  expect(paritySource).toContain("export function ReviewDrawerSurface");
});

test("orders isolated task setup before spawn and keeps review evidence separate", () => {
  const spawnSource = appSource.slice(
    appSource.indexOf("const spawnAgent"),
    appSource.indexOf("const closePane"),
  );
  expect(spawnSource.indexOf("await ensureOpsTaskLane(opsTask)"))
    .toBeLessThan(spawnSource.indexOf('"agent_structured_spawn"'));
  expect(spawnSource).toContain("cwd: workspace.cwd");

  const laneSource = appSource.slice(
    appSource.indexOf("async function ensureOpsTaskLane"),
    appSource.indexOf("const refreshCoordination"),
  );
  expect(laneSource.indexOf('"git_worktree_create"'))
    .toBeLessThan(laneSource.indexOf("await persistOpsImmediately"));
  expect(laneSource).toContain("cwdStatus.branch !== task.taskLane.branch");

  const resumeSource = appSource.slice(
    appSource.indexOf("const resumeAgent"),
    appSource.indexOf("const savePaneData"),
  );
  expect(resumeSource).toContain("(await ensureOpsTaskLane(task)).cwd");
  expect(resumeSource).toContain("resolveAgentCwd(project.path");
  expect(resumeSource).not.toContain("cwd: project.path");

  const reviewSource = appSource.slice(
    appSource.indexOf("const inspectOpsTask"),
    appSource.indexOf("const reviewOpsTask"),
  );
  expect(appSource.slice(
    appSource.indexOf("const fetchOpsTaskReview"),
    appSource.indexOf("const inspectOpsTask"),
  )).toContain('"git_worktree_review"');
  expect(reviewSource).toContain("fetchOpsTaskReview(currentCard)");
  expect(reviewSource).toContain("setReviewEvidence(");
  expect(reviewSource).not.toContain("setGit(");
  expect(reviewSource).not.toContain("setGitDiff(");
  expect(paritySource).toContain("Start fresh task agent");
  expect(paritySource).toContain("Send fresh reviewer");
  expect(paritySource).toContain("nodes[id]?.title ?? state.agentLabels?.[id]");
  expect(paritySource).toContain("reviewerName(card.reviewerId)");
  expect(paritySource).toContain("reviewerName(inspectedCard.reviewerId)");
  expect(paritySource).not.toContain("Assign shared agent");
  expect(paritySource).toContain("Shared checkout");
  expect(paritySource).toContain("Remove worktree");
  expect(paritySource).toContain("!isTerminalSessionStatus(taskRuntime.status)");
  expect(spawnSource).toContain("opsTaskAgentPrompt");
  expect(spawnSource).toContain("autoCloseTaskAgent: Boolean(opsTask)");
});

test("makes Floor the evidence-only Plan default and combines PRD/TDD under Spec", () => {
  const floorSource = paritySource.slice(
    paritySource.indexOf("function FloorSurface"),
    paritySource.indexOf("function DocumentSurface"),
  );

  expect(appSource).toContain('useState<OpsPage>("floor")');
  expect(appSource).toContain('if (project?.id) setOpsPage("floor")');
  expect(floorSource).toContain("Needs you");
  expect(floorSource).toContain('id="floor-agents-heading">Agents</h2>');
  expect(floorSource).not.toContain("Running now");
  expect(floorSource).toContain("Ready next");
  expect(floorSource).toContain("Recent activity");
  expect(floorSource).toContain("View history");
  expect(floorSource).toContain("No intervention required");
  expect(floorSource).toContain("model.actionQueue");
  expect(floorSource).toContain("Permission requested");
  expect(floorSource).toContain("Response needed");
  expect(floorSource).toContain("Agent stopped");
  expect(floorSource).toContain("Review ready");
  expect(floorSource).toContain("Blocked by dependency");
  expect(floorSource).toContain("Automatic ownership resolution stalled");
  expect(floorSource).toContain('label: "Approve"');
  expect(floorSource).toContain('label: "Deny"');
  expect(floorSource.indexOf('label: "Deny"')).toBeLessThan(floorSource.indexOf('label: "Approve"'));
  expect(floorSource).toContain("Queue direction");
  expect(floorSource).toContain("Stop now");
  expect(floorSource).toContain('className="wj-floor-run-graph" data-collapsed={!runGraphExpanded || undefined}');
  expect(floorSource).toContain('onCollapse={() => setRunGraphExpanded(false)}');
  expect(floorSource).toContain("Show graph");
  expect(floorSource).not.toContain('<details className="wj-floor-run-graph">');
  expect(floorSource).toContain("Auto-start limit");
  expect(floorSource).toContain("Next pickup");
  expect(floorSource).toContain("Auto-start limit reached");
  expect(floorSource).toContain('aria-label="Agent work matrix"');
  expect(floorSource).toContain("Available");
  expect(floorSource).toContain('className="wj-floor-agent-empty"');
  expect(floorSource).toContain('className="wj-floor-panel wj-floor-docked-inspector"');
  expect(floorSource).toContain('aria-label="Resize floor side rail"');
  expect(floorSource).toContain("{dockedInspector ?? <>");
  expect(floorSource).toContain("Claimed files");
  expect(floorSource).toContain("Latest directive");
  expect(floorSource).toContain("Full details");
  expect(floorSource).toContain("humanizeFloorAttentionDetail");
  expect(floorSource).toContain("recentActivity.slice(0, 5)");
  expect(appSource).toContain('setHistoryPage("activity")');
  expect(appSource).toContain('selectUtilityPanel("history")');
  expect(floorSource).not.toContain("floorNeedsHeight");
  expect(floorSource).not.toContain("ResizeObserver");
  expect(floorSource).not.toContain("wj-floor-main-resizer");
  expect(floorSource).not.toContain("Agent timeline");
  expect(floorSource).not.toMatch(/>Cost<|>ETA<|Utilization|Will ask soon|Predicted request/i);
  expect(paritySource).toContain('aria-label="Specification documents"');
  expect(paritySource).toContain('<TabsTrigger value="prd">Requirements</TabsTrigger>');
  expect(paritySource).toContain('<TabsTrigger value="tdd">Technical design</TabsTrigger>');
  expect(paritySource).toContain("Stored separately as PRD.md and TDD.md");
  expect(paritySource).toContain('useState<OpsRunGraphRange>("40m")');
  expect(stylesSource).toContain(".wj-run-graph-plot { position: relative; min-width: 720px;");
  expect(stylesSource).toContain(".wj-run-graph-scroll { max-height: 220px; overflow: auto;");
  expect(stylesSource).toContain(".wj-floor-run-graph .wj-run-graph-scroll { height: var(--wj-run-graph-height); max-height: none;");
  expect(stylesSource).toContain('.wj-run-graph :is(path, button) { animation: none !important; transition: none !important; }');
  expect(stylesSource).toContain(".wj-floor { display: grid;");
  expect(stylesSource).toContain("@container workspace (max-width: 820px)");
  expect(stylesSource).toContain(".wj-floor { display: block; overflow: auto;");
  expect(stylesSource).toContain('.wj-floor-rail[data-inspecting="true"]');
  expect(stylesSource).toContain("var(--wj-floor-rail-width, 420px)");
  expect(stylesSource).toContain(".wj-floor-resizer { display: none; }");
  expect(stylesSource).not.toContain("wj-floor-main-resizer");
  expect(stylesSource).not.toContain("--wj-floor-needs-height");
});

test("keeps document policy notices inline and separates durable saves from projections", () => {
  const refreshDocumentsSource = appSource.slice(
    appSource.indexOf("const refreshProjectDocuments"),
    appSource.indexOf("const refreshProjectData"),
  );
  const persistenceSource = appSource.slice(
    appSource.indexOf("const syncOpsProjections"),
    appSource.indexOf("const queueOpsSave"),
  );

  expect(refreshDocumentsSource).not.toContain("setError(warnings.join");
  expect(persistenceSource).toContain("const queueOpsProjection");
  expect(persistenceSource).toContain("Could not save task state:");
  expect(persistenceSource).toContain("() => undefined");
  expect(persistenceSource).toContain("pending.then(() => projected)");
});

test("uses the card workspace bar as the full-width drag target", () => {
  expect(paritySource).toContain('className="wj-task-card-bar"');
  expect(paritySource).toContain('className="wj-task-drag-rail"');
  expect(paritySource).not.toContain("data-drop-agent-id");
  expect(stylesSource).toContain(".wj-task-card-bar[data-draggable=\"true\"]");
  expect(stylesSource).toContain(".wj-task-drag-rail::before, .wj-task-drag-rail::after");
  expect(stylesSource).toContain("grid-template-columns: minmax(12px, 1fr) auto minmax(12px, 1fr)");
  expect(stylesSource).not.toMatch(/\.wj-task-card-bar \{[^}]*border-bottom:/);
  expect(stylesSource).toContain(".wj-board-list .wj-task-card-bar { grid-column: 1 / -1;");
  expect(stylesSource).toMatch(/\.wj-task-actions \{[^}]*align-items: center/);
});

test("renders focused task descriptions as safe Markdown", () => {
  const inspectorSource = paritySource.slice(
    paritySource.indexOf('<Sheet open={Boolean(inspectedCard)}'),
    paritySource.indexOf("</Sheet>", paritySource.indexOf('<Sheet open={Boolean(inspectedCard)}')),
  );
  expect(inspectorSource).toContain('<SheetDescription asChild>');
  expect(inspectorSource).toContain('<Markdown skipHtml');
  expect(inspectorSource).toContain('target="_blank" rel="noreferrer"');
  expect(stylesSource).toContain(".agent-prose ul { list-style: disc; }");
  expect(stylesSource).toContain(".agent-prose ol { list-style: decimal; }");
});

test("uses one shared attention model and routes each item to its exact target", () => {
  expect(appSource).toContain("const attentionItems = useMemo(() => deriveAttention");
  expect(appSource).toContain("inboxCount={attentionItems.length}");
  expect(appSource).toContain("attention={attentionItems}");
  expect(appSource).toContain("if (target.kind === \"pane\")");
  expect(appSource).toContain("candidate.id === target.sessionId");
  expect(appSource).toContain("await navigateProject(owner, \"terminal\", target.nodeId)");
  expect(appSource).toContain("candidate.nodes.some((node) => node.id === targetNodeId)");
  expect(appSource).toContain("if (target.kind === \"review\") inspectOpsTask(card)");
  expect(appSource).toContain("else setInspectedOpsCardId(card.id)");
});

test("preserves chat layout and motion styling", () => {
  const effortStyles = stylesSource.slice(
    stylesSource.indexOf('.chat-model-trigger[data-effort="max"]'),
    stylesSource.indexOf(".chat-model-actions > small"),
  );

  expect(stylesSource).toContain('background: #1f1f1f url("/favicon.svg") center / 50px auto no-repeat;');
  expect(stylesSource).toContain('.chat-file-mentions { position: absolute;');
  expect(shortcutsSource).toContain('{ id: "agent.send", label: "Send agent prompt", group: "Agents", defaultBinding: "Enter" }');
  expect(stylesSource).toContain("@keyframes wheeljack-dial-snap-a");
  expect(stylesSource).toContain("@keyframes wheeljack-dial-max-a");
  expect(stylesSource).toContain("@keyframes wheeljack-dial-max-idle");
  expect(stylesSource).toContain('@keyframes wheeljack-max-shader');
  expect(stylesSource).toContain('@keyframes wheeljack-ultra-shader');
  expect(stylesSource).toContain('@keyframes wheeljack-rim-shader');
  expect(stylesSource).toContain('@keyframes wheeljack-rim-shader { from { background-position: 100% 0; } to { background-position: 0 0; } }');
  expect(stylesSource).toContain('background-size: 400% 100%');
  expect(stylesSource).not.toMatch(/animation: wheeljack-(?:rim|max|ultra)-shader [^;]* linear/);
  expect(stylesSource).not.toMatch(/animation: wheeljack-ultra-flow [^;]* linear/);
  expect(effortStyles).toContain("var(--primary)");
  expect(effortStyles).not.toContain("var(--warning)");
  expect(effortStyles).not.toMatch(/#(?:38bdf8|c084fc|f472b6|60a5fa|a78bfa|7dd3fc)/i);
  expect(stylesSource).toContain('.chat-access-trigger[data-access="full"] .sargam-icon { color: var(--warning); }');
  expect(stylesSource).toContain('.chat-effort-dial[data-effort="ultra"]::before');
  expect(stylesSource).toContain('.chat-model-trigger[data-effort="max"]::before');
  expect(stylesSource).toContain('.chat-model-trigger[data-effort="ultra"]::before');
  expect(stylesSource).toContain('.chat-model-trigger > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }');
  expect(stylesSource).toContain('left: clamp(32px, var(--effort-position), calc(100% - 32px))');
  expect(stylesSource).toContain('.chat-effort-dial [data-slot="slider-track"] { height: 8px;');
  expect(stylesSource).toContain("@keyframes wheeljack-ultra-charge-a");
  expect(stylesSource).toContain("@keyframes wheeljack-ultra-core-a");
  expect(stylesSource).toContain("@keyframes wheeljack-ultra-ring-a");
  expect(stylesSource).toContain("@keyframes wheeljack-ultra-flow");
  expect(stylesSource).toContain('.chat-model-list > button[data-active="true"]');
  expect(stylesSource).toContain('.chat-composer[data-drag-active="true"]');
  expect(stylesSource).toContain(':has(> [data-slot="slider-thumb"])');
  expect(messageScrollerSource).toContain('from "@shadcn/react/message-scroller"');
  expect(stylesSource).toContain("@keyframes agent-message-in");
  expect(stylesSource).toContain("@keyframes agent-tool-live");
  expect(stylesSource).toContain("@keyframes agent-fade-in { from { opacity: 0; } }");
  expect(stylesSource).toContain("animation: agent-tool-live 1.8s var(--wj-ease-in-out) infinite");
  expect(stylesSource).toContain("animation: agent-fade-in 120ms var(--wj-ease-out) both !important");
  expect(stylesSource).toContain('.tool-collapsible[data-open="true"] { grid-template-rows: 1fr; opacity: 1; }');
  expect(stylesSource).toContain('animation: agent-message-in 200ms var(--wj-ease-out) both');
  expect(stylesSource).not.toContain('.message.user[data-current="true"]');
  expect(stylesSource).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.tool-summary-status\[data-running="true"\]::before \{ animation: none !important/);
});

test("keeps composer controls inside narrow agent panes", () => {
  expect(stylesSource).toMatch(/\.chat-composer-controls \{[^}]*flex: 1 1 auto/);
  expect(stylesSource).toMatch(/\.chat-model-trigger \{[^}]*min-width: 0[^}]*max-width: 190px[^}]*flex: 0 1 auto/);
});

test("streams current turns while settling stale carets after completion", () => {
  const messages = [{ id: "answer", role: "assistant", kind: "message", text: "Done", streaming: true }];

  expect(messagesForAgentStatus(messages, "running")).toBe(messages);
  expect(messagesForAgentStatus(messages, "completed")[0].streaming).toBe(false);
  const overlapping = [
    { id: "old-answer", role: "assistant", kind: "message", text: "First", streaming: true },
    { id: "tool", role: "system", kind: "tool", text: "Working", streaming: true },
    { id: "latest-answer", role: "assistant", kind: "message", text: "Latest", streaming: true },
  ];
  expect(messagesForAgentStatus(overlapping, "running").map((message) => message.streaming)).toEqual([false, true, true]);
  expect(messagesForAgentStatus(overlapping.slice(0, 2), "running").map((message) => message.streaming)).toEqual([false, true]);
  expect(overlapping[0].streaming).toBe(true);

  const parseSource = appSource.slice(
    appSource.indexOf("const scheduleStructuredParse"),
    appSource.indexOf("const handleCoreEvent"),
  );
  expect(parseSource).toContain("pendingParsesRef.current[sessionId] = { runtime, lines }");
  expect(parseSource).toContain("if (parseTimersRef.current[sessionId] !== undefined) return");
  expect(parseSource).toContain("parseVersionsRef.current[sessionId] !== version");
  expect(parseSource).toContain("protocolSequence ?? 0");
  expect(parseSource).not.toContain("window.clearTimeout");
});

test("keeps startup status monotonic", () => {
  expect(stylesSource).toContain('.message.tool { max-width: 100%; margin-bottom: 3px;');
  expect(stylesSource).toContain('.message.tool[data-live="true"] { border: 1px solid');
  expect(stylesSource).not.toContain('.message.tool:not([data-live="true"]) { border:');
  const structuredLineSource = appSource.slice(
    appSource.indexOf('envelope.event === "agent:protocol-update"'),
    appSource.indexOf('envelope.event === "terminal:title"'),
  );
  expect(structuredLineSource).not.toContain("status:");
  expect(structuredLineSource).toContain("runtimeInstanceId");
  expect(structuredLineSource).toContain("protocolSequence");
  expect(appSource).toContain("data-protocol-updates={metricSummary.protocolUpdates}");
  expect(structuredLineSource).not.toContain("scheduleStructuredParse");
  expect(structuredLineSource).toContain(".catch((cause) => setError(message(cause)))");
  expect(appSource).toContain('live.status === "running" && ["needs_input", "canceling", "failed", "completed", "canceled"].includes(runtime.status)');

  const startupIdle = {
    events: [{ type: "turn_done", sequence: 2 }],
    messages: [],
    active: false,
  };
  expect(agentParseStatus(startupIdle, [], "running", 0)).toBe("running");
  expect(agentParseStatus({
    ...startupIdle,
    events: [...startupIdle.events, { type: "turn_started", sequence: 3 }],
    active: true,
  }, [], "running", 0)).toBe("running");
  expect(agentParseStatus({
    ...startupIdle,
    events: [...startupIdle.events, { type: "turn_started", sequence: 3 }, { type: "turn_done", sequence: 4 }],
  }, [], "running", 0)).toBe("completed");
  expect(agentParseStatus(startupIdle, [{
    id: "tool-only",
    role: "system",
    kind: "tool",
    text: "Tool output",
  }], "running", 0)).toBe("completed");
  expect(agentParseStatus({
    ...startupIdle,
    events: [{ type: "turn_started", sequence: 1 }, { type: "turn_done", sequence: 2 }],
  }, [], "running", 3)).toBe("running");
});

test("uses one landmark per surface and gates smoke diagnostics through the core", () => {
  expect(appSource).toMatch(/<div\r?\n\s+className="wj-app-shell"/);
  expect(appSource).toContain('aria-labelledby="terminal-surface-heading"');
  expect(paritySource).toContain('aria-labelledby="home-surface-heading"');
  expect(paritySource).toContain('aria-labelledby="ops-surface-heading"');
  expect(paritySource).toContain('aria-labelledby="settings-page-heading"');
  expect(appSource).toContain("uiSmokeEnabled().then(setSmokeDiagnostics)");
  expect(appSource).toContain("(import.meta.env.DEV || smokeDiagnostics)");
  expect(appSource).toContain('document.querySelector("div.wj-app-shell")');
});

test("shows build, updater, and storage settings", () => {
  const settingsSource = paritySource.slice(
    paritySource.indexOf("export function SettingsSurface"),
    paritySource.indexOf("export function UtilityPanelSurface"),
  );

  expect(settingsSource).toContain('SettingsCard title="Build"');
  expect(settingsSource).toContain("Core version");
  expect(settingsSource).toContain("Platform");
  expect(settingsSource).toContain('SettingsCard');
  expect(settingsSource).toContain('title="Updates"');
  expect(settingsSource).toContain("Check now");
  expect(settingsSource).toContain("Restart to install");
  expect(settingsSource).toContain("Automatically check for updates");
  expect(settingsSource).toContain("Automatically download updates");
  expect(settingsSource).toContain("<UpdateProgressView updater={updater}");
  expect(settingsSource).toContain('role="alert"');
  expect(settingsSource).toContain('SettingsCard title="Storage"');
  expect(settingsSource).toContain("Copy path");
  expect(settingsSource).toContain("Export backup");
  expect(settingsSource).toContain("Copy diagnostics");
  expect(appSource).toContain('callCore("state_backup_export"');
  expect(settingsSource).toContain("disabled={resettingPreferences}");
  expect(settingsSource).toContain('role="status"');
  expect(settingsSource).toContain("const approvalPolicies = selectedAdapter?.supportedApprovalPolicies ?? []");
  expect(settingsSource).toContain('<SelectTrigger aria-label="Approval policy">');
  expect(appSource).toContain('envelope.event === "updater:progress"');
  expect(appSource).toContain("await flushPendingSavesRef.current()");
  expect(appSource).toContain("Install unsigned wheeljack update?");
  expect(paritySource).toContain("data-updater-status={updater.status}");
});

test("exits the desktop host explicitly after flushing local state", () => {
  const closeSource = tauriSource.slice(
    tauriSource.indexOf("fn close_after_flush"),
    tauriSource.indexOf("fn open_devtools"),
  );
  expect(closeSource).toContain("app.exit(0)");
  expect(closeSource).not.toContain(".destroy()");
});

test("keeps distinct icons when terminal toolbar labels collapse", () => {
  expect(appSource).toContain("<Plus /><span>New pane</span>");
  expect(appSource).toContain("<ProviderMark adapterId={selectedAdapterId} /><span>Agent</span>");
  expect(paritySource).toContain('<Terminal /><span className="wj-mode-label">Work</span></Button>');
  expect(paritySource).toContain('<LayoutDashboard /><span className="wj-mode-label">Plan</span></Button>');
});

test("separates activity and searchable session recall", () => {
  const panelSource = paritySource.slice(
    paritySource.indexOf("export function UtilityPanelSurface"),
    paritySource.indexOf("export function TranscriptDrawerSurface"),
  );

  expect(panelSource).toContain('<TabsTrigger value="activity">Activity</TabsTrigger>');
  expect(panelSource).toContain('<TabsTrigger value="sessions">Sessions</TabsTrigger>');
  expect(panelSource).toContain('<TabsContent value="activity"');
  expect(panelSource).toContain('<TabsContent value="sessions"');
  expect(tabsSource).toContain('data-[orientation=horizontal]:flex-col');
  expect(panelSource).toContain("submittedSessionQuery");
  expect(panelSource).toContain('aria-label="Search session transcripts"');
  expect(panelSource).toContain("data-session-id={sessionId}");
  expect(appSource).toContain('callCore<SessionSearchResult[]>("session_search"');
  expect(appSource).toContain('callCore<SessionTranscriptPage>("session_transcript_page"');
  expect(appSource).toContain('callCore("session_clear_transcripts"');
  expect(appSource).toContain("if (isLiveSessionStatus(item.status))");
  expect(paritySource).toContain("export function TranscriptDrawerSurface");
});

test("exposes canvas CRUD and restores the last canvas per project", () => {
  expect(nextCanvasName([{ name: "Canvas 1" }, { name: "Canvas 3" }])).toBe("Canvas 2");
  expect(appSource).toContain('<TabsList aria-label="Canvases">');
  expect(appSource).toContain('aria-label={`Open canvas ${item.name}`}');
  expect(appSource).toContain('aria-label="New canvas"');
  expect(appSource).toContain('aria-label={`Canvas actions for ${item.name}`}');
  expect(appSource).toContain('className={`wj-canvas-tab${item.id === canvas?.id ? " active" : ""}`}');
  expect(appSource).toContain("if (item.id !== canvasRef.current?.id) await activateCanvas(item)");
  expect(appSource).toContain("open={canvasMenuId === item.id}");
  expect(appSource).toContain('callCore<Canvas>("canvas_get"');
  expect(appSource).toContain('callCore<Canvas>("canvas_create_project"');
  expect(appSource).toContain('callCore<Canvas>("canvas_rename"');
  expect(appSource).toContain('callCore("canvas_delete"');
  expect(appSource).toContain("canvases.length <= 1");
  expect(appSource).toContain("Close every runtime pane");
  expect(appSource).toContain("preferencesRef.current.lastCanvasByProject[nextProject.id]");
  expect(appSource).toContain('callCore<Canvas[]>("canvas_list_project", { projectId: nextProject.id })');
});

test("offers every persisted pane type from New pane", () => {
  expect(appSource).toContain('aria-label="New pane"');
  expect(appSource).toContain("Shell split right");
  expect(appSource).toContain("Shell split down");
  expect(appSource).toContain('spawnDataPane("markdown_note")');
  expect(appSource).toContain('spawnDataPane("task_checklist")');
  expect(appSource).toContain('spawnDataPane("browser_preview")');
  expect(workspaceRuntimeSource).toContain('aria-label="New checklist item"');
  expect(workspaceRuntimeSource).toContain("key={pane.id}");
  expect(workspaceRuntimeSource).toContain("Mark ${item.label");
});

test("classifies live sessions and exposes project document save state", () => {
  expect(isLiveSessionStatus("running")).toBe(true);
  expect(isLiveSessionStatus("needs_input")).toBe(true);
  expect(isLiveSessionStatus("completed")).toBe(false);
  expect(isTerminalSessionStatus("failed")).toBe(true);
  expect(isTerminalSessionStatus("canceled")).toBe(true);
  expect(isTerminalSessionStatus("running")).toBe(false);
  expect(paritySource).toContain("data-save-state={saveStatus}");
  expect(paritySource).toContain('role="status" aria-live="polite"');
  expect(appSource).toContain('setDocumentSaveStatus("saving")');
  expect(appSource).toContain('setDocumentSaveStatus("saved")');
  expect(appSource).toContain('setDocumentSaveStatus("conflict")');
  expect(appSource).toContain('setDocumentSaveStatus("error")');
  expect(appSource).toContain("projectDocumentRevisions(disk) !== projectDocumentRevisions(documents)");
  expect(appSource).toContain("activeOpsNode?: CanvasNode");
});

test("makes terminal workspaces agent-first without changing shell panes", () => {
  const terminalSource = appSource.slice(
    appSource.indexOf('{surface === "terminal"'),
    appSource.indexOf('{surface === "ops"'),
  );

  expect(terminalSource.indexOf(">Start agent</Button>")).toBeLessThan(terminalSource.indexOf(">Create shell</Button>"));
  expect(terminalSource).not.toContain("wj-terminal-attention-strip");
  expect(terminalSource).toContain("terminalRailAgents.map");
  expect(terminalSource).toContain("wj-agent-attention-count");
  expect(terminalSource).toContain("<ProjectEmptyState");
  expect(terminalSource).toContain("preferences.showAgentRail && <aside");
  expect(terminalSource).not.toContain("preferences.showAgentRail && terminalAgents.length > 0");
  expect(appSource).toContain("runtime?.structured");
  expect(workspaceRuntimeSource).toContain('data-agent-present={runtime?.structured || undefined}');
  expect(workspaceRuntimeSource).toContain("onOpenOpsCard(agentContext.card)");
  expect(appSource).toContain("inspectedCardId={inspectedOpsCardId}");
  expect(paritySource).not.toContain("const [inspectedCardId, setInspectedCardId]");
});

test("keeps project creation by Projects and removes the duplicate agent action", () => {
  const sidebarSource = paritySource.slice(
    paritySource.indexOf("export function ProjectSidebar"),
    paritySource.indexOf("function SidebarButton"),
  );

  expect(sidebarSource).toContain('aria-label="Open folder"');
  expect(sidebarSource).toContain("<TooltipContent>Open folder</TooltipContent>");
  expect(sidebarSource).not.toContain('label="New agent"');
  expect(sidebarSource).toContain('className={`wj-sidebar-project${active ? " selected" : ""}`}');
  expect(sidebarSource).not.toContain("wj-sidebar-children");
});

test("sending from a disconnected chat resumes and submits in one action", () => {
  const spawnSource = appSource.slice(
    appSource.indexOf("const spawnAgent"),
    appSource.indexOf("const saveBot"),
  );
  const sendSource = appSource.slice(
    appSource.indexOf("const sendAgentPrompt"),
    appSource.indexOf("const prepareAgentHandoff"),
  );
  const resumeSource = appSource.slice(
    appSource.indexOf("const resumeAgent"),
    appSource.indexOf("const savePaneData"),
  );

  expect(sendSource).toContain('runtime.status === "disconnected"');
  expect(sendSource).toContain("return resumeAgent(runtime, prompt, displayPrompt, images)");
  expect(spawnSource).toContain("const launchPrompt = taskPrompt.trim()");
  expect(spawnSource).toContain("? botStandingPrompt(taskPrompt, bot?.snapshot)");
  expect(sendSource).toContain("provider: profile.provider, model: profile.model, thinking: profile.thinking");
  expect(sendSource).toContain("messages: mergeAgentMessages(current[runtime.nodeId].messages, [userMessage])");
  expect(resumeSource).toContain("resumeSessionId: priorSessionId");
  expect(resumeSource).toContain("prompt: effectivePrompt");
  expect(resumeSource).toContain("botStandingPrompt(submittedPrompt, snapshot)");
  expect(resumeSource).toContain("Resume wheeljack task ${task.id}: ${task.title}");
  expect(resumeSource).toContain("card.reviewerId === runtime.nodeId");
  expect(resumeSource).not.toContain("slice(-8000)");
  expect(resumeSource).toContain("chatPreview:");
  expect(resumeSource).not.toContain("chatMessages:");
  expect(resumeSource).toContain("return true");
});

test("keeps project navigation flat and preserves project activation", () => {
  const sidebarSource = paritySource.slice(
    paritySource.indexOf("export function ProjectSidebar"),
    paritySource.indexOf("function SidebarButton"),
  );

  expect(sidebarSource).toContain('const active = selected && (surface === "terminal" || surface === "ops")');
  expect(sidebarSource).toContain("active={active}");
  expect(sidebarSource).not.toContain("expandedProjectIds");
  expect(sidebarSource).not.toContain("aria-expanded");
  expect(sidebarSource).toContain('item.pathExists === false ? "Folder missing"');
  expect(sidebarSource).toContain("item.pathExists === false ? onRelink(item)");
  expect(sidebarSource).toContain("itemLoading ? <DotMatrixLoader");
  expect(sidebarSource).toContain(": <ProjectGlyph icon={item.icon} color={item.iconColor} />");
  expect(sidebarSource).toContain('onProject(item, "terminal")');
  expect(paritySource).toContain('<Terminal />Open Work</Item>');
  expect(paritySource).toContain('<LayoutDashboard />Open Plan</Item>');
  expect(sidebarSource).not.toContain("trailing=");
});

test("blocks project navigation while startup or project activation is loading", () => {
  const sidebarSource = paritySource.slice(
    paritySource.indexOf("export function ProjectSidebar"),
    paritySource.indexOf("function SidebarButton"),
  );
  const homeSource = paritySource.slice(
    paritySource.indexOf("export function HomeSurface"),
    paritySource.indexOf("export function OnboardingSurface"),
  );

  expect(appSource).toContain("if (!startupReady || activatingProjectIdRef.current) return;");
  expect(appSource).toContain("loading={!startupReady || Boolean(activatingProjectId)}");
  expect(sidebarSource).toContain("disabled={loading}");
  expect(sidebarSource).toContain('detail={itemLoading ? "Loading…"');
  expect(sidebarSource).toContain('icon={itemLoading ? <DotMatrixLoader size={14} />');
  expect(sidebarSource).toContain('data-disabled={loading || undefined}');
  expect(appSource).toContain("loadingProjectId={activatingProjectId}");
  expect(homeSource).toContain("const itemLoading = item.id === loadingProjectId");
  expect(homeSource).toContain('itemLoading ? <DotMatrixLoader size={16}');
  expect(homeSource).toContain("Loading workspace…");
  expect(homeSource).toContain("disabled={loading}");
  expect(stylesSource).toContain(".wj-nav-item:not(:disabled):hover");
  expect(stylesSource).toContain('.wj-sidebar-project[data-disabled="true"] { pointer-events: none; }');
  expect(stylesSource).toContain('.wj-project-row[data-disabled="true"] { pointer-events: none; }');
});

test("waits for project activation before the native smoke opens a shell", () => {
  const activationReady = appSource.indexOf('button.wj-nav-item[aria-label="Smoke recovery"]:not(:disabled)');
  const shellShortcut = appSource.indexOf('window.dispatchEvent(new KeyboardEvent("keydown"', activationReady);

  expect(activationReady).toBeGreaterThan(-1);
  expect(shellShortcut).toBeGreaterThan(activationReady);
});

test("keeps the native terminal smoke independent from presentational run badges", () => {
  const smokeSource = appSource.slice(
    appSource.indexOf("const terminalReady = await waitForUi"),
    appSource.indexOf("const recoveredSessions ="),
  );
  const paneSource = workspaceRuntimeSource.slice(workspaceRuntimeSource.indexOf("function Pane({"), workspaceRuntimeSource.indexOf("function DataPane"));

  expect(paneSource).toContain("data-runtime-status={runtime?.status}");
  expect(smokeSource).toContain('node.getAttribute("data-runtime-status") === "running"');
  expect(smokeSource).not.toContain('node.querySelector(".pane-status.running")');
});

test("persists sidebar visibility while tolerating legacy disclosure preferences", () => {
  expect(appSource).toContain("const sidebarIsCollapsed = preferences.sidebarCollapsed || compactWindow");
  expect(appSource).toContain("updatePreferences({ sidebarCollapsed })");
  expect(appSource).not.toContain("expandedProjectIds={preferences.expandedProjectIds}");
  expect(appSource).toContain("const expandedProjectIds = Array.isArray(source.expandedProjectIds)");
});

test("only offers a real attached terminal and never renders structured protocol text as one", () => {
  expect(supportsAttachedTerminal({ structured: true, protocol: "opencode-sse" })).toBe(true);
  expect(supportsAttachedTerminal({ structured: true, protocol: "codex-app-server" })).toBe(false);
  expect(supportsAttachedTerminal({ structured: false, protocol: "opencode-sse" })).toBe(false);
  expect(supportsAttachedTerminal({
    structured: true,
    protocol: "custom",
    capabilities: { cancel: false, interact: false, resume: false, attachedTerminal: true },
  })).toBe(true);
  const paneSource = workspaceRuntimeSource.slice(workspaceRuntimeSource.indexOf("function Pane({"), workspaceRuntimeSource.indexOf("function DataPane"));
  expect(paneSource).toContain("chatView || !runtime.terminalSessionId");
  expect(paneSource).toContain('fallbackText="Connecting to OpenCode terminal');
  expect(paneSource).not.toContain("runtime?.structured && chatView ?");
});

test("activates Plan only for meaningful state, existing documents, or explicit entry", () => {
  const empty = defaultOpsState();
  expect(hasMeaningfulPlanState(empty)).toBe(false);
  expect(hasMeaningfulPlanState(parseOpsState({ version: 2, cards: [] }))).toBe(false);
  expect(hasMeaningfulPlanState(parseOpsState({
    version: 2,
    cards: [{ id: "task", title: "Task", columnId: "queued" }],
  }))).toBe(true);
  expect(hasMeaningfulPlanState({ ...empty, prd: "# Product" })).toBe(true);
  expect(hasMeaningfulPlanState({
    ...empty,
    columns: [{ id: "ideas", title: "Ideas", role: "queued" }],
  })).toBe(true);
  expect(hasProjectPlanDocuments()).toBe(false);
  expect(hasProjectPlanDocuments({
    projectPath: "C:\\repo",
    documents: {
      kanban: { kind: "kanban", path: "", exists: false, content: "", revision: "missing", format: "missing", warnings: [] },
      prd: { kind: "prd", path: "C:\\repo\\PRD.md", exists: true, content: "", revision: "empty", format: "markdown", warnings: [] },
      tdd: { kind: "tdd", path: "", exists: false, content: "", revision: "missing", format: "missing", warnings: [] },
    },
  })).toBe(true);

  expect(appSource).toContain("planActiveCanvasIdsRef.current.has(activeCanvas.id)");
  expect(appSource).toContain('if (nextSurface === "ops") activatePlan()');
  expect(appSource).toContain("if (!project?.path || !planActive) return");
  expect(appSource).toContain("activeCanvas && activeProject && planActiveCanvasIdsRef.current.has(activeCanvas.id)");
  expect(appSource).toContain("hasProjectPlanDocuments(next)");
});

test("runs explicit task verification through PTY history and revalidates approval", () => {
  const verificationSource = appSource.slice(
    appSource.indexOf("const finishOpsVerification"),
    appSource.indexOf("const inspectOpsTask"),
  );
  expect(verificationSource).toContain('shellCommand: command');
  expect(verificationSource).toContain('adapterId: "generic-shell"');
  expect(verificationSource).toContain('callCore("session_kill"');
  const cancelVerificationSource = verificationSource.slice(
    verificationSource.indexOf("const cancelOpsVerification"),
    verificationSource.indexOf("const viewOpsVerificationOutput"),
  );
  expect(cancelVerificationSource.indexOf("persistOpsImmediately")).toBeLessThan(cancelVerificationSource.indexOf('callCore("session_kill"'));
  expect(verificationSource).toContain('callCore<SessionTranscriptPage>("session_transcript_page"');
  expect(verificationSource).toContain("pendingVerificationExitsRef.current");
  expect(verificationSource).toContain("automaticVerificationKeysRef.current");
  expect(verificationSource).toContain("void runOpsVerification(candidate)");
  expect(verificationSource).toContain('card.reviewPolicy === "agent"');
  expect(verificationSource).toContain("void startReviewerForOpsTask(candidate)");
  expect(appSource).toContain("verificationSessionIdsRef.current.has(sessionId) || verificationSpawnCountRef.current > 0");
  const persistenceSource = appSource.slice(
    appSource.indexOf("const captureVerificationPersistence"),
    appSource.indexOf("const finishOpsVerification"),
  );
  expect(persistenceSource).toContain("activeCanvas.projectId !== activeProject.id");
  expect(persistenceSource).toContain("canvasRef.current?.id !== persistence.canvas.id");
  expect(persistenceSource).toContain("projectRef.current?.id !== persistence.project.id");
  expect(persistenceSource).not.toContain("persistence.state");
  expect(appSource).toContain("opsState.cards.find((card) => card.id === current.id)");
  const approvalSource = appSource.slice(appSource.indexOf("const reviewOpsTask"), appSource.indexOf("const previewReviewChanges"));
  expect(approvalSource).toContain("await ensureOpsTaskLane(currentCard)");
  expect(approvalSource).toContain("await fetchOpsTaskReview(validatedCard)");
  expect(paritySource).toContain("Run verification");
  expect(paritySource).toContain("Cancel verification");
  expect(paritySource).toContain("View verification output");
  expect(paritySource).toContain("Approve verification");
  expect(paritySource).toContain("Verification stale");
  expect(paritySource).toContain("Save contract");
  expect(paritySource).toContain("approval.reason");
  expect(appSource).toContain("REVIEW VERDICT: APPROVE");
  expect(appSource).toContain(
    'opsVerificationApproval(latestCandidate.card, latestCandidate.hasFileConflict, result.snapshotId, "agent")',
  );
  expect(appSource).toContain("opsNextAutomaticApprovalCandidate");
  expect(appSource).toContain("persistOpsImmediately((current) =>");
  expect(appSource).not.toContain("automaticApprovalKeysRef");
});

test("preserves live verification across canvases and interrupts missing sessions after restart", () => {
  const state = parseOpsState({
    version: 2,
    cards: [{
      id: "task-verify",
      title: "Verify",
      verificationRun: {
        sessionId: "session-1",
        command: "bun run test",
        worktreePath: "C:\\repo-task",
        cwd: "C:\\repo-task",
        baseCommit: "base",
        status: "running",
        startedAt: "2026-08-03T10:00:00Z",
      },
    }, {
      id: "task-failed",
      title: "Failed",
      verificationRun: {
        sessionId: "session-2",
        command: "bun run test",
        worktreePath: "C:\\repo-task",
        cwd: "C:\\repo-task",
        baseCommit: "base",
        status: "failed",
        startedAt: "2026-08-03T10:00:00Z",
        endedAt: "2026-08-03T10:01:00Z",
        exitCode: 1,
      },
    }, {
      id: "task-passed",
      title: "Passed",
      verificationRun: {
        sessionId: "session-3",
        command: "bun run test",
        worktreePath: "C:\\repo-task",
        cwd: "C:\\repo-task",
        baseCommit: "base",
        status: "passed",
        startedAt: "2026-08-03T10:00:00Z",
        endedAt: "2026-08-03T10:01:00Z",
        exitCode: 0,
        snapshotId: "snapshot",
      },
    }, {
      id: "task-canceled",
      title: "Canceled",
      verificationRun: {
        sessionId: "session-4",
        command: "bun run test",
        worktreePath: "C:\\repo-task",
        cwd: "C:\\repo-task",
        baseCommit: "base",
        status: "canceled",
        startedAt: "2026-08-03T10:00:00Z",
        endedAt: "2026-08-03T10:01:00Z",
      },
    }],
  });

  expect(state.cards[0].verificationRun).toMatchObject({
    sessionId: "session-1",
    status: "running",
  });
  expect(state.cards[0].verificationRun?.endedAt).toBeUndefined();
  expect(state.cards[1].verificationRun).toMatchObject({ status: "failed", exitCode: 1 });
  expect(state.cards[2].verificationRun).toMatchObject({ status: "passed", exitCode: 0, snapshotId: "snapshot" });
  expect(state.cards[3].verificationRun).toMatchObject({ status: "canceled" });

  const switchedAwayAndBack = recoverOpsVerificationRuns(state, new Set(["session-1"]), new Set());
  expect(switchedAwayAndBack.cards[0].verificationRun?.status).toBe("running");
  const exitedWhileInactive = recoverOpsVerificationRuns(state, new Set(), new Set(["session-1"]));
  expect(exitedWhileInactive.cards[0].verificationRun?.status).toBe("running");
  const restartedAfterInactiveExit = recoverOpsVerificationRuns(
    exitedWhileInactive,
    new Set(),
    new Set(),
    "2026-08-03T10:02:00Z",
  );
  expect(restartedAfterInactiveExit.cards[0].verificationRun).toMatchObject({
    status: "interrupted",
    endedAt: "2026-08-03T10:02:00Z",
    message: "Verification was interrupted when wheeljack restarted.",
  });
  const activationSource = appSource.slice(
    appSource.indexOf("const activateCanvas"),
    appSource.indexOf("const refreshProjectData"),
  );
  expect(activationSource).toContain('callCore<Record<string, { status: string; exitCode?: number }>>("session_statuses"');
  expect(activationSource).toContain("const recoveredVerification =");
  expect(activationSource).toContain("await persistOpsQueued(nextOps, nextCanvas");
  expect(activationSource).toContain("pendingVerificationExitsRef.current.delete(run.sessionId)");
  expect(activationSource).toContain("verificationExitHandlerRef.current?.(");

  const merged = mergeProjectDocuments(state, {
    projectPath: "C:\\repo",
    documents: {
      kanban: {
        kind: "kanban",
        path: "C:\\repo\\KANBAN.md",
        exists: true,
        content: "",
        revision: "one",
        format: "wheeljack-v1",
        warnings: [],
        board: { version: 1, columns: state.columns, cards: [{ id: "task-verify", columnId: "queued", title: "Verify", detail: "", assignee: "Unassigned", priority: "normal" }] },
      },
      prd: { kind: "prd", path: "", exists: false, content: "", revision: "", format: "missing", warnings: [] },
      tdd: { kind: "tdd", path: "", exists: false, content: "", revision: "", format: "missing", warnings: [] },
    },
  });
  expect(merged.cards[0].verificationRun).toEqual(state.cards[0].verificationRun);
});

test("resolves task and persisted workspaces without falling back from a closed lane", () => {
  const lane = {
    kind: "git-worktree" as const,
    worktreePath: "C:\\repo-task",
    cwd: "C:\\repo-task\\app",
    branch: "wheeljack/task-123",
    baseCommit: "a".repeat(40),
  };
  expect(resolveAgentCwd("C:\\repo", lane, "C:\\stale")).toBe(lane.cwd);
  expect(resolveAgentCwd("C:\\repo", undefined, "C:\\persisted")).toBe("C:\\persisted");
  expect(resolveAgentCwd("C:\\repo")).toBe("C:\\repo");
  expect(() => resolveAgentCwd("C:\\repo", { ...lane, closedAt: "2026-07-29T12:00:00Z" }))
    .toThrow("has been removed");
  expect(workspacePathsEqual("C:\\Repo\\Task\\", "c:/repo/task")).toBe(true);
  expect(workspacePathsEqual("/Repo/Task", "/repo/task")).toBe(false);
  expect(canonicalTaskLaneCwd(
    "C:\\repo\\apps\\desktop",
    [{ path: "C:\\repo" }, { path: "C:\\task-worktree" }],
    "c:/task-worktree/",
  )).toBe("C:\\task-worktree\\apps\\desktop");
  expect(canonicalTaskLaneCwd(
    "C:\\repo\\apps\\desktop",
    [{ path: "C:\\repo" }],
    "C:\\missing-worktree",
  )).toBeUndefined();
  expect(canonicalTaskLaneCwd(
    "C:\\repo\\apps\\desktop",
    [{ path: "C:\\repo" }, { path: "C:\\task-worktree" }],
    "C:\\repo",
  )).toBeUndefined();
  const laneValidationSource = appSource.slice(
    appSource.indexOf("async function ensureOpsTaskLane"),
    appSource.indexOf("const consumeOpsEvents"),
  );
  expect(laneValidationSource).toContain("!workspacePathsEqual(task.taskLane.cwd, canonicalCwd)");
});

test("extracts legacy bundles and requests staged project-plan controls", () => {
  const proposal = 'wheeljack.project_documents {"requestId":"request-2","documents":{"kanban":"# Kanban","prd":"# Product","tdd":"# Design"}}';
  expect(parseProjectDocumentProposal(JSON.stringify({ message: { content: proposal } }))).toEqual({
    requestId: "request-2",
    documents: {
      kanban: "# Kanban",
      prd: "# Product",
      tdd: "# Design",
    },
  });
  expect(parseProjectDocumentProposal('wheeljack.project_documents {"requestId":"request-2","documents":{"prd":"# Product","tdd":"# Design"}}')).toBeUndefined();
  expect(appSource).toContain('request.kind === "bundle" ? "Review agent project plan"');
  expect(appSource).toContain("contents: {}, timeout");
  expect(appSource).toContain("Emit each line as soon as that document is complete");
  expect(appSource).toContain("...kinds.map((documentKind) => `wheeljack.project_document");
  expect(appSource).toContain("the combined markdown under 36,000 characters");
  expect(appSource).toContain("Review partial agent project plan");
  expect(appSource).toContain("The completed proposals are ready for review");
  expect(appSource).toContain("within ten minutes");
  expect(appSource).toContain("}, 600_000);");
  expect(appSource).toContain("Bootstrap this project's missing plan documents");
  expect(appSource).toContain("wheeljack-kanban: 1");
  expect(appSource).toContain("use a concise action title on the `- [ ]` line");
  expect(appSource).toContain("Cards requiring contract backfill");
  expect(appSource).toContain("repository-valid non-empty verificationCommand");
  expect(appSource).toContain("await spawnAgent(prompt, undefined, displayPrompt)");
});

test("normalizes persisted UI scale to supported zoom steps", () => {
  expect(normalizeUiScale(1.26)).toBe(1.3);
  expect(normalizeUiScale(.1)).toBe(.5);
  expect(normalizeUiScale(5)).toBe(2);
  expect(normalizeUiScale(Number.NaN)).toBe(1);
  expect(appSource).toContain("setZoom(preferences.uiScale)");
  expect(shortcutsSource).toContain("event.ctrlKey || event.metaKey");
  expect(paritySource).toContain('label="UI scale"');
});

test("captures app shortcuts before terminal input and persists customized bindings", () => {
  expect(appSource).toContain('window.addEventListener("keydown", handleShortcut, true)');
  expect(appSource).toContain("event.stopPropagation()");
  expect(appSource).toContain("shortcuts: nextShortcuts");
  expect(appSource).toContain("shortcutBindingsFromSettings(effectiveSettings");
  expect(terminalSurfaceSource).toContain("event.ctrlKey || event.metaKey");
  expect(paritySource).toContain('value="shortcuts"');
  expect(paritySource).toContain('data-shortcut-recorder=""');
});

test("keeps failed turns failed and opens Pi for provider-owned repair", () => {
  expect(agentParseStatus({
    events: [{ type: "error", text: "Token invalid" }, { type: "turn_done" }],
    messages: [],
    active: false,
  })).toBe("failed");
  expect(adapterRepairCommand(
    { id: "pi-coding-agent" },
    { provider: "openai-codex" },
  )).toBe("pi");
  expect(agentParseStatus({
    events: [{ type: "turn_canceled" }],
    messages: [],
    active: false,
  }, [], "canceling")).toBe("canceled");
  expect(["codex-app-server", "claude-stream-json", "opencode-sse", "pi-rpc"].every(supportsAgentTurnCancel)).toBe(true);
  expect(supportsAgentTurnCancel("hermes-acp")).toBe(false);
  expect(["codex-app-server", "claude-stream-json", "opencode-sse", "pi-rpc", "hermes-acp"].every(supportsAgentImageInput)).toBe(true);
  expect(supportsAgentImageInput("hermes-gateway")).toBe(false);
  expect(appSource).toContain('aria-label="Resize terminal agent rail"');
  expect(appSource).toContain("agentRailCollapsed={teamRailCollapsed}");
  expect(paritySource).not.toContain("const [agentRailCollapsed");
});

test("keeps restart recovery in paged SQLite history instead of canvas chat copies", () => {
  expect(appSource).toContain('"session_transcript_page"');
  expect(appSource).toContain("historyBeforeSeq");
  expect(appSource).toContain("chatPreview:");
  expect(appSource).not.toContain("chatMessages: serializeAgentMessages");
});
