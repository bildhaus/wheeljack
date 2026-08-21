import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "apps", "desktop", "dist");
const manifestPath = path.join(dist, ".vite", "manifest.json");
const targetsPath = path.join(root, "scripts", "desktop-performance-targets.json");
const enforceTarget = process.argv.includes("--enforce-target");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const targets = JSON.parse(await readFile(targetsPath, "utf8"));
if (targets.version !== 1 || !targets.bundle?.ceiling || !targets.bundle?.target) {
  throw new Error("Desktop performance targets must use version 1 with bundle ceiling and target metrics.");
}
const bundleMetricKeys = ["initialJsBytes", "largestJsChunkBytes", "totalJsBytes"];
for (const key of bundleMetricKeys) {
  const ceiling = targets.bundle.ceiling[key];
  const target = targets.bundle.target[key];
  if (!Number.isFinite(ceiling) || ceiling <= 0 || !Number.isFinite(target) || target <= 0) {
    throw new Error(`Desktop bundle metric ${key} must have positive ceiling and target values.`);
  }
  if (target >= ceiling) {
    throw new Error(`Desktop bundle target ${key} must improve on its current ceiling.`);
  }
}

const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
if (!entryKey) throw new Error("Desktop build manifest has no entry chunk.");

const initialKeys = new Set();
function collectInitial(key) {
  if (initialKeys.has(key)) return;
  const item = manifest[key];
  if (!item) throw new Error(`Desktop build manifest is missing ${key}.`);
  initialKeys.add(key);
  for (const dependency of item.imports ?? []) collectInitial(dependency);
}
collectInitial(entryKey);

const jsEntries = Object.entries(manifest).filter(([, item]) => item.file?.endsWith(".js"));
const sizes = new Map(await Promise.all(jsEntries.map(async ([key, item]) => [
  key,
  (await stat(path.join(dist, item.file))).size,
])));
const initialJsBytes = [...initialKeys].reduce((total, key) => total + (sizes.get(key) ?? 0), 0);
const largestJsChunkBytes = Math.max(...sizes.values());
const totalJsBytes = [...sizes.values()].reduce((total, size) => total + size, 0);
const metrics = { initialJsBytes, largestJsChunkBytes, totalJsBytes };

function compare(limit, label) {
  const failures = Object.entries(limit).flatMap(([key, value]) =>
    metrics[key] > value ? [`${key}=${metrics[key]} exceeded ${label} ${value}`] : []);
  return { limit, failures };
}

const ceiling = compare(targets.bundle.ceiling, "ceiling");
const target = compare(targets.bundle.target, "target");
console.log(`DESKTOP_BUNDLE_METRICS ${JSON.stringify({ metrics, initialFiles: [...initialKeys].map((key) => manifest[key].file) })}`);
console.log(`DESKTOP_BUNDLE_TARGET_PROGRESS ${JSON.stringify({ target: targets.bundle.target, achieved: target.failures.length === 0, remaining: target.failures })}`);
if (ceiling.failures.length) throw new Error(`Desktop bundle ceiling failed: ${ceiling.failures.join("; ")}`);
if (enforceTarget && target.failures.length) throw new Error(`Desktop bundle target failed: ${target.failures.join("; ")}`);
