import { access, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const options = Object.fromEntries(process.argv.slice(2).map((value, index, values) =>
  value.startsWith("--") ? [value.slice(2), values[index + 1]] : null
).filter(Boolean));
const port = Number(options.port ?? 9334);
const projectPath = options.project;
const laneStatePath = options["lane-state"];
const leaveOpen = options["leave-open"] === "true";
const sixSessionOnly = options["six-session-only"] === "true";
const dataPanesOnly = options["data-panes-only"] === "true";
const closeFlush = options["close-flush"] === "true";
const chatScreenshotPath = options["chat-screenshot"];
const chatOnly = options["chat-only"] === "true";
const agentFloodOnly = options["agent-flood-only"] === "true";
const agentMemoryStatePath = options["agent-memory-state"];
const floorOnly = options["floor-only"] === "true";
const floorWideScreenshotPath = options["floor-wide-screenshot"];
const floorNarrowScreenshotPath = options["floor-narrow-screenshot"];
const taskCompletionPath = laneStatePath ? `${laneStatePath}.task-complete`.replaceAll("\\", "/") : "";
const taskCompletionPathBase64 = Buffer.from(taskCompletionPath).toString("base64");
if (!projectPath) throw new Error("--project is required.");
const normalizePath = (value) => value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
const samePath = (left, right) => normalizePath(left) === normalizePath(right);
const pathExists = (path) => access(path).then(() => true, () => false);

const startupDeadline = Date.now() + 60_000;
let target;
while (Date.now() < startupDeadline) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    target = targets.find((candidate) => candidate.type === "page");
    if (target) break;
  } catch {
    // The packaged WebView is still starting.
  }
  await Bun.sleep(200);
}
if (!target) throw new Error(`No wheeljack WebView appeared on DevTools port ${port}.`);

const socket = new WebSocket(target.webSocketDebuggerUrl);
await Promise.race([
  new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  }),
  Bun.sleep(10_000).then(() => { throw new Error("Timed out connecting to the wheeljack DevTools target."); }),
]);
let id = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const response = JSON.parse(event.data);
  if (!response.id || !pending.has(response.id)) return;
  const completion = pending.get(response.id);
  pending.delete(response.id);
  if (response.error) completion.reject(new Error(response.error.message));
  else completion.resolve(response.result);
});
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id;
  pending.set(requestId, { resolve, reject });
  socket.send(JSON.stringify({ id: requestId, method, params }));
});
await cdp("Runtime.enable");
await cdp("Accessibility.enable");

const evaluate = async (expression, awaitPromise = false) => {
  const result = await cdp("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) {
    const description = result.exceptionDetails.exception?.description
      ?? result.exceptionDetails.exception?.value
      ?? result.exceptionDetails.text;
    throw new Error(`${description}\nExpression: ${expression}`);
  }
  return result.result.value;
};
const waitFor = async (expression, description, timeoutMilliseconds = 60_000) => {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await Bun.sleep(100);
  }
  const body = await evaluate("document.body.innerText");
  throw new Error(`Timed out waiting for ${description}.\nVisible text: ${body}`);
};
const selectLabeledTab = async (listLabel, label) => {
  const selector = `[aria-label=${JSON.stringify(listLabel)}] [role="tab"]`;
  const activated = await evaluate(`(()=>{const tab=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.textContent?.trim()===${JSON.stringify(label)});if(!tab)return false;tab.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true,button:0,buttons:1}));tab.dispatchEvent(new MouseEvent("mouseup",{bubbles:true,cancelable:true,button:0}));tab.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,button:0}));return true})()`);
  if (!activated) throw new Error(`${listLabel} tab ${label} is unavailable.`);
  await waitFor(`[...document.querySelectorAll(${JSON.stringify(selector)})].some(node=>node.textContent?.trim()===${JSON.stringify(label)}&&node.getAttribute("aria-selected")==="true")`, `selected ${label} tab`);
};
const clickElement = async (selector) => {
  const point = await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return null;const rect=node.getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`);
  if (!point) throw new Error(`Element is unavailable: ${selector}`);
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
};
const clickTextElement = async (selector, label) => {
  const point = await evaluate(`(()=>{const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find(candidate=>candidate.textContent?.trim().startsWith(${JSON.stringify(label)}));if(!node)return null;const rect=node.getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`);
  if (!point) throw new Error(`Element is unavailable: ${label} in ${selector}`);
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
};
const selectProjectView = (label) => selectLabeledTab("Project views", label);
const showRunGraph = async () => {
  await evaluate(`(()=>{if(document.querySelector('.wj-floor-run-graph .wj-run-graph'))return true;const summary=document.querySelector('.wj-floor-run-graph-summary');summary?.click();return Boolean(summary)})()`);
  await waitFor(`Boolean(document.querySelector('.wj-floor-run-graph .wj-run-graph')) && document.querySelector('.wj-run-graph-range button[aria-pressed="true"]')?.textContent?.trim()==="40m"`, "expanded Run Graph at the default range");
};
const sendTerminalCommand = async (command) => {
  const sent = await evaluate(`(()=>{const pane=[...document.querySelectorAll("[data-pane-id]")].find(node=>node.getAttribute("data-runtime-status")==="running"&&node.querySelector('textarea[aria-label="Terminal input"]'));const input=pane?.querySelector('textarea[aria-label="Terminal input"]');if(!input)return false;const transfer=new DataTransfer();transfer.setData("text/plain",${JSON.stringify(command)});input.focus();input.dispatchEvent(new ClipboardEvent("paste",{bubbles:true,clipboardData:transfer}));input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:true}));return true})()`);
  if (!sent) throw new Error(`No running terminal accepted command: ${command}`);
};

await waitFor(
  "Boolean(window.__TAURI_INTERNALS__ && document.querySelector('img[alt=\"wheeljack\"]') && document.querySelector('h1') && document.querySelector('.wj-app-shell[data-core-connected=\"true\"]'))",
  "native shell and core connection",
);
let coreRequestSequence = 0;
const coreCall = async (command, payload) => {
  const requestJson = JSON.stringify({
    id: `smoke-${Date.now()}-${++coreRequestSequence}`,
    command,
    payload,
    protocolVersion: 2,
  });
  const response = await evaluate(`window.__TAURI_INTERNALS__.invoke("core_call", { requestJson: ${JSON.stringify(requestJson)} }).then(JSON.parse)`, true);
  if (!response.ok) throw new Error(response.error?.message ?? `${command} failed.`);
  return response.payload;
};
const invoke = (command, payload) =>
  evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(payload)})`, true);
const expectedDataDir = process.env.WHEELJACK_DESKTOP_DATA_DIR;
if (!expectedDataDir) throw new Error("WHEELJACK_DESKTOP_DATA_DIR is required for the packaged WebView smoke.");
const coreStatus = await coreCall("core_status", {});
if (coreStatus.testMode !== true || !samePath(coreStatus.appDataDir, expectedDataDir)) {
  throw new Error(`Refusing smoke mutations outside the isolated profile: ${JSON.stringify({
    expectedDataDir,
    actualDataDir: coreStatus.appDataDir,
    testMode: coreStatus.testMode,
  })}`);
}
const openedProject = await coreCall("project_open", { path: projectPath });
let dataPaneCanvas;
if (dataPanesOnly) {
  [dataPaneCanvas] = await coreCall("canvas_list_project", { projectId: openedProject.id });
  if (!dataPaneCanvas) throw new Error("The data-pane smoke project has no canvas.");
  const timestamp = new Date().toISOString();
  const fixtures = [
    {
      id: "smoke-markdown",
      kind: "markdown_note",
      title: "Smoke note",
      data: { markdown: "WHEELJACK_MARKDOWN_INITIAL" },
    },
    {
      id: "smoke-checklist",
      kind: "task_checklist",
      title: "Smoke checklist",
      data: { items: [{ id: "smoke-check", label: "Exercise checklist persistence", done: false }] },
    },
    {
      id: "smoke-browser",
      kind: "browser_preview",
      title: "Smoke browser",
      data: { url: "" },
    },
    {
      id: "smoke-future",
      kind: "future_pane_kind",
      title: "Smoke future pane",
      data: { content: "WHEELJACK_UNKNOWN_PANE_CONTENT" },
    },
  ];
  for (const [index, fixture] of fixtures.entries()) {
    await coreCall("canvas_upsert_node", {
      canvasId: dataPaneCanvas.id,
      node: {
        ...fixture,
        canvasId: dataPaneCanvas.id,
        x: index * 20,
        y: index * 20,
        width: 640,
        height: 360,
        zIndex: index,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    });
  }
}
const fixtureScript = String.raw`
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Ignored)
@{type="system";subtype="init";session_id=("wheeljack-fixture-"+$PID)} | ConvertTo-Json -Compress
function Write-TaskCards([string]$Prompt) {
  if ($Prompt -notmatch 'wheeljack\.task_cards \{"requestId":"([^"]+)"') { return $false }
  $requestId = $Matches[1]
  if ($Prompt -match 'WHEELJACK_RECOVERY_LANE') {
    $title = 'WHEELJACK_RECOVERY_LANE'
    $definition = 'The recovery task runs in its isolated lane and preserves recoverable work.'
    $verificationCommand = 'git diff --check'
    $reviewPolicy = 'agent'
  } else {
    $title = 'WHEELJACK_OPS_PERSISTENCE'
    $definition = 'The isolated lane is self-checked, reconciled, integrated, and removed safely.'
    $verificationCommand = 'git diff --check'
    if ($Prompt -match 'VERIFICATION_BASE64:([A-Za-z0-9+/=]+)') {
      $verificationCommand = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Matches[1]))
    }
    $reviewPolicy = 'agent'
  }
  $payload = @{
    requestId = $requestId
    cards = @(@{
      key = 'smoke-task'
      title = $title
      detail = 'Exercise the packaged task lane lifecycle from the generated backlog card.'
      priority = 'normal'
      definitionOfDone = $definition
      constraints = ''
      verificationCommand = $verificationCommand
      reviewPolicy = $reviewPolicy
      dependencyKeys = @()
      existingDependencyIds = @()
    })
  } | ConvertTo-Json -Compress -Depth 8
  $control = 'wheeljack.task_cards ' + $payload
  [Console]::Out.WriteLine((@{type="assistant";message=@{content=@(@{type="text";text=$control})}} | ConvertTo-Json -Compress -Depth 8))
  [Console]::Out.WriteLine('{"type":"result","is_error":false}')
  return $true
}
$a = [Console]::In.ReadLine() | ConvertFrom-Json
if ($a.message.content -match 'WHEELJACK_AGENT_FLOOD') {
  $run = 0
  do {
    $run++
    @{type="tool_start";tool_call_id=("flood-"+$run);title=("Flood fixture "+$run)} | ConvertTo-Json -Compress
    $chunk = "x" * 512
    $chunkCount = if ($run -eq 1) { 5000 } else { 500 }
    for ($index = 0; $index -lt $chunkCount; $index++) {
      @{type="tool_delta";tool_call_id=("flood-"+$run);text=$chunk} | ConvertTo-Json -Compress
    }
    @{type="tool_end";tool_call_id=("flood-"+$run);text=("FINAL_ERROR_"+$run)} | ConvertTo-Json -Compress
    Write-Output '{"type":"result","is_error":false}'
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $a = $line | ConvertFrom-Json
  } while ($a.message.content -match 'WHEELJACK_AGENT_FLOOD')
  exit 0
}
if ($a.message.content -match 'fresh, dedicated worker for wheeljack task|Resume wheeljack task') {
  @{type="assistant";message=@{content=@(@{type="text";text=("fixture:lane:"+$a.message.content)})}} | ConvertTo-Json -Compress -Depth 6
  $taskCompletionPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${taskCompletionPathBase64}'))
  while ($taskCompletionPath -and -not (Test-Path -LiteralPath $taskCompletionPath -PathType Leaf)) { Start-Sleep -Milliseconds 50 }
  Write-Output '{"type":"result","is_error":false}'
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $request = $line | ConvertFrom-Json
    @{type="assistant";message=@{content=@(@{type="text";text=("fixture:lane-followup:"+$request.message.content)})}} | ConvertTo-Json -Compress -Depth 6
    Write-Output '{"type":"result","is_error":false}'
  }
  exit 0
}
if (Write-TaskCards $a.message.content) { exit 0 }
Write-Output '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","text":"Inspecting the request"}}}'
$codeFence = [string]([char]96) * 3
$nl = [Environment]::NewLine
$visiblePrompt = $a.message.content -replace '(?s)\r?\n\r?\nwheeljack autonomous controls:.*$', ''
@{type="assistant";message=@{content=@(@{type="text";text=("fixture:first:"+$visiblePrompt+$nl+$codeFence+"powershell"+$nl+"Write-Output 'wheeljack'"+$nl+$codeFence)})}} | ConvertTo-Json -Compress -Depth 6
Write-Output '{"type":"result","is_error":false}'
$b = [Console]::In.ReadLine() | ConvertFrom-Json
@{type="assistant";message=@{content=@(@{type="text";text=("fixture:second:"+$b.message.content)})}} | ConvertTo-Json -Compress -Depth 6
Write-Output '{"type":"control_request","request_id":"fixture-approval","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"cargo test"}}}'
$c = [Console]::In.ReadLine() | ConvertFrom-Json
@{type="assistant";message=@{content=@(@{type="text";text=("fixture:approval:"+$c.response.response.behavior)})}} | ConvertTo-Json -Compress -Depth 6
Write-Output '{"type":"control_request","request_id":"fixture-question","request":{"subtype":"can_use_tool","tool_name":"AskUserQuestion","input":{"questions":[{"question":"Which workspace should continue?","header":"Workspace","options":[{"label":"Primary","description":"Continue in the primary workspace"},{"label":"Secondary","description":"Continue in the secondary workspace"}],"multiSelect":false}]}}}'
$d = [Console]::In.ReadLine() | ConvertFrom-Json
@{type="assistant";message=@{content=@(@{type="text";text=("fixture:question:"+$d.response.response.behavior)})}} | ConvertTo-Json -Compress -Depth 6
Write-Output '{"type":"result","is_error":false}'
$e = [Console]::In.ReadLine() | ConvertFrom-Json
@{type="assistant";message=@{content=@(@{type="text";text=("fixture:partial:"+$e.message.content)})}} | ConvertTo-Json -Compress -Depth 6
$f = [Console]::In.ReadLine() | ConvertFrom-Json
@{type="assistant";message=@{content=@(@{type="text";text=("fixture:interrupt:"+$f.request.subtype)})}} | ConvertTo-Json -Compress -Depth 6
Write-Output '{"type":"result","is_error":true,"result":"Request interrupted by user"}'
$g = [Console]::In.ReadLine() | ConvertFrom-Json
@{type="assistant";message=@{content=@(@{type="text";text=("fixture:recovered:"+$g.message.content)})}} | ConvertTo-Json -Compress -Depth 6
Write-Output '{"type":"result","is_error":false}'
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $request = $line | ConvertFrom-Json
  if (Write-TaskCards $request.message.content) { continue }
  @{type="assistant";message=@{content=@(@{type="text";text=("fixture:extra:"+$request.message.content)})}} | ConvertTo-Json -Compress -Depth 6
  Write-Output '{"type":"result","is_error":false}'
}
`;
const fixtureScriptPath = `${projectPath}.wheeljack-ui-fixture.ps1`;
await writeFile(fixtureScriptPath, fixtureScript);
const fixtureCommand = `powershell -NoProfile -ExecutionPolicy Bypass -File "${fixtureScriptPath}"`;
await coreCall("adapter_save", { manifest: {
  id: "wheeljack-ui-fixture",
  displayName: "wheeljack UI fixture",
  icon: "terminal",
  executables: ["powershell"],
  supportedPlatforms: ["windows"],
  launchCommand: fixtureCommand,
  promptInjection: "stdin",
  status: "unknown",
  setupHint: "Packaged structured-agent smoke fixture",
  presentation: {
    defaultView: "chat",
    parserId: "claude-code",
  },
  streaming: {
    preferred: {
      transport: "ndjson",
      protocol: "claude-stream-json",
      launchCommand: fixtureCommand,
      promptDelivery: "stdin",
      sessionMode: "persistent-stdin-jsonl",
      supportsFollowUp: true,
      responseHistoryMode: "append",
    },
  },
} });
const fixtureVerification = await coreCall("adapter_verify", {
  adapterId: "wheeljack-ui-fixture",
  args: [],
  cwd: projectPath,
});
if (fixtureVerification.verificationStatus !== "verified") {
  throw new Error(`The structured-agent fixture did not verify: ${JSON.stringify(fixtureVerification)}`);
}
for (const adapterId of ["codex-cli", "claude-code", "opencode", "pi-coding-agent"]) {
  await coreCall("adapter_set_enabled", { adapterId, enabled: false });
}
const exerciseOnboarding = !dataPanesOnly && !sixSessionOnly && !floorOnly;
await coreCall("settings_import", { settings: {
  selectedAgentAdapterId: "wheeljack-ui-fixture",
  ...(!exerciseOnboarding ? { desktopOnboardingVersion: 1 } : {}),
} });
await evaluate("location.reload(); true");
if (exerciseOnboarding) {
  await waitFor(
    `Boolean(document.querySelector('#onboarding-prompt')) && [...document.querySelectorAll("button")].some(node=>node.textContent?.trim()==="Start first agent" && !node.disabled)`,
    "resumed first-agent onboarding step",
    120_000,
  );
} else {
  await waitFor(
    `document.querySelector('.wj-title-name')?.textContent?.trim()===${JSON.stringify(openedProject.name)} && Boolean(document.querySelector('.wj-terminal-page'))`,
    "active-project terminal surface",
    120_000,
  );
}
if (dataPanesOnly) {
  await waitFor(
    `Boolean(document.querySelector('textarea[aria-label="Edit Smoke note"]')) &&
      Boolean(document.querySelector('[role="list"][aria-label="Smoke checklist"]')) &&
      Boolean(document.querySelector('input[aria-label="Browser address"]')) &&
      document.body.textContent?.includes("WHEELJACK_UNKNOWN_PANE_CONTENT")`,
    "persisted data-pane surfaces",
  );
  await evaluate(`(()=>{const editor=document.querySelector('textarea[aria-label="Edit Smoke note"]');editor?.focus();return Boolean(editor)})()`);
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "A", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "A", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp("Input.insertText", { text: "WHEELJACK_MARKDOWN_SAVED" });
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "s", code: "KeyS", windowsVirtualKeyCode: 83, modifiers: 2 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "s", code: "KeyS", windowsVirtualKeyCode: 83, modifiers: 2 });
  await evaluate(`(()=>{const checkbox=document.querySelector('[role="list"][aria-label="Smoke checklist"] button[role="checkbox"]');checkbox?.click();return Boolean(checkbox)})()`);
  const browserUrl = "http://127.0.0.1:65535/wheeljack-data-pane-smoke";
  await evaluate(`(()=>{const input=document.querySelector('input[aria-label="Browser address"]');if(!input)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;setter.call(input,${JSON.stringify(browserUrl)});input.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:${JSON.stringify(browserUrl)}}));return true})()`);
  await waitFor(
    `document.querySelector('input[aria-label="Browser address"]')?.value===${JSON.stringify(browserUrl)}`,
    "controlled browser address",
  );
  await evaluate(`(()=>{const form=document.querySelector('input[aria-label="Browser address"]')?.form;const button=form?.querySelector("button");button?.click();return Boolean(button)})()`);
  const persistedDeadline = Date.now() + 15_000;
  let persistedNodes = [];
  while (Date.now() < persistedDeadline) {
    const stored = await coreCall("canvas_get", { canvasId: dataPaneCanvas.id });
    persistedNodes = stored.nodes;
    const markdown = persistedNodes.find((node) => node.id === "smoke-markdown");
    const checklist = persistedNodes.find((node) => node.id === "smoke-checklist");
    const browser = persistedNodes.find((node) => node.id === "smoke-browser");
    if (
      markdown?.data?.markdown === "WHEELJACK_MARKDOWN_SAVED" &&
      checklist?.data?.items?.[0]?.done === true &&
      browser?.data?.url === browserUrl
    ) break;
    await Bun.sleep(100);
  }
  const markdown = persistedNodes.find((node) => node.id === "smoke-markdown");
  const checklist = persistedNodes.find((node) => node.id === "smoke-checklist");
  const browser = persistedNodes.find((node) => node.id === "smoke-browser");
  if (
    markdown?.data?.markdown !== "WHEELJACK_MARKDOWN_SAVED" ||
    checklist?.data?.items?.[0]?.done !== true ||
    browser?.data?.url !== browserUrl
  ) throw new Error("One or more data-pane edits did not persist.");
  const accessibility = await cdp("Accessibility.getFullAXTree");
  const roles = new Set(accessibility.nodes.map((node) => node.role?.value).filter(Boolean));
  for (const required of ["textbox", "checkbox"]) {
    if (!roles.has(required)) throw new Error(`Data-pane accessibility tree is missing ${required}.`);
  }
  console.log(JSON.stringify({
    panes: persistedNodes.length,
    markdownSaved: true,
    checklistSaved: true,
    browserUrlSaved: true,
    unknownPaneRendered: true,
    accessibilityNodes: accessibility.nodes.length,
    alerts: await evaluate(`[...document.querySelectorAll('[role="alert"]')].map(node=>node.textContent?.trim()).filter(Boolean)`),
  }, null, 2));
  if (!leaveOpen) {
    await evaluate(`window.dispatchEvent(new CustomEvent("wheeljack:smoke-close")); true`);
  }
  socket.close();
  process.exit(0);
}
if (floorOnly) {
  if (!await evaluate(`Boolean(document.querySelector(".wj-plan-mode-trigger"))`)) {
    await evaluate(`document.querySelector(${JSON.stringify(`button[aria-label="${openedProject.name}"]`)})?.click()`);
    await waitFor(`Boolean(document.querySelector(".wj-plan-mode-trigger"))`, "project Work surface before Floor");
  }
  await evaluate(`document.querySelector(".wj-plan-mode-trigger")?.click()`);
  await waitFor(`Boolean(document.querySelector(".wj-floor"))`, "focused Ops Floor");
  await waitFor(`Boolean(document.querySelector(".wj-floor-operator")) && Boolean(document.querySelector(".wj-floor-needs")) && Boolean(document.querySelector(".wj-floor-live")) && Boolean(document.querySelector(".wj-floor-ready")) && Boolean(document.querySelector(".wj-floor-activity"))`, "operator cockpit regions");
  await waitFor(`Boolean(document.querySelector(".wj-floor-scheduler-intent"))`, "truthful scheduler intent");
  await waitFor(`Boolean(document.querySelector('.wj-floor-agent-matrix, .wj-floor-agent-empty'))`, "stable agent matrix state");
  await showRunGraph();
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await waitFor(`(()=>{const floor=document.querySelector('.wj-floor');return floor&&floor.scrollHeight<=floor.clientHeight+1})()`, "wide Floor cockpit without page scrolling");
  if (floorWideScreenshotPath) {
    const screenshot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(floorWideScreenshotPath, Buffer.from(screenshot.data, "base64"));
  }
  const inspectorTarget = await evaluate(`Boolean(document.querySelector('.wj-floor-queue-row > button, .wj-floor-task-title'))`);
  if (inspectorTarget) {
    await evaluate(`(()=>{const button=document.querySelector('.wj-floor-queue-row > button, .wj-floor-task-title');button?.click();return Boolean(button)})()`);
    await waitFor(`Boolean(document.querySelector('.wj-floor-docked-inspector')) && document.querySelector('.wj-floor-docked-inspector')?.textContent?.includes('Full details')`, "docked Floor evidence inspector");
    await waitFor(`document.activeElement?.id==="floor-inspector-heading"`, "focused Floor inspector heading");
    await evaluate(`document.querySelector('button[aria-label="Close task inspector"]')?.click()`);
    await waitFor(`!document.querySelector('.wj-floor-docked-inspector') && Boolean(document.querySelector('.wj-floor-activity'))`, "restored Floor operations rail");
  }
  for (const range of ["10m", "4h", "40m"]) {
    await evaluate(`(()=>{const button=[...document.querySelectorAll('.wj-run-graph-range button')].find(node=>node.textContent?.trim()===${JSON.stringify(range)});button?.focus();return Boolean(button)})()`);
    await waitFor(`document.activeElement?.textContent?.trim()===${JSON.stringify(range)}`, `focused Run Graph ${range} range`);
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await waitFor(`document.querySelector('.wj-run-graph-range button[aria-pressed="true"]')?.textContent?.trim()===${JSON.stringify(range)}`, `Run Graph ${range} keyboard range`);
  }
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await waitFor(`getComputedStyle(document.querySelector('.wj-run-graph-range button')).transitionDuration==="0s"`, "reduced-motion Run Graph controls");
  await cdp("Emulation.setEmulatedMedia", { features: [] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
  await waitFor(`(()=>{const scroll=document.querySelector('.wj-run-graph-scroll');const plot=document.querySelector('.wj-run-graph-plot');const floor=document.querySelector('.wj-floor');return scroll&&plot&&floor&&plot.scrollWidth>=720&&scroll.scrollWidth>scroll.clientWidth&&floor.scrollWidth<=floor.clientWidth+1})()`, "900 by 700 Floor without page-level horizontal clipping");
  if (floorNarrowScreenshotPath) {
    const screenshot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(floorNarrowScreenshotPath, Buffer.from(screenshot.data, "base64"));
  }
  await cdp("Emulation.setDeviceMetricsOverride", { width: 760, height: 700, deviceScaleFactor: 1, mobile: false });
  await waitFor(`(()=>{const needs=document.querySelector('.wj-floor-needs');const agents=document.querySelector('.wj-floor-live');const ready=document.querySelector('.wj-floor-ready');const activity=document.querySelector('.wj-floor-activity');const floor=document.querySelector('.wj-floor');if(!needs||!agents||!ready||!activity||!floor)return false;const tops=[needs,agents,ready,activity].map(node=>node.getBoundingClientRect().top);return tops.every((top,index)=>index===0||top>tops[index-1])&&getComputedStyle(floor).overflowY!=="hidden"})()`, "below-820 container stack ordering");
  const preZoomWidth = await evaluate("window.innerWidth");
  for (let index = 0; index < 10; index++) {
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "=", code: "Equal", modifiers: 2, windowsVirtualKeyCode: 187 });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "=", code: "Equal", modifiers: 2, windowsVirtualKeyCode: 187 });
  }
  await waitFor(`window.innerWidth<=${Math.ceil(preZoomWidth / 1.8)}&&document.documentElement.scrollWidth<=document.documentElement.clientWidth+1`, "200 percent zoom without page-level horizontal clipping");
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "0", code: "Digit0", modifiers: 2, windowsVirtualKeyCode: 48 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "0", code: "Digit0", modifiers: 2, windowsVirtualKeyCode: 48 });
  await cdp("Emulation.clearDeviceMetricsOverride");
  await selectProjectView("Spec");
  await waitFor(`[...document.querySelectorAll('[role="tab"]')].some(node=>node.textContent?.trim()==="Technical design")`, "Floor smoke Spec navigation");
  await selectProjectView("Plan");
  await waitFor(`Boolean(document.querySelector(".wj-board"))`, "Floor smoke Plan navigation");
  await selectProjectView("Run");
  await waitFor(`Boolean(document.querySelector(".wj-floor"))`, "Floor smoke Run navigation");
  console.log(JSON.stringify({ floor: true, schedulerIntent: true, agentMatrix: true, projectViewNavigation: true, dockedInspector: inspectorTarget, wideViewport: "1440x900", wideNoPageScroll: true, graphKeyboard: true, reducedMotion: true, compactViewport: "900x700", breakpointStack: true, zoom200: true }));
  if (!leaveOpen) await evaluate(`window.dispatchEvent(new CustomEvent("wheeljack:smoke-close")); true`);
  socket.close();
  process.exit(0);
}
if (sixSessionOnly) {
  await waitFor(`[...document.querySelectorAll("button")].some(node=>node.textContent?.trim()==="Stress six sessions" && !node.disabled)`, "enabled six-session stress action");
  await evaluate(`(()=>{const button=[...document.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Stress six sessions" && !node.disabled);button?.click();return Boolean(button)})()`);
  await waitFor(`document.querySelectorAll('[role="application"][aria-label="Terminal session"]').length===6`, "six-session terminal fixture");
  const terminalBox = await evaluate(`(()=>{const terminal=document.querySelector('[role="application"][aria-label="Terminal session"]');const rect=terminal?.getBoundingClientRect();return rect?{x:rect.x,y:rect.y}:null})()`);
  if (!terminalBox) throw new Error("The terminal surface has no pointer target.");
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: terminalBox.x + 20, y: terminalBox.y + 28, button: "left", buttons: 1, clickCount: 1 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: terminalBox.x + 20, y: terminalBox.y + 28, button: "left", buttons: 0, clickCount: 1 });
  await waitFor(`document.activeElement?.matches('textarea[aria-label="Terminal input"]')`, "terminal input focus after pointer activation");
  const pointerTypedMarker = `WHEELJACK_POINTER_TYPED_${Date.now().toString(36)}`;
  await cdp("Input.insertText", { text: `echo ${pointerTypedMarker}` });
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await waitFor(`[...document.querySelectorAll(".sr-only")].some(node=>node.textContent?.includes(${JSON.stringify(pointerTypedMarker)}))`, "typed terminal echo after pointer activation");
  const outputDeadline = Date.now() + 60_000;
  let completedTranscripts = 0;
  while (Date.now() < outputDeadline) {
    const sessions = (await coreCall("session_list", { limit: 100 }))
      .filter((session) => session.adapterId === "generic-shell");
    const transcripts = await Promise.all(
      sessions.map((session) => coreCall("session_transcript", { sessionId: session.id })),
    );
    completedTranscripts = transcripts.filter((transcript) =>
      transcript.text.includes("wheeljack frame 240")
    ).length;
    if (sessions.length === 6 && completedTranscripts === 6) break;
    await Bun.sleep(100);
  }
  if (completedTranscripts !== 6) {
    throw new Error(`Only ${completedTranscripts}/6 terminal transcripts completed the stress fixture.`);
  }
  await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))", true);
  const metricsStartedBeforeReset = await evaluate(`Number(document.querySelector('[aria-label="Terminal utilities"]')?.dataset.metricsStartedAt)`);
  await evaluate(`(()=>{const button=[...document.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Reset metrics");button?.click();return Boolean(button)})()`);
  await waitFor(`Number(document.querySelector('[aria-label="Terminal utilities"]')?.dataset.metricsStartedAt)>${metricsStartedBeforeReset}`, "reset six-session metrics");
  for (let resizeIndex = 0; resizeIndex < 12; resizeIndex++) {
    if (await evaluate(`Number(document.querySelector('[aria-label="Terminal utilities"]')?.dataset.resizeSamples??0)>=60`)) break;
    const terminalWidth = resizeIndex % 2 ? "100%" : "calc(100% - 96px)";
    await evaluate(`(()=>{const terminals=[...document.querySelectorAll('[role="application"][aria-label="Terminal session"]')];terminals.forEach(node=>node.style.width=${JSON.stringify(terminalWidth)});return terminals.length===6})()`);
    await evaluate("new Promise(resolve=>setTimeout(resolve,150))", true);
  }
  await waitFor(`Number(document.querySelector('[aria-label="Terminal utilities"]')?.dataset.resizeSamples??0)>=60`, "60 six-session resize samples");
  await evaluate(`(()=>{document.querySelectorAll('[role="application"][aria-label="Terminal session"]').forEach(node=>node.style.removeProperty("width"));return true})()`);
  const echoRoundTrips = [];
  for (let terminalIndex = 0; terminalIndex < 6; terminalIndex++) {
    const marker = `WHEELJACK_SIX_ECHO_${terminalIndex}_${Date.now().toString(36)}`;
    const elapsed = await evaluate(`(()=>new Promise((resolve,reject)=>{
      const terminal=[...document.querySelectorAll('[role="application"][aria-label="Terminal session"]')][0];
      const input=terminal?.querySelector('textarea[aria-label="Terminal input"]');
      const log=terminal?.querySelector('[aria-label="Terminal output"]');
      if(!input||!log){reject(new Error("Active terminal is unavailable"));return}
      const started=performance.now();
      const observer=new MutationObserver(()=>{
        if(!log.textContent?.includes(${JSON.stringify(marker)}))return;
        observer.disconnect();
        requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-started)));
      });
      observer.observe(log,{childList:true,subtree:true,characterData:true});
      const transfer=new DataTransfer();
      transfer.setData("text/plain",${JSON.stringify(`echo ${marker}`)});
      input.focus();
      input.dispatchEvent(new ClipboardEvent("paste",{bubbles:true,clipboardData:transfer}));
      input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:true}));
      setTimeout(()=>{observer.disconnect();reject(new Error("Echo ${terminalIndex} timed out"))},10000);
    }))()`, true);
    echoRoundTrips.push(elapsed);
  }
  const sortedEchoes = [...echoRoundTrips].sort((left, right) => left - right);
  const echoP95Milliseconds = sortedEchoes[Math.ceil(sortedEchoes.length * 0.95) - 1];
  const accessibility = await cdp("Accessibility.getFullAXTree");
  await cdp("HeapProfiler.collectGarbage");
  await Bun.sleep(1_000);
  const summary = await evaluate(`(()=>{const metrics=document.querySelector('[aria-label="Terminal utilities"]');return {
    panes: document.querySelectorAll("[data-pane-id]").length,
    terminals: document.querySelectorAll('[role="application"][aria-label="Terminal session"]').length,
    metrics: metrics?.textContent?.replace(/\\s+/g," ").trim(),
    metricSamples: metrics ? {
      input: Number(metrics.dataset.inputSamples),
      resize: Number(metrics.dataset.resizeSamples),
      frame: Number(metrics.dataset.frameSamples)
    } : null,
    p95: metrics ? {
      input: Number(metrics.dataset.inputP95),
      resize: Number(metrics.dataset.resizeP95),
      frame: Number(metrics.dataset.frameP95)
    } : null,
    alerts: [...document.querySelectorAll('[role="alert"]')].map(node=>node.textContent?.trim()).filter(Boolean)
  }})()`);
  if (summary.alerts.length) throw new Error(`Visible shell error: ${summary.alerts.join(" | ")}`);
  console.log(JSON.stringify({
    ...summary,
    echoRoundTrips,
    echoP95Milliseconds,
    accessibilityNodes: accessibility.nodes.length,
  }, null, 2));
  if (!leaveOpen) {
    await evaluate(`window.dispatchEvent(new CustomEvent("wheeljack:smoke-close")); true`);
  }
  socket.close();
  process.exit(0);
}
const agentPaneCount = await evaluate("document.querySelectorAll('[data-pane-id]').length");
const structuredInitial = agentFloodOnly ? "WHEELJACK_AGENT_FLOOD_1" : "WHEELJACK_STRUCTURED_INITIAL";
if (agentFloodOnly) {
  await evaluate(`(()=>{const button=[...document.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Reset metrics");button?.click();return Boolean(button)})()`);
  await cdp("HeapProfiler.collectGarbage");
  if (agentMemoryStatePath) {
    await writeFile(agentMemoryStatePath, JSON.stringify({ phase: "baseline", run: 0 }));
  }
  // Leave enough time for the PowerShell process-tree sampler to collect the
  // three baseline points its contract requires, even when CIM is slow.
  await Bun.sleep(5_000);
}
await evaluate(`(()=>{const input=document.querySelector("#onboarding-prompt");if(!input)return false;const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set;setter.call(input,${JSON.stringify(structuredInitial)});input.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:${JSON.stringify(structuredInitial)}}));return true})()`);
await waitFor(`document.querySelector("#onboarding-prompt")?.value===${JSON.stringify(structuredInitial)}`, "editable first-agent prompt");
await evaluate(`(()=>{const button=[...document.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Start first agent" && !node.disabled);button?.click();return Boolean(button)})()`);
await waitFor(`document.querySelectorAll("[data-pane-id]").length>${agentPaneCount} && Boolean(document.querySelector('textarea[aria-label="Agent prompt"]'))`, "first onboarding agent pane");
if (agentFloodOnly) {
  const startedAt = performance.now();
  for (let run = 1; run <= 6; run++) {
    if (agentMemoryStatePath) {
      await writeFile(agentMemoryStatePath, JSON.stringify({ phase: "running", run }));
    }
    await waitFor(
      `[...document.querySelectorAll('.chat [role="log"]')].some(node=>node.textContent?.includes(${JSON.stringify("FINAL_ERROR_")}+${JSON.stringify(String(run))})) && Boolean(document.querySelector('[data-agent-status="completed"]'))`,
      `completed agent flood ${run}`,
      120_000,
    );
    await cdp("HeapProfiler.collectGarbage");
    if (agentMemoryStatePath) {
      await writeFile(agentMemoryStatePath, JSON.stringify({ phase: "settle", run }));
    }
    // The paired Windows harness samples the full process tree through CIM;
    // give it the same deterministic three-sample window after every run.
    await Bun.sleep(5_000);
    if (run === 6) break;
    const prompt = `WHEELJACK_AGENT_FLOOD_${run + 1}`;
    await evaluate(`(()=>{const input=document.querySelector('textarea[aria-label="Agent prompt"]');if(!input)return false;const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set;setter.call(input,${JSON.stringify(prompt)});input.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:${JSON.stringify(prompt)}}));return true})()`);
    await waitFor(`Boolean(document.querySelector('button[aria-label="Send prompt"]:not(:disabled)'))`, `enabled agent flood ${run + 1}`);
    await evaluate(`document.querySelector('button[aria-label="Send prompt"]')?.click()`);
  }
  const summary = await evaluate(`(()=>{const metrics=document.querySelector('[aria-label="Terminal utilities"]');return {
    protocolUpdates: Number(metrics?.dataset.protocolUpdates ?? 0),
    toolTextBytes: [...document.querySelectorAll('.message.tool')].reduce((total,node)=>total+(node.textContent?.length??0),0),
    completed: Boolean(document.querySelector('[data-agent-status="completed"]')),
    finalTailVisible: [...document.querySelectorAll('.chat [role="log"]')].some(node=>node.textContent?.includes("FINAL_ERROR_6"))
  }})()`);
  summary.elapsedMilliseconds = performance.now() - startedAt;
  summary.runs = 6;
  summary.snapshotRatePerSecond = summary.protocolUpdates / Math.max(1, summary.elapsedMilliseconds / 1_000);
  if (!summary.completed || !summary.finalTailVisible || summary.protocolUpdates <= 0 || summary.snapshotRatePerSecond > 20) {
    throw new Error(`Agent flood contract failed: ${JSON.stringify(summary)}`);
  }
  console.log(JSON.stringify(summary));
  if (agentMemoryStatePath) {
    await writeFile(agentMemoryStatePath, JSON.stringify({ phase: "complete", run: 6 }));
  }
  if (!leaveOpen) {
    void evaluate(`window.dispatchEvent(new CustomEvent("wheeljack:smoke-close")); true`).catch(() => undefined);
    await Bun.sleep(200);
  }
  socket.close();
  process.exit(0);
}
const splitRatioBefore = await evaluate(`Number(document.querySelector('[role="separator"][aria-label^="Resize"]')?.getAttribute("aria-valuenow"))`);
await evaluate(`(()=>{const separator=document.querySelector('[role="separator"][aria-label^="Resize"]');separator?.focus();return Boolean(separator)})()`);
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
await waitFor(`Number(document.querySelector('[role="separator"][aria-label^="Resize"]')?.getAttribute("aria-valuenow"))!==${splitRatioBefore}`, "keyboard-adjustable split separator");
const structuredPrompt = "WHEELJACK_STRUCTURED_PROMPT";
try {
  await waitFor(`[...document.querySelectorAll('.chat [role="log"]')].some(node=>node.textContent?.includes("fixture:first:") && node.textContent?.includes(${JSON.stringify(structuredInitial)}))`, "structured-agent initial output", 15_000);
  await waitFor(`document.querySelectorAll(".chat .activity-group").length===1 && Boolean(document.querySelector(".chat .activity-group .tool-summary[aria-expanded='false']")) && Boolean(document.querySelector(".chat .agent-code-line")) && Boolean(document.querySelector(".chat .agent-code-block button[aria-label='Copy powershell code']")) && Boolean(document.querySelector(".chat-composer-footer"))`, "rolled-up structured activity, code, and composer presentation");
} catch (error) {
  const sessions = await coreCall("session_list", { limit: 100 });
  const fixture = sessions.find((session) => session.adapterId === "wheeljack-ui-fixture");
  const transcript = fixture ? await coreCall("session_transcript", { sessionId: fixture.id }) : null;
  throw new Error(`${error.message}\nFixture transcript: ${JSON.stringify(transcript)}`);
}
const selectionPolicy = await evaluate(`(()=>{const value=(selector)=>{const node=document.querySelector(selector);return node?getComputedStyle(node).userSelect:null};return {body:value("body"),titlebar:value(".wj-titlebar"),navigation:value(".wj-nav-item"),paneHeader:value(".pane-header"),prompt:value('textarea[aria-label="Agent prompt"]'),message:value(".agent-message-content"),code:value(".agent-code-line code")}})()`);
if (
  [selectionPolicy.body, selectionPolicy.titlebar, selectionPolicy.navigation, selectionPolicy.paneHeader].some((value) => value !== "none") ||
  [selectionPolicy.prompt, selectionPolicy.message, selectionPolicy.code].some((value) => value !== "text")
) {
  throw new Error(`Desktop text-selection policy failed: ${JSON.stringify(selectionPolicy)}`);
}
const onboardingDeadline = Date.now() + 15_000;
let onboardingSettings;
while (Date.now() < onboardingDeadline) {
  onboardingSettings = await coreCall("settings_export", {});
  if (onboardingSettings.desktopOnboardingVersion === 1) break;
  await Bun.sleep(100);
}
if (onboardingSettings?.desktopOnboardingVersion !== 1) {
  throw new Error(`Onboarding completion did not persist: ${JSON.stringify(onboardingSettings)}`);
}
const toolbarFixtureSessions = (await coreCall("session_list", { limit: 100 }))
  .filter((session) => session.adapterId === "wheeljack-ui-fixture");
if (toolbarFixtureSessions.length !== 1) {
  throw new Error(`Expected one toolbar fixture agent, found ${toolbarFixtureSessions.length}.`);
}
const [toolbarFixtureSession] = toolbarFixtureSessions;
if (!samePath(toolbarFixtureSession.cwd, openedProject.path)) {
  throw new Error(`Toolbar fixture escaped the shared checkout: ${toolbarFixtureSession.cwd}`);
}
await evaluate(`document.querySelector('button.wj-nav-item[aria-label="Home"]:not(:disabled)')?.click()`);
await waitFor(`Boolean(document.querySelector('button[aria-label^="More actions for"]'))`, "project overflow action");
await waitFor(`(()=>{const metrics=document.querySelector('[aria-label="Workspace metrics"]');return metrics?.textContent.includes("Live sessions")&&metrics.textContent.includes("Dirty projects")&&!metrics.textContent.includes("Changed files")&&Boolean(metrics.querySelector('button[aria-label$="Open inbox"]'))})()`, "workspace-scoped Home metrics");
await evaluate(`document.querySelector('button[aria-label$="Open inbox"]')?.click()`);
await waitFor(`[...document.querySelectorAll('[role="tab"]')].some(node=>node.textContent?.trim().startsWith("Inbox") && node.getAttribute("aria-selected")==="true")`, "Home inbox metric");
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await evaluate(`document.querySelector('.wj-session-list button')?.click()`);
await waitFor(`Boolean(document.querySelector('textarea[aria-label="Agent prompt"]'))`, "Home explicit live-session navigation");
await evaluate(`document.querySelector('button.wj-nav-item[aria-label="Home"]:not(:disabled)')?.click()`);
await waitFor(`Boolean(document.querySelector('button[aria-label^="More actions for"]'))`, "Home after metric navigation");
await clickElement('button[aria-label^="More actions for"]');
await waitFor(`[...document.querySelectorAll('[role="menuitem"]')].some(node=>node.textContent?.trim().startsWith("Remove from wheeljack"))`, "project removal menu item");
await evaluate(`(()=>{const item=[...document.querySelectorAll('[role="menuitem"]')].find(node=>node.textContent?.trim().startsWith("Remove from wheeljack"));item?.click();return Boolean(item)})()`);
await waitFor(`(()=>{const dialog=document.querySelector('[role="alertdialog"]');if(!dialog||!dialog.textContent?.includes("has active sessions"))return false;const remove=[...dialog.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Remove from wheeljack");const erase=[...dialog.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Delete from disk");return remove?.disabled===true&&!erase})()`, "active-session project removal guard");
await evaluate(`(()=>{const dialog=document.querySelector('[role="alertdialog"]');const cancel=[...dialog.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Cancel");cancel?.click();return Boolean(cancel)})()`);
await waitFor(`!document.querySelector('[role="alertdialog"]')`, "closed project removal dialog");
await evaluate(`document.querySelector('.wj-session-list button')?.click()`);
await waitFor(`Boolean(document.querySelector('textarea[aria-label="Agent prompt"]:not(:disabled)'))`, "structured-agent pane after project removal guard");
await evaluate(`(()=>{const input=document.querySelector('textarea[aria-label="Agent prompt"]');input?.focus();return Boolean(input)})()`);
await cdp("Input.insertText", { text: structuredPrompt });
await waitFor(`[...document.querySelectorAll("button")].some(node=>node.textContent?.trim()==="Send" && !node.disabled)`, "enabled structured follow-up");
await evaluate(`(()=>{const button=[...document.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Send" && !node.disabled);button?.click();return Boolean(button)})()`);
await waitFor(`[...document.querySelectorAll('.chat [role="log"]')].some(node=>node.textContent?.includes("fixture:second:") && node.textContent?.includes(${JSON.stringify(structuredPrompt)}))`, "structured-agent follow-up output");
await waitFor(`[...document.querySelectorAll(".chat .wj-action-card[data-variant='decision']")].some(node=>node.textContent?.includes("cargo test") && [...node.querySelectorAll("button")].some(button=>button.textContent?.trim()==="Approve"))`, "structured-agent scoped approval request");
if (chatScreenshotPath) {
  await cdp("Page.enable");
  await cdp("Page.bringToFront");
  const screenshot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(chatScreenshotPath, Buffer.from(screenshot.data, "base64"));
  socket.close();
  process.exit(0);
}
await evaluate(`(()=>{const button=[...document.querySelectorAll(".chat .wj-action-card-actions button")].find(node=>node.textContent?.trim()==="Approve");button?.click();return Boolean(button)})()`);
await waitFor(`[...document.querySelectorAll('.chat [role="log"]')].some(node=>node.textContent?.includes("fixture:approval:allow"))`, "structured-agent approval response");
await waitFor(`Boolean(document.querySelector('.chat .wj-action-card [aria-label="Approved"]'))`, "durable approval outcome");
await waitFor(`[...document.querySelectorAll(".chat .wj-action-card[data-variant='decision']")].some(node=>node.textContent?.includes("Which workspace should continue?") && Boolean(node.querySelector('textarea[aria-label="Answer the agent question"]')))`, "structured-agent question request");
await evaluate(`document.querySelector('button[aria-label^="Inbox,"]')?.click()`);
await waitFor(`(()=>{const panel=document.querySelector("#utility-panel");const labels=[...panel.querySelectorAll("button")].map(node=>node.textContent?.trim());return labels.includes("Answer in chat")&&!labels.includes("Approve")&&!labels.includes("Deny")})()`, "question-only inbox action");
await evaluate(`(()=>{const button=[...document.querySelectorAll("#utility-panel button")].find(node=>node.textContent?.trim()==="Answer in chat");button?.click();return Boolean(button)})()`);
await waitFor(`Boolean(document.querySelector('textarea[aria-label="Answer the agent question"]'))`, "question answer composer");
await evaluate(`document.querySelector('textarea[aria-label="Answer the agent question"]')?.focus()`);
await cdp("Input.insertText", { text: "Primary" });
await evaluate(`(()=>{const button=[...document.querySelectorAll(".chat .wj-action-card-actions button")].find(node=>node.textContent?.trim()==="Send answer");button?.click();return Boolean(button)})()`);
await waitFor(`[...document.querySelectorAll('.chat [role="log"]')].some(node=>node.textContent?.includes("fixture:question:allow"))`, "structured-agent question answer");
await waitFor(`Boolean(document.querySelector('[data-agent-status="completed"] textarea[aria-label="Agent prompt"]'))`, "composer after question");
const cancelPrompt = "WHEELJACK_CANCEL_PROMPT";
const retainedDraft = "WHEELJACK_RETAINED_DRAFT";
await evaluate(`document.querySelector('textarea[aria-label="Agent prompt"]')?.focus()`);
await cdp("Input.insertText", { text: cancelPrompt });
await evaluate(`document.querySelector('button[aria-label="Send prompt"]')?.click()`);
await waitFor(`[...document.querySelectorAll('.chat [role="log"]')].some(node=>node.textContent?.includes("fixture:partial:") && node.textContent?.includes(${JSON.stringify(cancelPrompt)}))`, "partial output before cancellation");
await waitFor(`document.querySelector('textarea[aria-label="Agent prompt"]')?.value===""`, "accepted prompt clears unchanged draft");
await evaluate(`document.querySelector('textarea[aria-label="Agent prompt"]')?.focus()`);
await cdp("Input.insertText", { text: retainedDraft });
await waitFor(`document.querySelector('textarea[aria-label="Agent prompt"]')?.value===${JSON.stringify(retainedDraft)} && Boolean(document.querySelector('button[aria-label="Stop agent turn"]:not(:disabled)'))`, "active-turn draft retained behind stop control");
await evaluate(`document.querySelector('button[aria-label="Stop agent turn"]')?.click()`);
await waitFor(`Boolean(document.querySelector('[data-agent-status="canceled"]')) && document.querySelector('textarea[aria-label="Agent prompt"]')?.value===${JSON.stringify(retainedDraft)}`, "canceled turn preserves draft and pane");
await waitFor(`document.querySelector('button[aria-label="Send prompt"]')?.disabled===false`, "follow-up enabled after cancellation");
await evaluate(`document.querySelector('button[aria-label="Send prompt"]')?.click()`);
await waitFor(`[...document.querySelectorAll('.chat [role="log"]')].some(node=>node.textContent?.includes("fixture:recovered:") && node.textContent?.includes(${JSON.stringify(retainedDraft)}))`, "same-session follow-up after cancellation");
if (chatOnly) {
  await waitFor(`Boolean(document.querySelector('[data-agent-status="completed"]'))`, "completed recovered agent turn");
  const summary = await evaluate(`(()=>(
    {
      approved: Boolean(document.querySelector('.wj-action-card [aria-label="Approved"]')),
      answered: Boolean(document.querySelector('.wj-action-card [aria-label="Answered"]')),
      recoveredDraftCleared: document.querySelector('textarea[aria-label="Agent prompt"]')?.value==="",
      recovered: [...document.querySelectorAll('.chat [role="log"]')].some(node=>node.textContent?.includes("fixture:recovered:"))
    }
  ))()`);
  if (!summary.approved || !summary.answered || !summary.recoveredDraftCleared || !summary.recovered) {
    throw new Error(`Structured chat summary failed: ${JSON.stringify(summary)}`);
  }
  console.log(JSON.stringify(summary));
  if (!leaveOpen) await evaluate(`window.dispatchEvent(new CustomEvent("wheeljack:smoke-close")); true`);
  socket.close();
  process.exit(0);
}
if (await evaluate(`Boolean(document.querySelector('button[aria-label="Collapse"]'))`)) {
  await evaluate(`document.querySelector('button[aria-label="Collapse"]')?.click()`);
  await waitFor(`Boolean(document.querySelector('button[aria-label="Expand"]')) && [...document.querySelectorAll(".wj-sidebar button")].every(node=>Boolean(node.getAttribute("aria-label")))`, "accessible collapsed sidebar");
  await evaluate(`document.querySelector('button[aria-label="Expand"]')?.click()`);
  await waitFor(`Boolean(document.querySelector('button[aria-label="Collapse"]'))`, "expanded sidebar");
} else {
  await waitFor(`[...document.querySelectorAll(".wj-sidebar .wj-nav-item")].every(node=>Boolean(node.getAttribute("aria-label")))`, "accessible compact sidebar");
}
const workOnlyCanvases = await coreCall("canvas_list_project", { projectId: openedProject.id });
if (workOnlyCanvases.some((canvas) => canvas.nodes?.some((node) => node.kind === "ops_state"))) {
  throw new Error("Work-only use created Plan state before Plan was opened.");
}
for (const name of ["KANBAN.md", "PRD.md", "TDD.md"]) {
  if (await pathExists(join(projectPath, name))) {
    throw new Error(`Work-only use created ${name} before Plan was opened.`);
  }
}
if (await pathExists(join(projectPath, ".wheeljack", "coordination"))) {
  throw new Error("Work-only use created a coordination board before Plan was opened.");
}
const localExclude = await Bun.file(join(projectPath, ".git", "info", "exclude")).text();
if (["KANBAN.md", "PRD.md", "TDD.md"].some((name) => localExclude.includes(name))) {
  throw new Error("Reading project documents changed the local Git exclusions.");
}
await evaluate(`document.querySelector(".wj-plan-mode-trigger")?.click()`);
await waitFor(`Boolean(document.querySelector(".wj-floor"))`, "default Ops Floor");
await waitFor(`Boolean(document.querySelector(".wj-floor-operator")) && Boolean(document.querySelector(".wj-floor-needs")) && Boolean(document.querySelector(".wj-floor-live")) && Boolean(document.querySelector(".wj-floor-ready")) && Boolean(document.querySelector(".wj-floor-activity"))`, "operator cockpit regions");
await waitFor(`Boolean(document.querySelector('.wj-floor-agent-matrix, .wj-floor-agent-empty'))`, "stable agent matrix state");
await waitFor(`(()=>{const floor=document.querySelector('.wj-floor');return floor&&floor.scrollHeight<=floor.clientHeight+1})()`, "wide Floor cockpit without page scrolling");
await showRunGraph();
for (const range of ["10m", "4h", "40m"]) {
  await evaluate(`(()=>{const button=[...document.querySelectorAll('.wj-run-graph-range button')].find(node=>node.textContent?.trim()===${JSON.stringify(range)});button?.focus();return Boolean(button)})()`);
  await waitFor(`document.activeElement?.textContent?.trim()===${JSON.stringify(range)}`, `focused Run Graph ${range} range`);
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await waitFor(`document.querySelector('.wj-run-graph-range button[aria-pressed="true"]')?.textContent?.trim()===${JSON.stringify(range)}`, `Run Graph ${range} keyboard range`);
}
await cdp("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
await waitFor(`(()=>{const scroll=document.querySelector('.wj-run-graph-scroll');const plot=document.querySelector('.wj-run-graph-plot');const floor=document.querySelector('.wj-floor');return scroll&&plot&&floor&&plot.scrollWidth>=720&&scroll.scrollWidth>scroll.clientWidth&&floor.scrollWidth<=floor.clientWidth+1})()`, "900 by 700 Floor without page-level horizontal clipping");
await cdp("Emulation.setDeviceMetricsOverride", { width: 760, height: 700, deviceScaleFactor: 1, mobile: false });
await waitFor(`(()=>{const needs=document.querySelector('.wj-floor-needs');const agents=document.querySelector('.wj-floor-live');const ready=document.querySelector('.wj-floor-ready');const activity=document.querySelector('.wj-floor-activity');const floor=document.querySelector('.wj-floor');if(!needs||!agents||!ready||!activity||!floor)return false;const tops=[needs,agents,ready,activity].map(node=>node.getBoundingClientRect().top);return tops.every((top,index)=>index===0||top>tops[index-1])&&getComputedStyle(floor).overflowY!=="hidden"})()`, "below-820 container stack ordering");
await cdp("Emulation.clearDeviceMetricsOverride");
await selectProjectView("Spec");
await waitFor(`[...document.querySelectorAll('[role="tab"]')].some(node=>node.textContent?.trim()==="Technical design")`, "combined Spec surface");
await selectLabeledTab("Specification documents", "Technical design");
await waitFor(`[...document.querySelectorAll("h1")].some(node=>node.textContent?.trim()==="Technical design")`, "technical design document surface");
await selectProjectView("Plan");
await waitFor(`Boolean(document.querySelector(".wj-board"))`, "Ops Board");
if (await evaluate(`[...document.querySelectorAll("button")].some(node=>node.textContent?.trim()==="Create KANBAN.md")`)) {
  await evaluate(`(()=>{const button=[...document.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Create KANBAN.md");button?.click();return Boolean(button)})()`);
  await waitFor(`[...document.querySelectorAll('[role="alertdialog"]')].some(node=>node.textContent?.includes("Create KANBAN.md"))`, "KANBAN creation preview");
  await evaluate(`(()=>{const button=[...document.querySelectorAll('[role="alertdialog"] button')].find(node=>node.textContent?.trim().startsWith("Accept & write"));button?.click();return Boolean(button)})()`);
  await waitFor(`![...document.querySelectorAll('[role="alertdialog"]')].some(node=>node.textContent?.includes("Create KANBAN.md"))`, "created KANBAN document");
}
await waitFor(`Boolean(document.querySelector(".wj-new-task-action:not(:disabled)"))`, "enabled new-task action");
await evaluate(`document.querySelector(".wj-new-task-action")?.click()`);
await waitFor(`Boolean(document.querySelector("#task-brief"))`, "open task composer");
const opsTaskTitle = "WHEELJACK_OPS_PERSISTENCE";
const editedOpsTaskTitle = `${opsTaskTitle}_EDITED`;
const opsTaskDefinition = "The isolated lane is self-checked, reconciled, integrated, and removed safely.";
const opsVerificationCommand = "git diff --check";
const opsTaskBrief = `${opsTaskTitle}: create a complete isolated task-lane persistence contract.`;
await rm(taskCompletionPath, { force: true });
await evaluate(`(()=>{const input=document.querySelector("#task-brief");if(!input)return false;const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set;setter.call(input,${JSON.stringify(opsTaskBrief)});input.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:${JSON.stringify(opsTaskBrief)}}));return true})()`);
await waitFor(`document.querySelector("#task-brief")?.value===${JSON.stringify(opsTaskBrief)}`, "controlled general task brief");
await evaluate(`(()=>{const button=[...document.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Create tasks" && !node.disabled);button?.click();return Boolean(button)})()`);
await waitFor(`[...document.querySelectorAll(".wj-task-card")].some(node=>node.textContent?.includes(${JSON.stringify(opsTaskTitle)}))`, "created Ops task");
await waitFor(`!document.querySelector("#task-brief")`, "task composer closes after generated cards persist");
await waitFor(`Boolean(document.querySelector(${JSON.stringify(`button[aria-label="Task actions: ${opsTaskTitle}"]:not(:disabled)`)}))`, "enabled task actions");
await evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(`button[aria-label="Task actions: ${opsTaskTitle}"]:not(:disabled)`)});button?.focus();return Boolean(button)})()`);
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await waitFor(`[...document.querySelectorAll('[role="menuitem"]')].some(node=>node.textContent?.trim()==="Edit contract…")`, "task contract edit action");
await evaluate(`(()=>{const item=[...document.querySelectorAll('[role="menuitem"]')].find(node=>node.textContent?.trim()==="Edit contract…");item?.click();return Boolean(item)})()`);
await waitFor(`document.querySelector("#edit-task-definition")?.value===${JSON.stringify(opsTaskDefinition)} && document.querySelector("#edit-task-verification")?.value===${JSON.stringify(opsVerificationCommand)}`, "persisted editable verification contract");
await evaluate(`(()=>{const button=[...document.querySelectorAll('[role="alertdialog"] button')].find(node=>node.textContent?.trim()==="Cancel");button?.click();return Boolean(button)})()`);
await waitFor(`!document.querySelector("#edit-task-definition")`, "closed verification contract editor");
await evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(`button[aria-label="Task actions: ${opsTaskTitle}"]:not(:disabled)`)});button?.focus();return Boolean(button)})()`);
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await waitFor(`[...document.querySelectorAll('[role="menuitem"]')].some(node=>node.textContent?.trim()==="Edit task")`, "task edit action");
await evaluate(`(()=>{const item=[...document.querySelectorAll('[role="menuitem"]')].find(node=>node.textContent?.trim()==="Edit task");item?.click();return Boolean(item)})()`);
await waitFor(`[...document.querySelectorAll('.wj-task-card input[aria-label^="Task title:"]')].some(node=>node.value===${JSON.stringify(opsTaskTitle)})`, "editable Ops task");
await evaluate(`(()=>{const input=[...document.querySelectorAll('.wj-task-card input[aria-label^="Task title:"]')].find(node=>node.value===${JSON.stringify(opsTaskTitle)});if(!input)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;setter.call(input,${JSON.stringify(editedOpsTaskTitle)});input.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:${JSON.stringify(editedOpsTaskTitle)}}));return true})()`);
await waitFor(`[...document.querySelectorAll('.wj-task-card input[aria-label^="Task title:"]')].some(node=>node.value===${JSON.stringify(editedOpsTaskTitle)})`, "editable Ops task title");
const finishedOpsEdit = await evaluate(`(()=>{const input=[...document.querySelectorAll('.wj-task-card input[aria-label^="Task title:"]')].find(node=>node.value===${JSON.stringify(editedOpsTaskTitle)});const button=[...input?.closest(".wj-task-card")?.querySelectorAll("button")??[]].find(node=>node.textContent?.trim()==="Done");button?.click();return Boolean(button)})()`);
if (!finishedOpsEdit) throw new Error("The edited Ops task did not expose its Done action.");
await waitFor(`(()=>{const card=[...document.querySelectorAll(".wj-task-card")].find(node=>node.textContent?.includes(${JSON.stringify(editedOpsTaskTitle)}));return [...card?.querySelectorAll("button")??[]].some(node=>node.textContent?.trim()==="Start fresh task agent")})()`, "primary isolated task action");
const startedIsolatedAgent = await evaluate(`(()=>{const card=[...document.querySelectorAll(".wj-task-card")].find(node=>node.textContent?.includes(${JSON.stringify(editedOpsTaskTitle)}));const button=[...card?.querySelectorAll("button")??[]].find(node=>node.textContent?.trim()==="Start fresh task agent");button?.click();return Boolean(button)})()`);
if (!startedIsolatedAgent) throw new Error("The edited Ops task did not start its isolated agent.");
if (!laneStatePath) throw new Error("--lane-state is required for the task-lane runtime smoke.");

const waitForTaskLane = async (title) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const canvases = await coreCall("canvas_list_project", { projectId: openedProject.id });
    for (const canvas of canvases) {
      const stored = await coreCall("canvas_get", { canvasId: canvas.id });
      const ops = await coreCall("ops_project_state_get", { projectId: openedProject.id });
      const card = ops?.state?.cards?.find((candidate) => candidate.title === title);
      const taskNodeId = card?.assigneeIds?.[0];
      const taskNode = stored.nodes?.find((node) => node.id === taskNodeId);
      if (!card?.taskLane || !taskNodeId || !taskNode?.data?.sessionId) continue;
      const sessions = await coreCall("session_list", { limit: 100 });
      const session = sessions.find((candidate) =>
        candidate.id === taskNode.data.sessionId && candidate.nodeId === taskNodeId);
      if (session) return { canvas, stored, ops, card, taskNode, session };
    }
    await Bun.sleep(100);
  }
  throw new Error(`The isolated task lane for ${title} did not persist its card, node, and session metadata.`);
};
const laneFixture = await waitForTaskLane(editedOpsTaskTitle);
await waitFor(`(()=>{const card=[...document.querySelectorAll('.wj-task-card[data-presence-phase="working"]')].find(node=>node.textContent?.includes(${JSON.stringify(editedOpsTaskTitle)}));return Boolean(card)})()`, "live Plan task presence");
await selectProjectView("Run");
await waitFor(`(()=>{const item=document.querySelector('.wj-floor-now-list > button[data-presence-phase="working"]');return item?.textContent?.includes(${JSON.stringify(editedOpsTaskTitle)})})()`, "live Run Now item");
await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await waitFor(`getComputedStyle(document.querySelector('.wj-floor-now-list > button'), '::after').animationName==="none"`, "reduced-motion live presence");
await cdp("Emulation.setEmulatedMedia", { features: [] });
await selectProjectView("Plan");
await waitFor(`Boolean(document.querySelector(".wj-board"))`, "Plan after live presence proof");
const waitForPersistedCard = async (cardId, predicate, description, timeoutMilliseconds = 30_000) => {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastCard;
  while (Date.now() < deadline) {
    const [stored, ops] = await Promise.all([
      coreCall("canvas_get", { canvasId: laneFixture.canvas.id }),
      coreCall("ops_project_state_get", { projectId: openedProject.id }),
    ]);
    const card = ops?.state?.cards?.find((candidate) => candidate.id === cardId);
    lastCard = card;
    if (card && predicate(card, ops.state, stored)) return { card, state: ops.state, stored };
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(lastCard)}`);
};

const { card: laneCard, taskNode: laneTaskNode, session: laneSession } = laneFixture;
const taskLane = laneCard.taskLane;
if (
  taskLane.kind !== "git-worktree" ||
  taskLane.closedAt ||
  !/^wheeljack\/task-[0-9a-f]{20}$/.test(taskLane.branch) ||
  !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(taskLane.baseCommit)
) {
  throw new Error(`Invalid task-lane metadata: ${JSON.stringify(taskLane)}`);
}
if (
  samePath(taskLane.worktreePath, openedProject.path) ||
  samePath(taskLane.cwd, openedProject.path) ||
  !samePath(laneSession.cwd, taskLane.cwd) ||
  !samePath(laneTaskNode.data.cwd, taskLane.cwd) ||
  laneTaskNode.data.sessionId !== laneSession.id
) {
  throw new Error(`Task lane, node, and session cwd metadata diverged: ${JSON.stringify({ taskLane, node: laneTaskNode.data, session: laneSession })}`);
}
const taskWorktreeStatus = await coreCall("git_status", {
  path: openedProject.path,
  includeWorktrees: true,
});
const linkedWorktrees = taskWorktreeStatus.worktrees.filter((worktree) =>
  !samePath(worktree.path, openedProject.path));
if (
  linkedWorktrees.length !== 1 ||
  !samePath(linkedWorktrees[0].path, taskLane.worktreePath) ||
  linkedWorktrees[0].branch !== taskLane.branch ||
  linkedWorktrees[0].head !== taskLane.baseCommit
) {
  throw new Error(`Expected one registered task worktree: ${JSON.stringify(taskWorktreeStatus.worktrees)}`);
}

const laneTranscriptDeadline = Date.now() + 15_000;
let laneTranscript = "";
while (Date.now() < laneTranscriptDeadline && !laneTranscript.includes("fixture:lane:")) {
  laneTranscript = (await coreCall("session_transcript", { sessionId: laneSession.id })).text;
  if (!laneTranscript.includes("fixture:lane:")) await Bun.sleep(100);
}
if (
  !laneTranscript.includes(`fresh, dedicated worker for wheeljack task ${laneCard.id}`) ||
  !laneTranscript.includes("Do not claim unrelated tasks or reuse this session")
) {
  throw new Error(`The isolated fixture agent did not remain on the task prompt: ${laneTranscript}`);
}

const laneProofPath = join(taskLane.cwd, "lane-proof.txt");
const primaryProofPath = join(openedProject.path, "primary-proof.txt");
const primaryProofBaseline = await Bun.file(primaryProofPath).arrayBuffer();
await Bun.write(laneProofPath, `${await Bun.file(laneProofPath).text()}WHEELJACK_LANE_ONLY\n`);
await Bun.write(primaryProofPath, `${await Bun.file(primaryProofPath).text()}WHEELJACK_PRIMARY_ONLY\n`);
const isolatedReview = await coreCall("git_worktree_review", {
  req: {
    projectPath: openedProject.path,
    worktreePath: taskLane.worktreePath,
    expectedBranch: taskLane.branch,
    baseCommit: taskLane.baseCommit,
  },
});
if (
  isolatedReview.branch !== taskLane.branch ||
  isolatedReview.baseCommit !== taskLane.baseCommit ||
  !/^[0-9a-f]{40}$/.test(isolatedReview.snapshotId) ||
  !isolatedReview.changedFiles.includes("lane-proof.txt") ||
  isolatedReview.changedFiles.includes("primary-proof.txt") ||
  !isolatedReview.text.includes("WHEELJACK_LANE_ONLY") ||
  isolatedReview.text.includes("WHEELJACK_PRIMARY_ONLY")
) {
  throw new Error(`Task review crossed checkout boundaries: ${JSON.stringify(isolatedReview)}`);
}

await Bun.write(primaryProofPath, primaryProofBaseline);
for (const args of [
  ["add", "--", "lane-proof.txt"],
  ["commit", "--quiet", "-m", "Complete isolated task-lane smoke"],
]) {
  const result = Bun.spawnSync(["git", "-C", taskLane.cwd, ...args]);
  if (result.exitCode !== 0) throw new Error(`Could not commit the task-lane fixture: ${result.stderr.toString()}`);
}
const evidenceBoard = await coreCall("coordination_board_sync", {
  cwd: openedProject.path,
  callsigns: [laneTaskNode.title],
  tasks: [{
    id: laneCard.id,
    title: editedOpsTaskTitle,
    detail: laneCard.detail ?? "",
    status: "completed",
    assignees: [laneTaskNode.title],
    priority: laneCard.priority,
  }],
});
await coreCall("coordination_board_ensure", {
  cwd: openedProject.path,
  boardId: evidenceBoard.boardId,
  callsigns: [laneTaskNode.title],
  agentEvent: {
    callsign: laneTaskNode.title,
    runId: `smoke-run-${laneCard.id}`,
    taskId: laneCard.id,
    task: editedOpsTaskTitle,
    status: "completed",
    expectedFiles: ["lane-proof.txt"],
    note: "Packaged task implementation and self-check completed.",
    handoff: 'wheeljack.report {"summary":"Completed isolated task-lane smoke","checks":["git diff --check — passed"],"risks":[]}\nCommitted implementation evidence is ready for reconciliation.',
  },
});
await Bun.write(taskCompletionPath, "complete\n");
const approvedTaskState = await waitForPersistedCard(
  laneCard.id,
  (card, state) => card.reconciliation?.status === "integrated" && Boolean(card.completedAt) && state.columns?.some((column) => column.id === card.columnId && column.role === "done"),
  "automatic task reconciliation",
  60_000,
);
const integratedLaneProof = await Bun.file(join(openedProject.path, "lane-proof.txt")).text();
const restoredPrimaryProof = await Bun.file(primaryProofPath).text();
if (!integratedLaneProof.includes("WHEELJACK_LANE_ONLY") || restoredPrimaryProof.includes("WHEELJACK_PRIMARY_ONLY")) {
  throw new Error("Automatic reconciliation did not integrate only the isolated task commit.");
}
const removedTaskState = await waitForPersistedCard(
  laneCard.id,
  (card) => Boolean(card.taskLane?.closedAt),
  "automatic task worktree cleanup",
  60_000,
);
await evaluate(`document.querySelector(${JSON.stringify(`button[aria-label="${openedProject.name}"]`)})?.click()`);
await waitFor(`Boolean(document.querySelector('textarea[aria-label="Agent prompt"]'))`, "Work surface after reconciled task cleanup");
await waitFor(`!document.querySelector(${JSON.stringify(`[data-pane-id="${laneTaskNode.id}"]`)})`, "automatically removed reconciled task agent pane");
const archivedTaskTranscript = await coreCall("session_transcript", { sessionId: laneSession.id });
if (!archivedTaskTranscript.text.includes(`fresh, dedicated worker for wheeljack task ${laneCard.id}`)) {
  throw new Error("The automatically removed task pane did not preserve its transcript history.");
}
const removedWorktreeStatus = await coreCall("git_status", {
  path: openedProject.path,
  includeWorktrees: true,
});
if (
  !approvedTaskState.card.completedAt ||
  !removedTaskState.card.taskLane?.closedAt ||
  removedWorktreeStatus.worktrees.some((worktree) => samePath(worktree.path, taskLane.worktreePath)) ||
  await Bun.file(laneProofPath).exists()
) {
  throw new Error(`The reconciled task lane was not removed safely: ${JSON.stringify({ card: removedTaskState.card, worktrees: removedWorktreeStatus.worktrees })}`);
}
await evaluate(`document.querySelector(".wj-plan-mode-trigger")?.click()`);
await waitFor(`Boolean(document.querySelector('[aria-labelledby="ops-surface-heading"]'))`, "Plan after task agent cleanup");
await selectProjectView("Run");
await waitFor(`Boolean(document.querySelector(".wj-floor"))`, "Ops Floor after task agent cleanup");
await showRunGraph();
await waitFor(`[...document.querySelectorAll('.wj-run-graph-node')].some(node=>node.getAttribute('aria-label')?.includes(${JSON.stringify(editedOpsTaskTitle)}))`, "recorded Run Graph node");
await evaluate(`(()=>{const node=[...document.querySelectorAll('.wj-run-graph-node')].find(candidate=>candidate.getAttribute('aria-label')?.includes(${JSON.stringify(editedOpsTaskTitle)}));node?.click();return Boolean(node)})()`);
await waitFor(`Boolean(document.querySelector('.wj-run-graph-node[aria-pressed="true"]')) && Boolean(document.querySelector(${JSON.stringify(`.wj-floor-docked-inspector[data-card-id="${laneCard.id}"]`)}))`, "Run Graph node opens matching task evidence");
await selectProjectView("Plan");
await waitFor(`Boolean(document.querySelector(".wj-board"))`, "Ops board after task agent cleanup");
await waitFor(`(()=>{const card=[...document.querySelectorAll(".wj-task-card")].find(node=>node.textContent?.includes(${JSON.stringify(editedOpsTaskTitle)}));return card?.textContent?.includes("Lane removed")})()`, "removed task lane badge");
await selectProjectView("Spec");
await waitFor(`[...document.querySelectorAll('[role="tab"]')].some(node=>node.textContent?.trim()==="Requirements")`, "Spec requirements tab");
await selectLabeledTab("Specification documents", "Requirements");
await waitFor(`[...document.querySelectorAll("h1")].some(node=>node.textContent?.trim()==="Product requirements")`, "PRD surface");
await evaluate(`(()=>{const button=[...document.querySelectorAll("button")].find(node=>["Create PRD.md","Use template"].includes(node.textContent?.trim()));button?.click();return Boolean(button)})()`);
await waitFor(`[...document.querySelectorAll('[role="alertdialog"] button')].some(node=>node.textContent?.trim().startsWith("Accept & write"))`, "PRD write preview");
await evaluate(`(()=>{const button=[...document.querySelectorAll('[role="alertdialog"] button')].find(node=>node.textContent?.trim().startsWith("Accept & write"));button?.click();return Boolean(button)})()`);
await waitFor(`document.querySelector('textarea[aria-label="PRD document editor"]')?.value.includes("## Acceptance criteria")`, "generated PRD");
await waitFor(`[...document.querySelectorAll("button")].some(node=>node.textContent?.trim()==="Add starter tasks" && !node.disabled)`, "enabled PRD task creation");
await evaluate(`(()=>{const button=[...document.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Add starter tasks" && !node.disabled);button?.click();return Boolean(button)})()`);
await selectProjectView("Plan");
await waitFor(`document.querySelectorAll(".wj-task-card").length===3`, "PRD-derived Ops tasks");
await waitFor(`Boolean([...document.querySelectorAll('button[aria-label^="Task actions:"]:not(:disabled)')].find(node=>node.getAttribute("aria-label")!==${JSON.stringify(`Task actions: ${editedOpsTaskTitle}`)}))`, "enabled derived-task actions");
await evaluate(`(()=>{const button=[...document.querySelectorAll('button[aria-label^="Task actions:"]:not(:disabled)')].find(node=>node.getAttribute("aria-label")!==${JSON.stringify(`Task actions: ${editedOpsTaskTitle}`)});button?.focus();return Boolean(button)})()`);
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await waitFor(`[...document.querySelectorAll('[role="menuitem"]')].some(node=>node.textContent?.trim()==="Delete task")`, "task delete action");
await evaluate(`(()=>{const item=[...document.querySelectorAll('[role="menuitem"]')].find(node=>node.textContent?.trim()==="Delete task");item?.click();return Boolean(item)})()`);
await waitFor(`[...document.querySelectorAll('[role="menuitem"]')].some(node=>node.textContent?.trim()==="Confirm delete")`, "armed task deletion");
await evaluate(`(()=>{const item=[...document.querySelectorAll('[role="menuitem"]')].find(node=>node.textContent?.trim()==="Confirm delete");item?.click();return Boolean(item)})()`);
await waitFor(`document.querySelectorAll(".wj-task-card").length===2`, "two-click task deletion");
const opsDeadline = Date.now() + 15_000;
let opsStored = false;
let opsDiagnostic;
while (Date.now() < opsDeadline) {
  const canvases = await coreCall("canvas_list_project", { projectId: openedProject.id });
  const stored = canvases[0]
    ? await coreCall("ops_project_state_get", { projectId: openedProject.id })
    : undefined;
  opsDiagnostic = stored;
  opsStored = Boolean(
    stored?.state?.cards?.some((card) => card.title === editedOpsTaskTitle) &&
    typeof stored?.state?.prd === "string" &&
    stored.state.prd.includes("## Acceptance criteria"),
  );
  if (opsStored) break;
  await Bun.sleep(100);
}
if (!opsStored) throw new Error(`The Ops board and PRD did not persist to canonical state: ${JSON.stringify(opsDiagnostic)}`);
let coordinationTaskProjection = "";
while (Date.now() < opsDeadline) {
  const glob = new Bun.Glob(".wheeljack/coordination/**/tasks.md");
  for await (const relative of glob.scan({ cwd: projectPath, onlyFiles: true, dot: true })) {
    const text = await Bun.file(`${projectPath}/${relative}`).text();
    if (text.includes(editedOpsTaskTitle)) coordinationTaskProjection = text;
  }
  if (coordinationTaskProjection) break;
  await Bun.sleep(100);
}
if (!coordinationTaskProjection) throw new Error("The Ops board did not sync its shared tasks.md projection.");
const kanbanPath = join(openedProject.path, "KANBAN.md");
if (await pathExists(kanbanPath)) {
  const kanbanText = await Bun.file(kanbanPath).text();
  if (kanbanText.includes(taskLane.worktreePath) || kanbanText.includes(taskLane.cwd)) {
    throw new Error("KANBAN.md leaked machine-local task-lane paths.");
  }
}
const recoveryTaskTitle = "WHEELJACK_RECOVERY_LANE";
await evaluate(`document.querySelector(".wj-new-task-action")?.click()`);
await waitFor(`Boolean(document.querySelector("#task-brief"))`, "recovery task composer");
const recoveryTaskBrief = `${recoveryTaskTitle}: create a recoverable isolated lane task with repository-valid verification.`;
await evaluate(`(()=>{const input=document.querySelector("#task-brief");if(!input)return false;const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set;setter.call(input,${JSON.stringify(recoveryTaskBrief)});input.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:${JSON.stringify(recoveryTaskBrief)}}));return true})()`);
await waitFor(`document.querySelector("#task-brief")?.value===${JSON.stringify(recoveryTaskBrief)}`, "controlled recovery task brief");
await evaluate(`(()=>{const button=[...document.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Create tasks" && !node.disabled);button?.click();return Boolean(button)})()`);
await waitFor(`[...document.querySelectorAll(".wj-task-card")].some(node=>node.textContent?.includes(${JSON.stringify(recoveryTaskTitle)}))`, "created recovery task");
await waitFor(`!document.querySelector("#task-brief")`, "recovery composer closes after card persistence");
const startedRecoveryAgent = await evaluate(`(()=>{const card=[...document.querySelectorAll(".wj-task-card")].find(node=>node.textContent?.includes(${JSON.stringify(recoveryTaskTitle)}));const button=[...card?.querySelectorAll("button")??[]].find(node=>node.textContent?.trim()==="Start fresh task agent");button?.click();return Boolean(button)})()`);
if (!startedRecoveryAgent) throw new Error("The recovery task did not start its isolated agent.");
const recoveryFixture = await waitForTaskLane(recoveryTaskTitle);
const { card: recoveryCard, taskNode: recoveryTaskNode, session: recoverySession } = recoveryFixture;
const recoveryLane = recoveryCard.taskLane;
if (
  recoveryLane.kind !== "git-worktree" ||
  recoveryLane.closedAt ||
  !samePath(recoveryLane.cwd, recoveryTaskNode.data.cwd) ||
  !samePath(recoveryLane.cwd, recoverySession.cwd) ||
  recoveryTaskNode.data.sessionId !== recoverySession.id
) {
  throw new Error(`Invalid recovery task-lane metadata: ${JSON.stringify(recoveryFixture)}`);
}
const recoveryWorktreeStatus = await coreCall("git_status", {
  path: openedProject.path,
  includeWorktrees: true,
});
const recoveryLinkedWorktrees = recoveryWorktreeStatus.worktrees.filter((worktree) =>
  !samePath(worktree.path, openedProject.path));
if (
  recoveryLinkedWorktrees.length !== 1 ||
  !samePath(recoveryLinkedWorktrees[0].path, recoveryLane.worktreePath) ||
  recoveryLinkedWorktrees[0].branch !== recoveryLane.branch
) {
  throw new Error(`Expected only the recovery task worktree: ${JSON.stringify(recoveryWorktreeStatus.worktrees)}`);
}
const recoveryTranscriptDeadline = Date.now() + 15_000;
let recoveryTranscript = "";
while (Date.now() < recoveryTranscriptDeadline && !recoveryTranscript.includes("fixture:lane:")) {
  recoveryTranscript = (await coreCall("session_transcript", { sessionId: recoverySession.id })).text;
  if (!recoveryTranscript.includes("fixture:lane:")) await Bun.sleep(100);
}
if (!recoveryTranscript.includes(`fresh, dedicated worker for wheeljack task ${recoveryCard.id}`)) {
  throw new Error(`The recovery fixture agent did not remain on its task prompt: ${recoveryTranscript}`);
}
await Bun.write(join(recoveryLane.cwd, "recovery-proof.txt"), "WHEELJACK_RECOVERY_LANE_ONLY\n");
await Bun.write(laneStatePath, JSON.stringify({
  projectId: openedProject.id,
  projectName: openedProject.name,
  projectPath: openedProject.path,
  canvasId: recoveryFixture.canvas.id,
  cardId: recoveryCard.id,
  cardTitle: recoveryCard.title,
  taskNodeId: recoveryTaskNode.id,
  lane: recoveryLane,
  sessionIds: [recoverySession.id],
}, null, 2));
await evaluate(`(()=>{const button=[...document.querySelectorAll('button[aria-label^="Inbox,"]')].find(node=>!node.disabled&&node.getClientRects().length);if(button?.getAttribute("aria-pressed")!=="true")button?.click();return Boolean(button)})()`);
await waitFor(`[...document.querySelectorAll('[role="tab"]')].some(node=>node.textContent?.trim().startsWith("Inbox") && node.getAttribute("aria-selected")==="true")`, "agent inbox drawer");
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await evaluate(`document.querySelector('button[aria-label="Git"]')?.click()`);
await waitFor(`[...document.querySelectorAll('[role="tab"]')].some(node=>node.textContent?.trim()==="Git" && node.getAttribute("aria-selected")==="true") && [...document.querySelectorAll("button")].some(node=>node.textContent?.trim()==="Refresh")`, "Git drawer");
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
let durableAgentStatus;
const activityDeadline = Date.now() + 15_000;
while (Date.now() < activityDeadline) {
  const events = await coreCall("activity_list", { limit: 100 });
  durableAgentStatus = events.find((event) => event.kind === "agent_protocol");
  if (durableAgentStatus) break;
  await Bun.sleep(100);
}
if (!durableAgentStatus) throw new Error("Structured-agent status was not appended to durable activity.");
await evaluate(`document.querySelector('button[aria-label="History"]')?.click()`);
await evaluate(`(()=>{const tab=[...document.querySelectorAll('[aria-label="History sections"] [role="tab"]')].find(node=>node.textContent?.trim()==="Activity");tab?.focus();return Boolean(tab)})()`);
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await waitFor(`[...document.querySelectorAll('[role="tab"]')].some(node=>node.textContent?.trim()==="History" && node.getAttribute("aria-selected")==="true") && document.querySelector("#utility-panel")?.textContent?.includes(${JSON.stringify(durableAgentStatus.message)})`, "durable agent status in History");
await evaluate(`(()=>{const tab=[...document.querySelectorAll('[aria-label="History sections"] [role="tab"]')].find(node=>node.textContent?.trim()==="Sessions");tab?.focus();return Boolean(tab)})()`);
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await waitFor(`Boolean(document.querySelector('input[aria-label="Search session transcripts"]'))`, "session history search");
await evaluate(`document.querySelector('input[aria-label="Search session transcripts"]')?.focus()`);
await cdp("Input.insertText", { text: "WHEELJACK" });
await evaluate(`(()=>{const button=[...document.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Search" && !node.disabled);button?.click();return Boolean(button)})()`);
await waitFor(`Boolean(document.querySelector("[data-session-id]"))`, "session transcript search results");
await evaluate(`document.querySelector('button[aria-label="Close utility panel"]')?.click()`);
await waitFor(`document.querySelector("#utility-panel")?.getAttribute("aria-hidden")!=="false"`, "closed session history");
await evaluate(`document.querySelector(${JSON.stringify(`button[aria-label="${openedProject.name}"]`)})?.click()`);
await waitFor(`Boolean(document.querySelector('textarea[aria-label="Agent prompt"]'))`, "terminal surface after Ops and drawer smoke");
const fixtureSessions = await coreCall("session_list", { limit: 100 });
const fixtureSession = fixtureSessions.find((session) => session.id === toolbarFixtureSession.id);
if (!fixtureSession) throw new Error("The toolbar structured-agent fixture session was not persisted.");
await coreCall("session_kill", { sessionId: fixtureSession.id, terminationReason: "canceled" });
await waitFor(`document.querySelector(${JSON.stringify(`[data-pane-id="${toolbarFixtureSession.nodeId}"]`)})?.getAttribute("data-runtime-status")!=="running"`, "toolbar structured-agent cancellation");
const originalCanvasName = await evaluate(`document.querySelector('button[role="tab"][aria-selected="true"]')?.textContent?.trim()`);
await evaluate(`document.querySelector('button[aria-label="New canvas"]')?.click()`);
await waitFor(`document.querySelector('button[role="tab"][aria-selected="true"]')?.textContent?.trim()!==${JSON.stringify(originalCanvasName)}`, "new canvas");
await evaluate(`document.querySelector('.wj-canvas-tab.active button[aria-label^="Canvas actions for "]')?.click()`);
await waitFor(`Boolean(document.querySelector('input[aria-label="Canvas name"]'))`, "canvas rename controls");
await evaluate(`(()=>{const input=document.querySelector('input[aria-label="Canvas name"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;setter?.call(input,"Smoke canvas");input?.dispatchEvent(new Event("input",{bubbles:true}));return Boolean(input)})()`);
await evaluate(`(()=>{const button=[...document.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Rename" && !node.disabled);button?.click();return Boolean(button)})()`);
await waitFor(`document.querySelector('button[role="tab"][aria-selected="true"]')?.textContent?.includes("Smoke canvas")`, "renamed canvas");
await evaluate(`document.querySelector('.wj-canvas-tab.active button[aria-label^="Canvas actions for "]')?.click()`);
await evaluate(`(()=>{const button=[...document.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Delete canvas" && !node.disabled);button?.click();return Boolean(button)})()`);
await waitFor(`Boolean(document.querySelector('[role="alertdialog"]'))`, "canvas delete confirmation");
await evaluate(`(()=>{const button=[...document.querySelectorAll('[role="alertdialog"] button')].find(node=>node.textContent?.trim()==="Confirm");button?.click();return Boolean(button)})()`);
const canvasDeleteDeadline = Date.now() + 60_000;
let remainingCanvases = [];
while (Date.now() < canvasDeleteDeadline) {
  remainingCanvases = await coreCall("canvas_list_project", { projectId: openedProject.id });
  if (remainingCanvases.length > 0 && !remainingCanvases.some((candidate) => candidate.name === "Smoke canvas")) break;
  await Bun.sleep(100);
}
if (remainingCanvases.length === 0 || remainingCanvases.some((candidate) => candidate.name === "Smoke canvas")) {
  throw new Error(`Canvas deletion did not preserve a usable workspace: ${JSON.stringify(remainingCanvases)}`);
}
await evaluate(`document.querySelector('button.wj-nav-item[aria-label="Settings"]')?.click()`);
await waitFor(`[...document.querySelectorAll("h1")].some(node=>node.textContent?.trim()==="Appearance")`, "appearance settings surface");
await evaluate(`(()=>{const button=[...document.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Edit copy");button?.click();return Boolean(button)})()`);
await waitFor(`Boolean(document.querySelector('button[aria-label="Edit canvas color"]:not(:disabled)'))`, "editable custom theme palette");
await evaluate(`document.querySelector('button[aria-label="Edit canvas color"]')?.click()`);
await waitFor(`Boolean(document.querySelector('[aria-label="canvas color editor"]'))`, "custom shadcn color picker");
const canvasHexBefore = await evaluate(`document.querySelector('input[aria-label="canvas hex color"]')?.value`);
await evaluate(`document.querySelector('[aria-label="canvas saturation and brightness"]')?.focus()`);
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38, modifiers: 8 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38, modifiers: 8 });
await waitFor(`document.querySelector('input[aria-label="canvas hex color"]')?.value!==${JSON.stringify(canvasHexBefore)}`, "keyboard color edit");
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await waitFor(`!document.querySelector('[aria-label="canvas color editor"]') && [...document.querySelectorAll("h1")].some(node=>node.textContent?.trim()==="Appearance")`, "color popover dismissal without closing Settings");
await waitFor(`[...document.querySelectorAll(".wj-settings-tabs button")].some(node=>node.textContent?.trim()==="Workspace")`, "Workspace settings tab");
await clickTextElement(".wj-settings-tabs button", "Workspace");
await waitFor(`[...document.querySelectorAll("h1")].some(node=>node.textContent?.trim()==="Workspace") && ["Pane header actions","Project paths","Live agent rail","Recent activity"].every(label=>document.querySelector('[aria-label="'+label+'"]'))`, "accessible workspace settings");
await evaluate(`document.querySelector('[role="switch"][aria-label="Live agent rail"]')?.click();document.querySelector('[role="switch"][aria-label="Recent activity"]')?.click();true`);
await waitFor(`document.querySelector('[role="switch"][aria-label="Live agent rail"]')?.getAttribute("aria-checked")==="false" && document.querySelector('[role="switch"][aria-label="Recent activity"]')?.getAttribute("aria-checked")==="false"`, "disabled optional Home rails");
await evaluate(`(()=>{const button=[...document.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Back");button?.click();return Boolean(button)})()`);
await evaluate(`document.querySelector('button.wj-nav-item[aria-label="Home"]')?.click()`);
await waitFor(`document.querySelector(".wj-home-grid.single") && ![...document.querySelectorAll(".wj-home-grid h2")].some(node=>["Live sessions","Needs attention","Recent activity"].includes(node.textContent?.trim()))`, "hidden optional Home rails");
await evaluate(`document.querySelector('button.wj-nav-item[aria-label="Settings"]')?.click()`);
await waitFor(`Boolean(document.querySelector('[role="switch"][aria-label="Live agent rail"]'))`, "restored workspace settings");
await evaluate(`document.querySelector('[role="switch"][aria-label="Live agent rail"]')?.click();document.querySelector('[role="switch"][aria-label="Recent activity"]')?.click();true`);
await waitFor(`document.querySelector('[role="switch"][aria-label="Live agent rail"]')?.getAttribute("aria-checked")==="true" && document.querySelector('[role="switch"][aria-label="Recent activity"]')?.getAttribute("aria-checked")==="true"`, "restored optional Home rails");
await waitFor(`[...document.querySelectorAll(".wj-settings-tabs button")].some(node=>node.textContent?.trim()==="Agents")`, "Agents settings tab");
await clickTextElement(".wj-settings-tabs button", "Agents");
await waitFor(`[...document.querySelectorAll("h1")].some(node=>node.textContent?.trim()==="Agents") && Boolean(document.querySelector('[aria-label="Coding agent"]'))`, "agent settings");
await waitFor(`[...document.querySelectorAll(".wj-settings-tabs button")].some(node=>node.textContent?.trim().startsWith("Application"))`, "Application settings tab");
await clickTextElement(".wj-settings-tabs button", "Application");
await waitFor(`[...document.querySelectorAll("h1")].some(node=>node.textContent?.trim()==="Application") && ["Export database only","Export complete backup","Restore backup","Copy diagnostics","Reset all"].every(label=>[...document.querySelectorAll("button")].some(node=>node.textContent?.trim()==label))`, "application settings");
const completeBackupPath = join(expectedDataDir, "smoke-complete-backup");
const exportedBackup = await coreCall("state_bundle_export", { path: completeBackupPath });
const checkedBackup = await coreCall("state_bundle_preview", { path: completeBackupPath });
if (checkedBackup.fingerprint !== exportedBackup.fingerprint || checkedBackup.projectCount < 1 || checkedBackup.sessionCount < 1) {
  throw new Error("Native complete backup did not preserve the exercised workspace.");
}
await evaluate(`(()=>{const button=[...document.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Back");button?.click();return Boolean(button)})()`);
await evaluate(`document.querySelector('.wj-session-list button')?.click()`);
await waitFor("Boolean(document.querySelector('.wj-terminal-page'))", "terminal surface");
const priorPaneCount = await evaluate("document.querySelectorAll('[data-pane-id]').length");
await waitFor(`Boolean(document.querySelector('button[aria-label="New pane"]:not(:disabled)'))`, "enabled pane action");
await evaluate(`document.querySelector('button[aria-label="New pane"]')?.focus()`);
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await waitFor(`["Shell split right","Shell split down","Note","Checklist","Browser Preview"].every(label=>[...document.querySelectorAll('[role="menuitem"]')].some(node=>node.textContent?.includes(label)))`, "new pane choices");
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "d", code: "KeyD", windowsVirtualKeyCode: 68, modifiers: 9 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "d", code: "KeyD", windowsVirtualKeyCode: 68, modifiers: 9 });
try {
  await waitFor(`document.querySelectorAll("[data-pane-id]").length > ${priorPaneCount}`, "spawned shell pane");
} catch (error) {
  const diagnostic = await evaluate(`(()=>({
    panes: document.querySelectorAll("[data-pane-id]").length,
    alerts: [...document.querySelectorAll('[role="alert"]')].map(node=>node.textContent?.trim()).filter(Boolean),
    buttons: [...document.querySelectorAll("button")].map(node=>({text:node.textContent?.trim(),disabled:node.disabled})).filter(node=>node.text).slice(0,40)
  }))()`);
  throw new Error(`${error.message}: ${JSON.stringify(diagnostic)}`);
}
try {
  await waitFor(
    `Boolean([...document.querySelectorAll("[data-pane-id]")].find(node=>node.getAttribute("data-runtime-status")==="running"&&node.querySelector('textarea[aria-label="Terminal input"]')))`,
    "spawned shell readiness after optimistic insertion",
    15_000,
  );
} catch (error) {
  const [diagnostic, diagnosticCanvases, diagnosticSessions] = await Promise.all([
    evaluate(`(() => ({panes:[...document.querySelectorAll("[data-pane-id]")].map(node=>({id:node.getAttribute("data-pane-id"),text:node.textContent?.trim().slice(0,240),status:[...node.querySelectorAll(".pane-status")].map(status=>status.className)})),errors:[...document.querySelectorAll(".wj-error-toast")].map(node=>node.textContent?.trim())}))()`),
    coreCall("canvas_list_project", { projectId: openedProject.id }),
    coreCall("session_list", { limit: 20 }),
  ]);
  throw new Error(`${error.message}\nPane diagnostic: ${JSON.stringify(diagnostic)}\nCanvases: ${JSON.stringify(diagnosticCanvases)}\nSessions: ${JSON.stringify(diagnosticSessions)}`);
}
const marker = "WHEELJACK_TAURI_RUNTIME_OK";
const sent = await evaluate(`(()=>{const pane=[...document.querySelectorAll("[data-pane-id]")].find(node=>node.getAttribute("data-runtime-status")==="running"&&node.querySelector('textarea[aria-label="Terminal input"]'));const input=pane?.querySelector('textarea[aria-label="Terminal input"]');if(!input)return false;input.focus();input.value=${JSON.stringify(`echo ${marker}`)};input.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:input.value}));input.value="";input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:true}));return true})()`);
if (!sent) throw new Error("The spawned shell did not expose terminal input.");
await waitFor(`[...document.querySelectorAll(".sr-only")].some(node=>node.textContent?.includes(${JSON.stringify(marker)}))`, "terminal echo");

const imeMarker = "WHEELJACK_IME_世界";
const imeSent = await evaluate(`(()=>{const input=document.querySelector('textarea[aria-label="Terminal input"]');if(!input)return false;input.focus();input.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true,data:""}));input.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:${JSON.stringify(`echo ${imeMarker}`)}}));input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:true}));return true})()`);
if (!imeSent) throw new Error("The terminal did not expose its IME input target.");
await waitFor(`[...document.querySelectorAll(".sr-only")].some(node=>node.textContent?.includes(${JSON.stringify(imeMarker)}))`, "Unicode composition echo");

const ansiMarker = "WHEELJACK_ANSI_RED";
await sendTerminalCommand(`powershell -NoProfile -Command "$e=[char]27; [Console]::WriteLine(\\"$e[31m${ansiMarker}$e[0m\\")"`);
await waitFor(
  `[...document.querySelectorAll('[role="application"][aria-label="Terminal session"]')].some(node=>node.querySelector('[aria-label="Terminal output"]')?.textContent?.includes(${JSON.stringify(ansiMarker)}) && Number(node.dataset.styledRuns)>0)`,
  "ANSI-styled terminal frame",
);

const scrollMarker = "WHEELJACK_SCROLL_120";
await sendTerminalCommand("for /L %i in (1,1,120) do @echo WHEELJACK_SCROLL_%i");
await waitFor(
  `[...document.querySelectorAll('[role="application"][aria-label="Terminal session"]')].some(node=>node.querySelector('[aria-label="Terminal output"]')?.textContent?.includes(${JSON.stringify(scrollMarker)}) && Number(node.dataset.scrollbackLines)>0)`,
  "terminal scrollback",
);
const terminalBox = await evaluate(`(()=>{const pane=[...document.querySelectorAll("[data-pane-id]")].find(node=>node.getAttribute("data-runtime-status")==="running"&&node.querySelector('[role="application"][aria-label="Terminal session"]'));const terminal=pane?.querySelector('[role="application"][aria-label="Terminal session"]')??document.querySelector('[role="application"][aria-label="Terminal session"]');const rect=terminal?.getBoundingClientRect();return rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null})()`);
if (!terminalBox) throw new Error("The terminal surface has no pointer target.");
await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: terminalBox.x + 20, y: terminalBox.y + 28, button: "left", buttons: 1, clickCount: 1 });
await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: terminalBox.x + Math.min(180, terminalBox.width - 20), y: terminalBox.y + 28, button: "left", buttons: 1 });
await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: terminalBox.x + Math.min(180, terminalBox.width - 20), y: terminalBox.y + 28, button: "left", buttons: 0, clickCount: 1 });
await waitFor(`[...document.querySelectorAll('[role="application"][aria-label="Terminal session"]')].some(node=>node.dataset.selectionActive==="true")`, "terminal pointer selection");

const terminalSessions = await coreCall("session_list", { limit: 100 });
const terminalFixtureSession = terminalSessions.find((session) =>
  session.adapterId === "generic-shell" && session.status === "running"
);
if (!terminalFixtureSession) throw new Error("No running shell session was available for terminal mode fixtures.");
await invoke("emit_terminal_ui_fixture", { sessionId: terminalFixtureSession.id, enabled: true });
await waitFor(
  `[...document.querySelectorAll('[role="application"][aria-label="Terminal session"]')].some(node=>node.dataset.alternateScreen==="true" && node.dataset.mouseReporting==="true")`,
  "alternate screen and mouse-reporting mode",
);
const mouseInputBaseline = await evaluate(`Number(document.querySelector('[aria-label="Terminal utilities"]')?.dataset.inputSamples??0)`);
await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: terminalBox.x + 60, y: terminalBox.y + 60, button: "left", buttons: 1, clickCount: 1 });
await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: terminalBox.x + 60, y: terminalBox.y + 60, button: "left", buttons: 0, clickCount: 1 });
await invoke("emit_terminal_ui_fixture", { sessionId: terminalFixtureSession.id, enabled: false });
await waitFor(`Number(document.querySelector('[aria-label="Terminal utilities"]')?.dataset.inputSamples??0)>${mouseInputBaseline}`, "terminal mouse input forwarding");
await waitFor(`[...document.querySelectorAll('[role="application"][aria-label="Terminal session"]')].every(node=>node.dataset.alternateScreen!=="true")`, "alternate screen exit");

const panesBeforeCloseCancel = await evaluate("document.querySelectorAll('[data-pane-id]').length");
const openedRunningConfirmation = await evaluate(`(()=>{const pane=[...document.querySelectorAll("[data-pane-id]")].find(node=>node.getAttribute("data-runtime-status")==="running"&&node.querySelector('textarea[aria-label="Terminal input"]'));const button=pane?.querySelector('button[aria-label^="Close pane "]');button?.click();return Boolean(button)})()`);
if (!openedRunningConfirmation) throw new Error("No running pane exposed a close action.");
await waitFor(
  `document.querySelector('[role="alertdialog"]')?.textContent?.includes("This session is still running") && document.activeElement?.textContent?.trim()==="Cancel"`,
  "accessible running-session confirmation",
);
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await waitFor(
  `!document.querySelector('[role="alertdialog"]') && document.querySelectorAll('[data-pane-id]').length===${panesBeforeCloseCancel}`,
  "keyboard cancellation preserving the running pane",
);

const focusedHome = await evaluate(`(()=>{const home=document.querySelector('button.wj-nav-item[aria-label="Home"]');if(!home)return false;home.dataset.smokeFocusOrigin="true";home.focus();return document.activeElement===home})()`);
if (!focusedHome) throw new Error("The Home action could not receive keyboard focus.");
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
const focusAdvanced = await evaluate(`document.activeElement!==document.querySelector('[data-smoke-focus-origin="true"]') && document.activeElement!==document.body`);
if (!focusAdvanced) throw new Error("Keyboard focus did not advance from the Home action.");

const priorShortcutPaneCount = await evaluate("document.querySelectorAll('[data-pane-id]').length");
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "D", code: "KeyD", windowsVirtualKeyCode: 68, modifiers: 9 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "D", code: "KeyD", windowsVirtualKeyCode: 68, modifiers: 9 });
await waitFor(`document.querySelectorAll("[data-pane-id]").length > ${priorShortcutPaneCount}`, "keyboard split shortcut");

await waitFor(`[...document.querySelectorAll("button")].some(node=>node.textContent?.trim()==="Stress six sessions" && !node.disabled)`, "enabled six-session stress action");
await evaluate(`(()=>{const button=[...document.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Stress six sessions" && !node.disabled);button?.click();return Boolean(button)})()`);
await waitFor("document.querySelectorAll('[role=\"application\"][aria-label=\"Terminal session\"]').length >= 8", "six-session terminal burst");
await cdp("Emulation.setDeviceMetricsOverride", { width: 1180, height: 720, deviceScaleFactor: 1, mobile: false });
await Bun.sleep(500);
await cdp("Emulation.clearDeviceMetricsOverride");
const echoRoundTrips = [];
for (let terminalIndex = 0; terminalIndex < 6; terminalIndex++) {
  const marker = `WHEELJACK_ECHO_${terminalIndex}_${Date.now().toString(36)}`;
  const elapsed = await evaluate(`(()=>new Promise((resolve,reject)=>{
    const terminal=[...document.querySelectorAll('[role="application"][aria-label="Terminal session"]')][0];
    const input=terminal?.querySelector('textarea[aria-label="Terminal input"]');
    const log=terminal?.querySelector('[aria-label="Terminal output"]');
    if(!input||!log){reject(new Error("Terminal ${terminalIndex} is unavailable"));return}
    const started=performance.now();
    const observer=new MutationObserver(()=>{
      if(!log.textContent?.includes(${JSON.stringify(marker)}))return;
      observer.disconnect();
      requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-started)));
    });
    observer.observe(log,{childList:true,subtree:true,characterData:true});
    const transfer=new DataTransfer();
    transfer.setData("text/plain",${JSON.stringify(`echo ${marker}`)});
    input.focus();
    input.dispatchEvent(new ClipboardEvent("paste",{bubbles:true,clipboardData:transfer}));
    input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:true}));
    setTimeout(()=>{observer.disconnect();reject(new Error("Echo ${terminalIndex} timed out"))},10000);
  }))()`, true);
  echoRoundTrips.push(elapsed);
}
const typedMarker = "WHEELJACK_TYPED_OK";
const typedCommand = `echo ${typedMarker} ${"x".repeat(180)}`;
await evaluate(`(()=>{const input=document.querySelector('textarea[aria-label="Terminal input"]');input?.focus();return Boolean(input)})()`);
for (const character of typedCommand) {
  await cdp("Input.insertText", { text: character });
  await Bun.sleep(12);
}
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await waitFor(`[...document.querySelectorAll(".sr-only")].some(node=>node.textContent?.includes(${JSON.stringify(typedMarker)}))`, "paced keyboard echo");
await waitFor(`(()=>{const footer=document.querySelector('[aria-label="Terminal utilities"]');return footer && /gaps\\s*0/.test(footer.textContent) && Number(footer.dataset.inputSamples)>=50 && Number(footer.dataset.resizeSamples)>0 && !/input p95\\s*[—-]/.test(footer.textContent) && !/resize p95\\s*[—-]/.test(footer.textContent)})()`, "zero-gap terminal metrics");

const accessibility = await cdp("Accessibility.getFullAXTree");
const roles = new Set(accessibility.nodes.map((node) => node.role?.value).filter(Boolean));
for (const required of ["RootWebArea", "button", "navigation", "separator", "log"]) {
  if (!roles.has(required)) throw new Error(`Accessibility tree is missing ${required}.`);
}
const summary = await evaluate(`(()=>{const metrics=document.querySelector('[aria-label="Terminal utilities"]');return {title:document.title,panes:document.querySelectorAll("[data-pane-id]").length,terminals:document.querySelectorAll('[role="application"][aria-label="Terminal session"]').length,metrics:metrics?.textContent?.replace(/\\s+/g," ").trim(),metricSamples:metrics?{input:Number(metrics.dataset.inputSamples),resize:Number(metrics.dataset.resizeSamples),frame:Number(metrics.dataset.frameSamples)}:null,alerts:[...document.querySelectorAll('[role="alert"]')].map(node=>node.textContent?.trim()).filter(Boolean),logo:Boolean(document.querySelector('img[alt="wheeljack"]')),decorated:!document.querySelector(".wj-titlebar")}})()`);
if (summary.alerts.length) throw new Error(`Visible shell error: ${summary.alerts.join(" | ")}`);
if (!summary.logo || summary.decorated) throw new Error("Custom wheeljack titlebar did not render.");
const sortedEchoes = [...echoRoundTrips].sort((left, right) => left - right);
const echoP95Milliseconds = sortedEchoes[Math.ceil(sortedEchoes.length * 0.95) - 1];
console.log(JSON.stringify({ ...summary, echoRoundTrips, echoP95Milliseconds, accessibilityNodes: accessibility.nodes.length, marker, imeMarker, ansiMarker, scrollMarker, focusedHome, focusAdvanced }, null, 2));
await evaluate("location.reload(); true");
await waitFor(
  "Boolean(document.querySelector('.wj-terminal-page')) && !document.querySelector('.wj-onboarding')",
  "completed onboarding bypass after reload",
);
if (!leaveOpen) {
  if (closeFlush) {
    const panesBeforeClose = await evaluate("document.querySelectorAll('[data-pane-id]').length");
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "D", code: "KeyD", windowsVirtualKeyCode: 68, modifiers: 9 });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "D", code: "KeyD", windowsVirtualKeyCode: 68, modifiers: 9 });
    await waitFor(`document.querySelectorAll("[data-pane-id]").length > ${panesBeforeClose}`, "last-moment split before close");
    console.log(JSON.stringify({ closeFlushExpectedPanes: panesBeforeClose + 1 }));
  }
  await evaluate(`window.dispatchEvent(new CustomEvent("wheeljack:smoke-close")); true`);
}
socket.close();
