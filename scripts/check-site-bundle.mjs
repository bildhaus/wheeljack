import { gzipSync } from "node:zlib";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const siteDist = join(import.meta.dirname, "../apps/site/dist");
const assetsDir = join(siteDist, "assets");
const html = await readFile(join(siteDist, "index.html"), "utf8");
const assetNames = await readdir(assetsDir);
const entryMatch = html.match(/<script[^>]+src="\/assets\/(?<name>[^"]+\.js)"/);
const styleMatches = [...html.matchAll(/<link[^>]+href="\/assets\/(?<name>[^"]+\.css)"/g)];
if (!entryMatch?.groups?.name || styleMatches.length !== 1) throw new Error("Expected one site entry script and one entry stylesheet.");

const measure = async (path) => {
  const content = await readFile(path);
  return { bytes: content.byteLength, gzipBytes: gzipSync(content, { level: 9 }).byteLength };
};
const entry = await measure(join(assetsDir, entryMatch.groups.name));
const entryCss = await measure(join(assetsDir, styleMatches[0].groups.name));
const jsChunks = await Promise.all(assetNames.filter((name) => name.endsWith(".js")).map(async (name) => ({ name, ...(await measure(join(assetsDir, name))) })));
const largestJs = jsChunks.sort((left, right) => right.bytes - left.bytes)[0];
const modelPath = join(siteDist, "models/wheeljack-web.glb");
const modelBytes = (await stat(modelPath)).size;
const metrics = { entryJsBytes: entry.bytes, entryJsGzipBytes: entry.gzipBytes, entryCssBytes: entryCss.bytes, largestJsChunk: largestJs, modelBytes };
const ceilings = { entryJsBytes: 460_000, entryJsGzipBytes: 160_000, entryCssBytes: 70_000, largestJsBytes: 650_000, largestJsGzipBytes: 170_000, modelBytes: 900_000 };
const failures = [];
if (entry.bytes >= 457_385) failures.push(`entry JS did not improve from the 457385-byte baseline (${entry.bytes})`);
if (entry.bytes > ceilings.entryJsBytes) failures.push(`entry JS ${entry.bytes} > ${ceilings.entryJsBytes}`);
if (entry.gzipBytes > ceilings.entryJsGzipBytes) failures.push(`entry JS gzip ${entry.gzipBytes} > ${ceilings.entryJsGzipBytes}`);
if (entryCss.bytes > ceilings.entryCssBytes) failures.push(`entry CSS ${entryCss.bytes} > ${ceilings.entryCssBytes}`);
if (largestJs.bytes > ceilings.largestJsBytes) failures.push(`largest JS ${largestJs.bytes} > ${ceilings.largestJsBytes}`);
if (largestJs.gzipBytes > ceilings.largestJsGzipBytes) failures.push(`largest JS gzip ${largestJs.gzipBytes} > ${ceilings.largestJsGzipBytes}`);
if (modelBytes > ceilings.modelBytes) failures.push(`GLB ${modelBytes} > ${ceilings.modelBytes}`);

console.log(`SITE_BUNDLE_METRICS ${JSON.stringify({ baselineEntryJsBytes: 457_385, ceilings, metrics })}`);
if (failures.length) throw new Error(`Site bundle contract failed: ${failures.join("; ")}`);
