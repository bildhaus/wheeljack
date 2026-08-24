const options = Object.fromEntries(process.argv.slice(2).map((value, index, values) =>
  value.startsWith("--") ? [value.slice(2), values[index + 1]] : null
).filter(Boolean));
const port = Number(options.port ?? 9344);
const expectedPanes = Number(options["expected-panes"] ?? 9);
const laneStatePath = options["lane-state"];
const leaveOpen = options["leave-open"] === "true";
const expectInterrupted = options["expect-interrupted"] !== "false";
const closeFlush = options["close-flush"] === "true";
if (!laneStatePath) throw new Error("--lane-state is required.");
const expectedLaneState = await Bun.file(laneStatePath).json();
const normalizePath = (value) => value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
const samePath = (left, right) => normalizePath(left) === normalizePath(right);

const deadline = Date.now() + 60_000;
let target;
while (Date.now() < deadline) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    target = targets.find((candidate) => candidate.type === "page");
    if (target) break;
  } catch {
    // The recovered WebView is still starting.
  }
  await Bun.sleep(200);
}
if (!target) throw new Error(`No recovered wheeljack WebView appeared on DevTools port ${port}.`);

const socket = new WebSocket(target.webSocketDebuggerUrl);
await Promise.race([
  new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  }),
  Bun.sleep(10_000).then(() => { throw new Error("Timed out connecting to the recovered WebView."); }),
]);
let requestId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const response = JSON.parse(event.data);
  const completion = pending.get(response.id);
  if (!completion) return;
  pending.delete(response.id);
  if (response.error) completion.reject(new Error(response.error.message));
  else completion.resolve(response.result);
});
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++requestId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
await cdp("Runtime.enable");
await cdp("Accessibility.enable");

const evaluate = async (expression, awaitPromise = false) => {
  const result = await cdp("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
};
const waitFor = async (expression, description, timeoutMilliseconds = 60_000) => {
  const until = Date.now() + timeoutMilliseconds;
  while (Date.now() < until) {
    if (await evaluate(expression)) return;
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}.\nVisible text: ${await evaluate("document.body.innerText")}`);
};
let coreSequence = 0;
const coreResult = async (command, payload) => {
  const requestJson = JSON.stringify({
    id: `recovery-${Date.now()}-${++coreSequence}`,
    command,
    payload,
    protocolVersion: 2,
  });
  const response = await evaluate(
    `window.__TAURI_INTERNALS__.invoke("core_call", { requestJson: ${JSON.stringify(requestJson)} }).then(JSON.parse)`,
    true,
  );
  return response;
};
const coreCall = async (command, payload) => {
  const response = await coreResult(command, payload);
  if (!response.ok) throw new Error(response.error?.message ?? `${command} failed.`);
  return response.payload;
};

await waitFor(
  "Boolean(window.__TAURI_INTERNALS__ && document.querySelector('.wj-app-shell[data-core-connected=\"true\"]') && document.querySelector('img[alt=\"wheeljack\"]'))",
  "recovered native shell and core",
);
await waitFor(
  `Boolean(document.querySelector(${JSON.stringify(`button.wj-nav-item[aria-label="${expectedLaneState.projectName}"][aria-current="page"]`)}))`,
  "recovered active project navigation",
);
await waitFor(
  "Boolean(document.querySelector('.wj-terminal-page')) && !document.querySelector('.wj-onboarding')",
  "restored project surface without onboarding",
);
const openedOps = await evaluate(`(()=>{const button=document.querySelector('.wj-plan-mode-trigger');button?.click();return Boolean(button)})()`);
if (!openedOps) throw new Error("Recovered project did not expose Ops navigation.");
await waitFor("Boolean(document.querySelector('.wj-floor'))", "recovered Ops Floor");
await evaluate(`(()=>{const tab=[...document.querySelectorAll('[role="tab"]')].find(node=>node.textContent?.trim()==="Plan");tab?.focus();return Boolean(tab)})()`);
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await waitFor(
  `[...document.querySelectorAll(".wj-task-card")].some(node=>node.textContent?.includes("WHEELJACK_OPS_PERSISTENCE_EDITED"))`,
  "recovered Ops board",
);
await evaluate(`(()=>{const card=[...document.querySelectorAll(".wj-task-card")].find(node=>node.textContent?.includes(${JSON.stringify(expectedLaneState.cardTitle)}));const summary=card?.querySelector(".wj-task-summary");summary?.click();return Boolean(summary)})()`);
await waitFor(
  `(()=>{const inspector=document.querySelector(".wj-execution-inspector");return inspector?.textContent?.includes("Workspace")&&inspector.textContent.includes(${JSON.stringify(expectedLaneState.lane.branch)})})()`,
  "visible recovered task worktree details",
);
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await waitFor(`!document.querySelector(".wj-execution-inspector[data-state='open']")`, "closed recovered task inspector");
const recoveredCanvases = await coreCall("canvas_list_project", { projectId: expectedLaneState.projectId });
const recoveredCanvas = recoveredCanvases.find((candidate) => candidate.id === expectedLaneState.canvasId);
if (!recoveredCanvas) throw new Error(`Recovery lost the expected canvas: ${expectedLaneState.canvasId}`);
const recoveredOps = await coreCall("ops_project_state_get", { projectId: recoveredCanvas.projectId });
let recoveredLaneCard = recoveredOps?.state?.cards?.find((card) => card.id === expectedLaneState.cardId);
const recoveredTaskNode = recoveredCanvases.flatMap((candidate) => candidate.nodes ?? []).find((node) => node.id === expectedLaneState.taskNodeId);
if (
  !recoveredLaneCard?.taskLane ||
  recoveredLaneCard.taskLane.kind !== "git-worktree" ||
  recoveredLaneCard.taskLane.closedAt ||
  recoveredLaneCard.taskLane.branch !== expectedLaneState.lane.branch ||
  recoveredLaneCard.taskLane.baseCommit !== expectedLaneState.lane.baseCommit ||
  !samePath(recoveredLaneCard.taskLane.worktreePath, expectedLaneState.lane.worktreePath) ||
  !samePath(recoveredLaneCard.taskLane.cwd, expectedLaneState.lane.cwd)
) {
  throw new Error(`Task-lane metadata changed during recovery: ${JSON.stringify({ card: recoveredLaneCard, node: recoveredTaskNode })}`);
}
const recoveredWorktreeStatus = await coreCall("git_status", {
  path: expectedLaneState.projectPath,
  includeWorktrees: true,
});
const recoveredLinkedWorktrees = recoveredWorktreeStatus.worktrees.filter((worktree) =>
  !samePath(worktree.path, expectedLaneState.projectPath));
if (
  recoveredLinkedWorktrees.length !== 1 ||
  !samePath(recoveredLinkedWorktrees[0].path, expectedLaneState.lane.worktreePath) ||
  recoveredLinkedWorktrees[0].branch !== expectedLaneState.lane.branch ||
  recoveredLinkedWorktrees[0].head !== expectedLaneState.lane.baseCommit
) {
  throw new Error(`Recovered task worktree registration diverged: ${JSON.stringify(recoveredWorktreeStatus.worktrees)}`);
}
const recoveredTaskSessions = (await coreCall("session_list", { limit: 100 }))
  .filter((session) => session.nodeId === expectedLaneState.taskNodeId);
const expectedRecoveredSessionId = expectedLaneState.sessionIds.at(-1);
const expectedRecoveredSession = recoveredTaskSessions.find((session) => session.id === expectedRecoveredSessionId);
const recoveredNodeSessionId = recoveredTaskNode?.data?.sessionId ?? recoveredTaskNode?.data?.lastSessionId;
if (
  !expectedRecoveredSession ||
  (recoveredTaskNode && recoveredNodeSessionId !== expectedRecoveredSessionId) ||
  !samePath(expectedRecoveredSession.cwd, expectedLaneState.lane.cwd)
) {
  throw new Error(`Recovered task session lost its lane cwd: ${JSON.stringify(recoveredTaskSessions)}`);
}
await evaluate(`(()=>{const tab=[...document.querySelectorAll('[role="tab"]')].find(node=>node.textContent?.trim()==="Spec");tab?.focus();return Boolean(tab)})()`);
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await waitFor(`[...document.querySelectorAll('[role="tab"]')].some(node=>node.textContent?.trim()==="Requirements")`, "recovered Spec requirements tab");
await evaluate(`(()=>{const tab=[...document.querySelectorAll('[role="tab"]')].find(node=>node.textContent?.trim()==="Requirements");tab?.focus();return Boolean(tab)})()`);
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await waitFor(
  `document.querySelector("textarea")?.value.includes("## Acceptance criteria")`,
  "recovered PRD",
);
const openedTerminal = await evaluate(`(()=>{const button=[...document.querySelectorAll('.wj-project-mode button')].find(node=>node.textContent?.trim()==="Work");button?.click();return Boolean(button)})()`);
if (!openedTerminal) throw new Error("Recovered project did not expose Terminal navigation.");
await waitFor("Boolean(document.querySelector('.wj-terminal-page'))", "recovered terminal surface");
await waitFor(`document.querySelectorAll('[data-pane-id]').length >= ${expectedPanes}`, "recovered recursive split layout");
await waitFor(
  `[...document.querySelectorAll('.chat [role="log"]')].some(node=>node.textContent?.includes("fixture:first:WHEELJACK_STRUCTURED_INITIAL") && node.textContent?.includes("fixture:second:WHEELJACK_STRUCTURED_PROMPT"))`,
  "recovered structured-agent transcript",
);
await waitFor(
  `[...document.querySelectorAll('.chat .message.user p')].some(node=>node.textContent==="WHEELJACK_STRUCTURED_INITIAL") && [...document.querySelectorAll('.chat .message.user p')].some(node=>node.textContent==="WHEELJACK_STRUCTURED_PROMPT")`,
  "recovered structured-agent user turns",
);
await waitFor(
  `[...document.querySelectorAll('[aria-label="Terminal output"]')].some(node=>node.textContent?.includes("WHEELJACK_TAURI_RUNTIME_OK") || node.textContent?.includes("WHEELJACK_SCROLL_120") || node.textContent?.includes("wheeljack frame 240"))`,
  "recovered terminal transcript",
);

let removalRefusal;
let resumedRecoveredTask = false;
if (expectInterrupted && recoveredTaskNode) {
  await waitFor(
    `(()=>{const pane=[...document.querySelectorAll("[data-pane-id]")].find(node=>node.dataset.paneId===${JSON.stringify(expectedLaneState.taskNodeId)});return Boolean(pane?.querySelector('button[title="Resume session"]'))})()`,
    "task-lane Resume session action",
  );
  const resumed = await evaluate(`(()=>{const pane=[...document.querySelectorAll("[data-pane-id]")].find(node=>node.dataset.paneId===${JSON.stringify(expectedLaneState.taskNodeId)});const button=pane?.querySelector('button[title="Resume session"]');button?.click();return Boolean(button)})()`);
  if (!resumed) throw new Error("The recovered task lane did not expose Resume session.");
  const resumeDeadline = Date.now() + 30_000;
  let resumedTaskSession;
  while (Date.now() < resumeDeadline && !resumedTaskSession) {
    const taskSessions = (await coreCall("session_list", { limit: 100 }))
      .filter((session) => session.nodeId === expectedLaneState.taskNodeId);
    resumedTaskSession = taskSessions.find((session) =>
      !expectedLaneState.sessionIds.includes(session.id) &&
      session.status === "running");
    if (!resumedTaskSession) await Bun.sleep(100);
  }
  if (!resumedTaskSession || !samePath(resumedTaskSession.cwd, expectedLaneState.lane.cwd)) {
    throw new Error(`Resume did not reuse the task lane: ${JSON.stringify(resumedTaskSession)}`);
  }
  await waitFor(
    `(()=>{const pane=[...document.querySelectorAll("[data-pane-id]")].find(node=>node.dataset.paneId===${JSON.stringify(expectedLaneState.taskNodeId)});return pane?.textContent?.includes("fixture:lane:Resume wheeljack task")})()`,
    "resumed task fixture in the original lane pane",
    30_000,
  );
  expectedLaneState.sessionIds.push(resumedTaskSession.id);
  await Bun.write(laneStatePath, JSON.stringify(expectedLaneState, null, 2));
  resumedRecoveredTask = true;
}

if (expectInterrupted) {
  const removeResult = await coreResult("git_worktree_remove", {
    req: {
      projectPath: expectedLaneState.projectPath,
      worktreePath: expectedLaneState.lane.worktreePath,
      expectedBranch: expectedLaneState.lane.branch,
    },
  });
  removalRefusal = removeResult.error?.message ?? "";
  if (removeResult.ok || !removalRefusal.includes("local changes")) {
    throw new Error(`Dirty task worktree removal was not safely refused: ${JSON.stringify(removeResult)}`);
  }
  const preservedStatus = await coreCall("git_status", {
    path: expectedLaneState.projectPath,
    includeWorktrees: true,
  });
  const preservedLane = preservedStatus.worktrees.find((worktree) =>
    samePath(worktree.path, expectedLaneState.lane.worktreePath));
  const preservedCanvas = await coreCall("canvas_get", { canvasId: expectedLaneState.canvasId });
  const preservedOps = await coreCall("ops_project_state_get", { projectId: preservedCanvas.projectId });
  recoveredLaneCard = preservedOps?.state?.cards?.find((card) => card.id === expectedLaneState.cardId);
  if (!preservedLane || preservedLane.branch !== expectedLaneState.lane.branch || recoveredLaneCard?.taskLane?.closedAt) {
    throw new Error(`Dirty removal changed task-lane registration or metadata: ${JSON.stringify({ preservedLane, card: recoveredLaneCard })}`);
  }
}

const [status, sessions] = await Promise.all([
  coreCall("core_status", {}),
  coreCall("session_list", { limit: 100 }),
]);
const latestTaskSessionId = expectedLaneState.sessionIds.at(-1);
const latestTaskSession = sessions.find((session) =>
  session.id === latestTaskSessionId && session.nodeId === expectedLaneState.taskNodeId);
if (
  !latestTaskSession ||
  !samePath(latestTaskSession.cwd, expectedLaneState.lane.cwd) ||
  (resumedRecoveredTask && latestTaskSession.status !== "running")
) {
  throw new Error(`Latest recovered task session does not use the persisted lane: ${JSON.stringify(latestTaskSession)}`);
}
const interrupted = sessions.filter((session) =>
  ["disconnected", "completed", "failed"].includes(session.status)
);
if (expectInterrupted && status.recoveredSessions < 1) {
  throw new Error(`Core did not report interrupted-session recovery: ${JSON.stringify(status)}`);
}
if (expectInterrupted && (!status.startupRecovery?.previousUncleanShutdown || !status.startupRecovery?.crashReportPath)) {
  throw new Error(`Core did not report the unclean startup journal: ${JSON.stringify(status)}`);
}
if (expectInterrupted && interrupted.length < 8) {
  throw new Error(`Expected recovered terminal and agent sessions: ${JSON.stringify(sessions)}`);
}

const accessibility = await cdp("Accessibility.getFullAXTree");
const summary = await evaluate(`(()=>({
  panes: document.querySelectorAll("[data-pane-id]").length,
  terminals: document.querySelectorAll('[role="application"][aria-label="Terminal session"]').length,
  structuredTranscript: [...document.querySelectorAll('.chat [role="log"]')].some(node=>node.textContent?.includes("fixture:second:WHEELJACK_STRUCTURED_PROMPT")),
  userTurns: [...document.querySelectorAll('.chat .message.user p')].map(node=>node.textContent),
  terminalTranscript: [...document.querySelectorAll('[aria-label="Terminal output"]')].some(node=>node.textContent?.includes("WHEELJACK_TAURI_RUNTIME_OK") || node.textContent?.includes("WHEELJACK_SCROLL_120") || node.textContent?.includes("wheeljack frame 240")),
  opsRecovered: true,
  prdRecovered: true,
  taskLaneRecovered: true,
  taskLaneSession: ${JSON.stringify(expectedLaneState.taskNodeId)},
  alerts: [...document.querySelectorAll('.wj-error-toast')].map(node=>node.textContent?.trim()).filter(Boolean),
  logo: Boolean(document.querySelector('img[alt="wheeljack"]')),
  decorated: !document.querySelector(".wj-titlebar")
}))()`);
if (summary.alerts.length) throw new Error(`Recovered shell reported alerts: ${summary.alerts.join("; ")}`);
console.log(JSON.stringify({
  ...summary,
  recoveredSessions: status.recoveredSessions,
  startupRecovery: status.startupRecovery,
  interruptedSessions: interrupted.length,
  taskLaneBranch: expectedLaneState.lane.branch,
  dirtyRemovalRefusal: removalRefusal,
  accessibilityNodes: accessibility.nodes.length,
}, null, 2));
if (!leaveOpen) {
  if (closeFlush) {
    const panesBeforeClose = await evaluate("document.querySelectorAll('[data-pane-id]').length");
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "D", code: "KeyD", windowsVirtualKeyCode: 68, modifiers: 9 });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "D", code: "KeyD", windowsVirtualKeyCode: 68, modifiers: 9 });
    await waitFor(`document.querySelectorAll("[data-pane-id]").length > ${panesBeforeClose}`, "last-moment recovered split before close");
    console.log(JSON.stringify({ closeFlushExpectedPanes: panesBeforeClose + 1 }));
  }
  await evaluate(`window.dispatchEvent(new CustomEvent("wheeljack:smoke-close")); true`);
}
socket.close();
