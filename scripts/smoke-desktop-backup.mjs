// Packaged Windows restore proof using the same WebView2 CDP surface as the
// desktop smoke suite. Only the OS folder-picker result is supplied by the fixture.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";

const options = Object.fromEntries(process.argv.slice(2).map((value, index, values) => value.startsWith("--") ? [value.slice(2), values[index + 1]] : null).filter(Boolean));
assert(options.executable, "--executable is required");
const executable = resolve(options.executable);
await stat(executable);
const root = await mkdtemp(join(tmpdir(), "wheeljack-backup-smoke-"));
const source = join(root, "source");
const target = join(root, "target");
const project = join(root, "project");
const exports = join(root, "exports");
const screenshot = options.screenshot && resolve(options.screenshot);
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const path of [source, target, project, exports]) await mkdir(path);
let child;
let socket;
let cdp;
let sequence = 0;
const pending = new Map();
const until = async (predicate, description, milliseconds = 60_000) => {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await Bun.sleep(100);
  }
  throw new Error(`Timed out: ${description}`);
};
const evaluate = async (expression) => {
  const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
};
const core = async (command, payload = {}) => {
  const requestJson = JSON.stringify({ id: `backup-${++sequence}`, command, payload, protocolVersion: 2 });
  const result = await evaluate(`window.__TAURI_INTERNALS__.invoke("core_call", {requestJson:${JSON.stringify(requestJson)}}).then(JSON.parse)`);
  assert(result.ok, result.error?.message ?? command);
  return result.payload;
};
async function launch(path, initializeOnly = false) {
  console.error(`BACKUP_SMOKE launch ${basename(path)} initialize=${initializeOnly}`);
  const port = 10000 + Math.floor(Math.random() * 2000);
  child = Bun.spawn([executable, "--ui-smoke", ...(initializeOnly ? ["--ui-smoke-auto-close"] : [])], {
    env: { ...process.env, WHEELJACK_DESKTOP_DATA_DIR: path, WHEELJACK_UI_SMOKE: "1", WHEELJACK_UI_SMOKE_AUTO_CLOSE: initializeOnly ? "1" : "", WEBVIEW2_USER_DATA_FOLDER: join(path, "webview2"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--force-renderer-accessibility --remote-debugging-port=${port}` },
    stdout: "ignore", stderr: "ignore",
  });
  if (initializeOnly) {
    await until(() => child.exitCode !== null, "initial native smoke exits", 120_000);
    assert.equal(child.exitCode, 0);
    const result = JSON.parse(await readFile(join(path, "ui-smoke-result.json"), "utf8"));
    assert.equal(result.ok, true, result.message);
    child = undefined;
    return;
  }
  let page;
  await until(async () => {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((item) => item.type === "page"); } catch { /* WebView is starting. */ }
    return Boolean(page);
  }, "native WebView appears");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await until(() => socket.readyState === WebSocket.OPEN, "CDP connection");
  socket.addEventListener("message", (event) => {
    const response = JSON.parse(event.data);
    const completion = pending.get(response.id);
    if (!completion) return;
    pending.delete(response.id);
    if (response.error) completion.reject(new Error(response.error.message));
    else completion.resolve(response.result);
  });
  cdp = (method, params = {}) => new Promise((resolveResult, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method} ${JSON.stringify(params)}`)); }, 30_000);
    pending.set(id, { resolve: (result) => { clearTimeout(timer); resolveResult(result); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await cdp("Runtime.enable");
  await until(() => evaluate(`Boolean(window.__TAURI_INTERNALS__ && document.querySelector('.wj-app-shell[data-core-connected="true"]'))`), "native core connected");
  const status = await core("core_status");
  assert.equal(status.testMode, true);
  assert.equal(resolve(status.appDataDir).toLowerCase(), resolve(path).toLowerCase());
}
async function close() {
  await evaluate(`window.dispatchEvent(new CustomEvent("wheeljack:smoke-close")); true`);
  socket.close();
  socket = undefined;
  await until(() => child.exitCode !== null, "graceful app close", 30_000);
  assert.equal(child.exitCode, 0);
  child = undefined;
}
async function button(label) {
  console.error(`BACKUP_SMOKE button ${label}`);
  const expression = `(()=>{const button=[...document.querySelectorAll('button')].find(node=>node.textContent?.trim()===${JSON.stringify(label)}&&!node.disabled);button?.click();return Boolean(button)})()`;
  await until(() => evaluate(expression), `click ${label}`);
}
async function settings() {
  await evaluate(`[...document.querySelectorAll('button')].find(node=>node.textContent?.trim()==="Skip guide")?.click(); true`);
  await until(() => evaluate(`(()=>{const button=document.querySelector('button.wj-nav-item[aria-label="Settings"]');button?.click();return Boolean(button)})()`), "open Settings");
  await until(() => evaluate(`Boolean([...document.querySelectorAll('.wj-settings-tabs button')].find(node=>node.textContent?.trim().startsWith("Application")))`), "Application settings tab");
  const point = await evaluate(`(()=>{const tab=[...document.querySelectorAll('.wj-settings-tabs button')].find(node=>node.textContent?.trim().startsWith("Application"));const rect=tab.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}})()`);
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount: 1 });
  await until(() => evaluate(`document.body.innerText.includes("Export complete backup")`), "backup controls loaded");
}
async function folderResult(path) {
  // Tauri's invoke entry point is immutable. Supply only the folder chooser's
  // fetch response, leaving every application/core IPC call on the real backend.
  await evaluate(`(()=>{const original=window.__backupOriginalFetch??window.fetch.bind(window);window.__backupOriginalFetch=original;const dialogUrl=window.__TAURI_INTERNALS__.convertFileSrc("plugin:dialog|open","ipc");window.fetch=(input,init)=>String(input)===dialogUrl?Promise.resolve(new Response(${JSON.stringify(JSON.stringify(path))},{headers:{"Content-Type":"application/json","Tauri-Response":"ok"}})):original(input,init);return true})()`);
}
function seed(path, prefix) {
  const db = new Database(join(path, "wheeljack.sqlite3"));
  const timestamp = new Date().toISOString();
  const attachment = join(path, "attachments", `${prefix}.png`);
  const draft = { version: 1, draft: `${prefix} ordinary draft`, attachments: [{ path: attachment, mimeType: "image/png", fileName: `${prefix}.png` }], queuedEdit: { deliveryId: `${prefix}-delivery`, draft: `${prefix} queued edit`, attachments: [{ path: attachment, mimeType: "image/png", fileName: `${prefix}.png` }] } };
  const payload = { prompt: `${prefix} queued prompt`, historyText: `${prefix} queued prompt`, standingRoleApplied: false, imagePaths: [attachment], provider: null, model: null, thinking: null, approvalPolicy: null, sandbox: null };
  db.transaction(() => {
    db.run("INSERT OR REPLACE INTO settings(key,value_json,updated_at) VALUES ('desktopOnboardingVersion','1',?)", [timestamp]);
    db.run("INSERT INTO projects(id,path,name,created_at,updated_at) VALUES (?,?,?,?,?)", [`${prefix}-project`, project, `${prefix} project`, timestamp, timestamp]);
    db.run("INSERT INTO canvases(id,project_id,name,camera_json,created_at,updated_at) VALUES (?,?,?,'{\"x\":0,\"y\":0,\"scale\":1}',?,?)", [`${prefix}-canvas`, `${prefix}-project`, "Work", timestamp, timestamp]);
    db.run("INSERT INTO nodes(id,canvas_id,kind,title,x,y,width,height,z_index,data_json,created_at,updated_at) VALUES (?,?,'agent_terminal',?,0,0,800,600,0,?,?,?)", [`${prefix}-node`, `${prefix}-canvas`, `${prefix} Agent`, JSON.stringify({ chatComposition: draft }), timestamp, timestamp]);
    db.run("INSERT INTO sessions(id,node_id,adapter_id,command_json,cwd,status,created_at,updated_at) VALUES (?,?,'codex-cli','[]',?,'completed',?,?)", [`${prefix}-session`, `${prefix}-node`, project, timestamp, timestamp]);
    db.run("INSERT INTO session_prompt_deliveries(id,session_id,seq,mode,state,payload_json,created_at,updated_at,request_session_id,payload_fingerprint) VALUES (?,?,1,'auto','queued',?,?,?,?,?)", [`${prefix}-delivery`, `${prefix}-session`, JSON.stringify(payload), timestamp, timestamp, `${prefix}-session`, hash(JSON.stringify(payload))]);
    db.run("INSERT INTO session_chunks(session_id,seq,stream,data,created_at) VALUES (?,1,'agent-input',?,?)", [`${prefix}-session`, Buffer.from(JSON.stringify({ text: `${prefix} history`, images: [{ path: attachment }] })), timestamp]);
  })();
  db.close();
  return attachment;
}
try {
  await launch(source, true);
  await mkdir(join(source, "attachments"), { recursive: true });
  await writeFile(seed(source, "original"), image);
  await launch(source);
  await settings();
  await folderResult(exports);
  await button("Export complete backup");
  await until(() => evaluate(`document.body.innerText.includes("Backup saved to")`), "complete export UI success");
  const [bundleName] = (await readdir(exports)).filter((name) => name.startsWith("wheeljack-backup-"));
  assert(bundleName, "export directory exists");
  const bundle = join(exports, bundleName);
  const preview = await core("state_bundle_preview", { path: bundle });
  assert(preview.attachmentCount >= 1);
  await close();

  await launch(target, true);
  await mkdir(join(target, "attachments"), { recursive: true });
  await writeFile(seed(target, "prior"), image);
  await launch(target);
  await settings();
  await folderResult(bundle);
  await button("Restore backup");
  await until(() => evaluate(`document.querySelector('[role="alertdialog"]')?.textContent.includes("Restore this backup on next launch?")`), "restore preview");
  await button("Cancel");
  assert.equal((await core("state_bundle_status")).pending, false, "Cancel does not stage restoration");
  await button("Restore backup");
  await until(() => evaluate(`document.querySelector('[role="alertdialog"]')?.textContent.includes("Restore this backup on next launch?")`), "second restore preview");
  await button("Restore on next launch");
  await until(async () => (await core("state_bundle_status")).pending === true, "restore staged");
  await until(() => evaluate(`document.body.innerText.includes("Restore is ready.")`), "restart instructions");
  await close();

  await launch(target);
  const restoreStatus = await core("state_bundle_status");
  assert.equal(restoreStatus.pending, false);
  assert.equal(restoreStatus.error, null);
  const canvas = await core("canvas_get", { canvasId: "original-canvas" });
  const node = canvas.nodes.find((item) => item.id === "original-node");
  assert(node, "restored agent node");
  assert.equal(node.data.chatComposition.draft, "original ordinary draft");
  assert.equal(node.data.chatComposition.queuedEdit.deliveryId, "original-delivery");
  assert.equal(node.data.chatComposition.queuedEdit.draft, "original queued edit");
  const imagePath = node.data.chatComposition.attachments[0].path;
  assert.equal(resolve(dirname(imagePath)).toLowerCase(), resolve(join(target, "attachments")).toLowerCase());
  assert.equal(hash(await readFile(imagePath)), hash(image));
  assert.equal(node.data.chatComposition.queuedEdit.attachments[0].path, imagePath);
  const deliveries = await core("session_prompt_list", { sessionId: "original-session" });
  const delivery = deliveries.find((item) => item.id === "original-delivery");
  assert(delivery && ["queued", "blocked"].includes(delivery.state));
  assert.equal(delivery.payload.prompt, "original queued prompt");
  assert.equal(delivery.payload.imagePaths[0], imagePath);
  const history = await core("session_transcript", { sessionId: "original-session" });
  assert(history.text.includes("original history"));
  await settings();
  assert.equal(await evaluate(`document.body.innerText.includes("Restore is ready.")`), false);
  if (screenshot) {
    const capture = await cdp("Page.captureScreenshot", { format: "png" });
    await writeFile(screenshot, Buffer.from(capture.data, "base64"));
  }
  await close();
  const recoveries = (await readdir(target)).filter((name) => name.startsWith("wheeljack-pre-restore-"));
  assert.equal(recoveries.length, 1);
  const recovery = join(target, recoveries[0]);
  const oldDb = new Database(join(recovery, "wheeljack.sqlite3"), { readonly: true });
  assert(oldDb.query("SELECT id FROM nodes WHERE id='prior-node'").get());
  oldDb.close();
  const manifest = JSON.parse(await readFile(join(recovery, "manifest.json"), "utf8"));
  assert(manifest.attachments.length >= 1);
  for (const item of manifest.attachments) assert.equal(hash(await readFile(join(recovery, "attachments", item.name))), item.sha256);
  console.log(JSON.stringify({ ok: true, packaged: true, exportThroughUI: true, restorePreviewCancelConfirm: true, restarted: true, draftAndQueuedEditPreserved: true, pendingPromptAndImagePreserved: true, historyPreserved: true, priorProfileRecoveryVerified: true, folderPicker: "fixture-supplied path; all core and filesystem operations native", screenshot }));
} catch (error) {
  console.error(error);
  if (socket?.readyState === WebSocket.OPEN) console.error(await evaluate("document.body.innerText").catch(() => "WebView unavailable"));
  throw error;
} finally {
  if (socket?.readyState === WebSocket.OPEN) await close().catch(() => {});
  socket?.close();
  child?.kill();
  if (child) await child.exited;
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  assert(basename(root).startsWith("wheeljack-backup-smoke-"));
  await Bun.sleep(1000);
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch((error) => console.error(`Disposable smoke profile retained for cleanup: ${root}: ${error.message}`));
}
