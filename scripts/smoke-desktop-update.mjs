import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const options = Object.fromEntries(process.argv.slice(2).map((value, index, values) =>
  value.startsWith("--") ? [value.slice(2), values[index + 1]] : null
).filter(Boolean));
if (!options.executable) throw new Error("--executable is required.");

const sourceExecutable = resolve(options.executable);
const sourceBytes = await readFile(sourceExecutable);
const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
const expectRollback = options["expect-rollback"] === "true";
const verifySignature = options["verify-signature"] === "true";
const native = options.native === "true";
const assetBytes = expectRollback ? Buffer.from("wheeljack updater rollback smoke") : sourceBytes;
const assetHash = createHash("sha256").update(assetBytes).digest("hex");
const root = await mkdtemp(join(tmpdir(), "wheeljack-desktop-update-smoke-"));
const profile = join(root, "profile");
const target = join(root, "wheeljack.exe");
await mkdir(profile);
await copyFile(sourceExecutable, target);
const before = await stat(target);

const assetName = "wheeljack-windows-x64-portable.exe";
const server = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    const base = `http://127.0.0.1:${server.port}`;
    if (url.pathname === "/release") {
      return Response.json({
        tag_name: "v0.1.0",
        name: "wheeljack 0.1.0 update smoke",
        body: "Local updater lifecycle smoke.",
        published_at: new Date().toISOString(),
        assets: [
          {
            name: assetName,
            browser_download_url: `${base}/${assetName}`,
            size: assetBytes.byteLength,
          },
          {
            name: `${assetName}.sha256`,
            browser_download_url: `${base}/${assetName}.sha256`,
            size: assetHash.length + assetName.length + 3,
          },
        ],
      });
    }
    if (url.pathname === `/${assetName}`) {
      return new Response(assetBytes, { headers: { "content-type": "application/octet-stream" } });
    }
    if (url.pathname === `/${assetName}.sha256`) {
      return new Response(`${assetHash}  ${assetName}`, { headers: { "content-type": "text/plain" } });
    }
    return new Response("not found", { status: 404 });
  },
});

const debugPort = 9400 + Math.floor(Math.random() * 400);
const child = Bun.spawn([
  target,
  "--ui-smoke",
  ...(native ? ["--ui-smoke-auto-close"] : []),
], {
  cwd: dirname(target),
  env: {
    ...process.env,
    WHEELJACK_DESKTOP_DATA_DIR: profile,
    WHEELJACK_UI_SMOKE: "1",
    WHEELJACK_DESKTOP_VERSION_OVERRIDE: "0.0.9",
    WHEELJACK_UPDATE_FEED_URL: `http://127.0.0.1:${server.port}/release`,
    ...(expectRollback ? { WHEELJACK_SKIP_SIGNATURE_VERIFY: "1" } : {}),
    ...(native ? {
      WHEELJACK_UI_SMOKE_AUTO_CLOSE: "1",
      WHEELJACK_UPDATE_SMOKE_MODE: expectRollback ? "rollback" : "healthy",
    } : {}),
    WEBVIEW2_USER_DATA_FOLDER: join(profile, "webview2"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--force-renderer-accessibility --remote-debugging-port=${debugPort}`,
  },
  stdout: "ignore",
  stderr: "ignore",
});

let socket;
let stage = "launch";
let requestId = 0;
let pending = new Map();
const deadline = (milliseconds = 60_000) => Date.now() + milliseconds;
const sleep = (milliseconds) => Bun.sleep(milliseconds);

async function targetPage(until = deadline(), excludedId) {
  while (Date.now() < until) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
      const page = pages.find((candidate) => candidate.type === "page" && candidate.id !== excludedId);
      if (page) return page;
    } catch {
      // WebView2 is starting or restarting.
    }
    await sleep(100);
  }
  throw new Error("The updater smoke WebView did not appear.");
}

async function waitForPageClosed(milliseconds = 10_000) {
  const until = deadline(milliseconds);
  while (Date.now() < until) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
      if (!pages.some((candidate) => candidate.type === "page")) return;
    } catch {
      return;
    }
    await sleep(100);
  }
  throw new Error("The updater smoke WebView did not close.");
}

async function connect(page) {
  const next = new WebSocket(page.webSocketDebuggerUrl);
  await Promise.race([
    new Promise((resolveOpen, rejectOpen) => {
      next.addEventListener("open", resolveOpen, { once: true });
      next.addEventListener("error", rejectOpen, { once: true });
    }),
    sleep(10_000).then(() => { throw new Error("The updater smoke DevTools socket did not connect."); }),
  ]);
  socket = next;
  pending = new Map();
  socket.addEventListener("message", (event) => {
    const response = JSON.parse(event.data);
    const completion = pending.get(response.id);
    if (!completion) return;
    pending.delete(response.id);
    if (response.error) completion.reject(new Error(response.error.message));
    else completion.resolve(response.result);
  });
  await cdp("Runtime.enable");
}

function cdp(method, params = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const id = ++requestId;
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, awaitPromise = false) {
  const response = await cdp("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

async function waitUntil(predicate, description, milliseconds = 60_000) {
  const until = deadline(milliseconds);
  while (Date.now() < until) {
    if (await predicate()) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function waitFor(expression, description, milliseconds = 60_000) {
  return waitUntil(() => evaluate(expression), description, milliseconds);
}

async function waitForChildExit(milliseconds = 120_000) {
  let timeout;
  try {
    await Promise.race([
      child.exited,
      new Promise((_, reject) => {
        timeout = setTimeout(async () => {
          const updateDir = join(profile, "updates");
          const diagnostics = {
            pid: child.pid,
            exitCode: child.exitCode,
            updateDirExists: await stat(updateDir).then(() => true, () => false),
            installLog: await readFile(join(updateDir, "install.log"), "utf8").catch(() => undefined),
            recoveryError: await readFile(join(updateDir, "install-error.txt"), "utf8").catch(() => undefined),
            resultExists: await stat(join(profile, "ui-smoke-result.json")).then(() => true, () => false),
          };
          reject(new Error(`The original updater smoke process did not exit within ${milliseconds}ms: ${JSON.stringify(diagnostics)}`));
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyReplacementFiles() {
  const after = await stat(target);
  const afterHash = createHash("sha256").update(await readFile(target)).digest("hex");
  if (expectRollback) {
    if (afterHash !== sourceHash) throw new Error("The updater did not restore the prior executable after replacement launch failure.");
    const installLog = await readFile(join(profile, "updates", "install.log"), "utf8");
    if (!installLog.includes("failed")) throw new Error("The rollback path did not record its failed replacement.");
  } else {
    if (afterHash !== assetHash) throw new Error("The replacement executable hash did not match the downloaded asset.");
    if (after.mtimeMs <= before.mtimeMs) throw new Error("The updater did not replace the staged executable.");
  }
  await waitUntil(async () => {
    const previousExists = await stat(`${target}.previous`).then(() => true, () => false);
    const replacementExists = await stat(`${target}.update`).then(() => true, () => false);
    return !previousExists && !replacementExists;
  }, "updater rollback and staging artifact cleanup", 10_000);
  await stat(join(profile, "wheeljack.sqlite3"));
  return afterHash;
}

try {
  if (native) {
    stage = "wait for the self-driven updater";
    await waitForChildExit();
    const resultPath = join(profile, "ui-smoke-result.json");
    await waitUntil(() => stat(resultPath).then(() => true, () => false), "healthy relaunched native UI", 60_000);
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    if (!result.ok) throw new Error(result.message || "The relaunched native UI smoke failed.");
    const afterHash = await verifyReplacementFiles();
    console.log(JSON.stringify({
      ok: true,
      native: true,
      target: basename(target),
      sha256: afterHash,
      replaced: !expectRollback,
      rolledBack: expectRollback,
      healthyRelaunch: true,
      dataPersisted: true,
      rollbackArtifactsRemoved: true,
    }));
  } else {
    stage = "connect initial shell";
    const initialPage = await targetPage();
    await connect(initialPage);
    await waitFor("Boolean(window.__TAURI_INTERNALS__ && document.querySelector('img[alt=\"wheeljack\"]') && document.querySelector('[data-core-connected=\"true\"]'))", "initial connected native shell");
    stage = "wait for automatic check and staging";
    await waitFor(`Boolean(document.querySelector('[data-updater-status="ready"]'))`, "staged update action");
    stage = "restart from the title bar";
    await evaluate(`document.querySelector('[data-updater-status="ready"]')?.click(); true`);
    if (!verifySignature && !expectRollback) {
      await waitFor(`document.querySelector('[role="alertdialog"]')?.textContent?.includes("Install unsigned wheeljack update?")`, "unsigned update warning");
      const focused = await evaluate(`document.activeElement?.textContent?.trim()`);
      if (focused !== "Cancel") throw new Error(`Unsigned warning focused ${JSON.stringify(focused)} instead of Cancel.`);
      await evaluate(`[...document.querySelectorAll('[role="alertdialog"] button')].find(node=>node.textContent?.trim()==="Cancel")?.click(); true`);
      await waitFor(`!document.querySelector('[role="alertdialog"]') && Boolean(document.querySelector('[data-updater-status="ready"]'))`, "cancelled update remaining ready");
      await evaluate(`document.querySelector('[data-updater-status="ready"]')?.click(); true`);
      await waitFor(`document.querySelector('[role="alertdialog"]')?.textContent?.includes("Install unsigned wheeljack update?")`, "reopened unsigned update warning");
      await evaluate(`[...document.querySelectorAll('[role="alertdialog"] button')].find(node=>node.textContent?.trim()==="Confirm")?.click(); true`);
    }

    socket.close();
    socket = undefined;
    stage = "connect relaunched shell";
    await connect(await targetPage(deadline(40_000), initialPage.id));
    await waitFor("Boolean(window.__TAURI_INTERNALS__ && document.querySelector('.wj-app-shell[data-core-connected=\"true\"]') && document.querySelector('img[alt=\"wheeljack\"]'))", "healthy relaunched shell", 30_000);
    await sleep(500);

    const afterHash = await verifyReplacementFiles();
    if (!expectRollback) {
      await waitFor(`document.body.innerText.includes("WELCOME TO WHEELJACK")`, "fresh-install onboarding");
      const shownEarly = await evaluate(`document.body.innerText.includes("What’s new in wheeljack")`);
      if (shownEarly) throw new Error("What’s New appeared before onboarding finished.");
      await evaluate(`[...document.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Skip guide")?.click(); true`);
      await waitFor(`!document.body.innerText.includes("WELCOME TO WHEELJACK")`, "onboarding dismissal");
      await waitFor(`document.querySelector('[role="dialog"]')?.textContent?.includes("What’s new in wheeljack 0.1.0")`, "post-update release notes");
      await waitFor(`document.querySelector('[role="dialog"]')?.textContent?.includes("Local updater lifecycle smoke.")`, "release notes body");
      await evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(node=>node.textContent?.trim()==="Got it")?.click(); true`);
      await waitFor(`!document.querySelector('[role="dialog"]') && !JSON.parse(localStorage.getItem("wheeljack.local.updates") || "{}").pendingRelease`, "dismissed release notes persistence");
    }
    if (expectRollback) {
      await evaluate(`(()=>{const button=[...document.querySelectorAll("button")].find(node=>node.textContent?.trim()==="Settings");button?.click();return Boolean(button)})()`);
      await waitFor(`Boolean(document.querySelector(".wj-settings-page"))`, "settings after rollback");
      await evaluate(`(()=>{const tab=[...document.querySelectorAll('[role="tab"]')].find(node=>node.textContent?.trim()==="Application");tab?.focus();return Boolean(tab)})()`);
      await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      try {
        await waitFor(`document.body.innerText.includes("The update failed and the previous version was restored.")`, "post-rollback recovery error", 10_000);
      } catch {
        const diagnostic = await evaluate(`(()=>({
          body: document.body.innerText,
          stored: localStorage.getItem("wheeljack.local.updates"),
          tabs: [...document.querySelectorAll('[role="tab"]')].map(node=>({text:node.textContent?.trim(),state:node.getAttribute("data-state")}))
        }))()`);
        throw new Error(`Recovery UI diagnostic: ${JSON.stringify(diagnostic)}`);
      }
    }

    console.log(JSON.stringify({
      ok: true,
      feed: `http://127.0.0.1:${server.port}/release`,
      target: basename(target),
      sha256: afterHash,
      replaced: !expectRollback,
      rolledBack: expectRollback,
      healthyRelaunch: true,
      dataPersisted: true,
      rollbackArtifactsRemoved: true,
    }));
    await evaluate(`window.dispatchEvent(new CustomEvent("wheeljack:smoke-close")); true`);
    socket.close();
    socket = undefined;
    await waitForPageClosed();
  }
} catch (error) {
  const diagnostic = socket?.readyState === WebSocket.OPEN
    ? await evaluate(`(() => ({
        updaterStatus: document.querySelector("[data-updater-status]")?.getAttribute("data-updater-status"),
        body: document.body.innerText,
        stored: localStorage.getItem("wheeljack.local.updates")
      }))()`).catch(() => undefined)
    : undefined;
  if (diagnostic) console.error(`Updater UI diagnostic: ${JSON.stringify(diagnostic)}`);
  const updateDir = join(profile, "updates");
  const nativeDiagnostic = {
    updateFiles: await readdir(updateDir).catch(() => []),
    installLog: await readFile(join(updateDir, "install.log"), "utf8").catch(() => undefined),
    recoveryError: await readFile(join(updateDir, "install-error.txt"), "utf8").catch(() => undefined),
    smokeResult: await readFile(join(profile, "ui-smoke-result.json"), "utf8").catch(() => undefined),
  };
  if (nativeDiagnostic.updateFiles.length || nativeDiagnostic.smokeResult) {
    console.error(`Updater native diagnostic: ${JSON.stringify(nativeDiagnostic)}`);
  }
  console.error(`Updater smoke failed during ${stage}: ${error instanceof Error ? error.stack : error}`);
  throw error;
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      await evaluate(`window.dispatchEvent(new CustomEvent("wheeljack:smoke-close")); true`);
    } catch {
      socket.close();
    }
  }
  child.kill();
  server.stop(true);
  await waitForPageClosed().catch(() => {});
  await sleep(1000);
  const resolvedRoot = resolve(root);
  const expectedParent = resolve(tmpdir());
  if (dirname(resolvedRoot) !== expectedParent || !basename(resolvedRoot).startsWith("wheeljack-desktop-update-smoke-")) {
    throw new Error(`Refusing unsafe updater smoke cleanup path: ${resolvedRoot}`);
  }
  try {
    await rm(resolvedRoot, { recursive: true, force: true });
  } catch (error) {
    console.error(`Updater smoke cleanup deferred for ${resolvedRoot}: ${error instanceof Error ? error.message : error}`);
  }
}
