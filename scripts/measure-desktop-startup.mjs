import { readFile } from "node:fs/promises";

const options = Object.fromEntries(process.argv.slice(2).map((value, index, values) =>
  value.startsWith("--") ? [value.slice(2), values[index + 1]] : null
).filter(Boolean));
const port = Number(options.port);
const processStartedAt = Number(options["process-started-at"]);
if (!Number.isFinite(port) || !Number.isFinite(processStartedAt)) {
  throw new Error("--port and --process-started-at are required.");
}

const targets = JSON.parse(await readFile(new URL("./desktop-performance-targets.json", import.meta.url), "utf8"));
const targetMilliseconds = targets.startup.target.firstUsableMilliseconds;
const deadline = Date.now() + 60_000;
let target;
while (Date.now() < deadline) {
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json())
      .find((candidate) => candidate.type === "page");
    if (target) break;
  } catch {
    // The packaged WebView has not exposed its DevTools target yet.
  }
  await Bun.sleep(25);
}
if (!target) throw new Error(`No Wheeljack WebView appeared on DevTools port ${port}.`);

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const response = JSON.parse(data);
  const completion = pending.get(response.id);
  if (!completion) return;
  pending.delete(response.id);
  response.error ? completion.reject(new Error(response.error.message)) : completion.resolve(response.result);
});
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
await cdp("Runtime.enable");
const evaluate = async (expression) => {
  const result = await cdp("Runtime.evaluate", { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression, description) => {
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return Date.now();
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for ${description}.`);
};

const firstUsableAt = await waitFor(
  "Boolean(window.__TAURI_INTERNALS__ && document.querySelector('.wj-app-shell[data-core-connected=\"true\"]'))",
  "the first usable UI",
);
const projectReadyAt = await waitFor(
  "Boolean(document.querySelector('.wj-terminal-page button[aria-label=\"New pane\"]:not(:disabled)')) || Boolean(document.querySelector('.wj-home-page[aria-busy=\"false\"]'))",
  "the restored project or usable Home surface",
);
const result = {
  firstUsableMilliseconds: firstUsableAt - processStartedAt,
  projectReadyMilliseconds: projectReadyAt - processStartedAt,
  targetMilliseconds,
  homeNavigation: false,
};
if (options["proof-navigation"] === "true") {
  const clicked = await evaluate("(()=>{const button=document.querySelector('button[aria-label=\"Home\"]');button?.click();return Boolean(button)})()");
  if (!clicked) throw new Error("The packaged UI did not expose its Home navigation action.");
  await waitFor(
    "Boolean(document.querySelector('.wj-home-page[aria-busy=\"false\"]'))",
    "Home navigation to complete",
  );
  result.homeNavigation = true;
}
socket.close();
console.log(JSON.stringify(result));
if (result.firstUsableMilliseconds > targetMilliseconds) {
  throw new Error(`First usable UI took ${result.firstUsableMilliseconds}ms; target is ${targetMilliseconds}ms.`);
}
