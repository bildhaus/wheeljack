import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = join(repositoryRoot, "apps", "docs");
const distRoot = join(appRoot, "dist");
const canonicalOrigin = "https://docs.wheeljack.dev";
const editOrigin = "https://github.com/bildhaus/wheeljack/edit/main/docs/";
const expectedRoutes = [
  "/",
  "/getting-started/installation/",
  "/getting-started/first-project/",
  "/getting-started/connect-agents/",
  "/guides/workspaces-and-panes/",
  "/guides/structured-agents/",
  "/guides/plan-and-review/",
  "/guides/bots/",
  "/guides/settings-and-shortcuts/",
  "/guides/updates-and-recovery/",
  "/reference/local-data-and-permissions/",
  "/reference/architecture/",
  "/reference/agent-adapters/",
  "/contributing/",
  "/help/troubleshooting/",
  "/help/support-and-security/",
];
const requiredFiles = ["404.html", "favicon.svg", "llms.txt", "robots.txt", "sitemap-index.xml"];
const bannedDependencies = ["@tanstack/react-query", "gsap", "lenis", "react", "react-dom", "three", "zustand"];
const errors = [];

function fail(message) {
  errors.push(message);
}

function routeFile(route) {
  if (route === "/") return join(distRoot, "index.html");
  return join(distRoot, ...route.split("/").filter(Boolean), "index.html");
}

function normalizedPath(pathname) {
  const decoded = decodeURIComponent(pathname).replaceAll("\\", "/");
  if (decoded === "/" || extname(decoded)) return decoded;
  return decoded.endsWith("/") ? decoded : `${decoded}/`;
}

function htmlValue(html, expression) {
  return html.match(expression)?.[1]?.trim();
}

function attributes(html, name) {
  return [...html.matchAll(new RegExp(`\\s${name}=["']([^"']+)["']`, "gi"))].map((match) => match[1]);
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return nested.flat();
}

if (!existsSync(distRoot)) throw new Error(`Docs build output is missing: ${distRoot}`);

for (const file of requiredFiles) {
  if (!existsSync(join(distRoot, file))) fail(`Required generated file is missing: ${file}`);
}

const packageJson = JSON.parse(await readFile(join(appRoot, "package.json"), "utf8"));
const declaredDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
for (const dependency of bannedDependencies) {
  if (dependency in declaredDependencies) fail(`Unexpected docs dependency is declared: ${dependency}`);
}

const routeHtml = new Map();
const titles = new Map();
for (const route of expectedRoutes) {
  const file = routeFile(route);
  if (!existsSync(file)) {
    fail(`Expected route is missing: ${route}`);
    continue;
  }

  const html = await readFile(file, "utf8");
  routeHtml.set(route, html);
  const title = htmlValue(html, /<title>([^<]+)<\/title>/i);
  const description = htmlValue(html, /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)
    ?? htmlValue(html, /<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
  const canonical = htmlValue(html, /<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)
    ?? htmlValue(html, /<link\s+href=["']([^"']+)["']\s+rel=["']canonical["']/i);

  if (!title) fail(`Route has no title: ${route}`);
  else if (titles.has(title)) fail(`Duplicate title for ${route} and ${titles.get(title)}: ${title}`);
  else titles.set(title, route);
  if (!description) fail(`Route has no meta description: ${route}`);
  if (!canonical) fail(`Route has no canonical URL: ${route}`);
  else {
    const url = new URL(canonical);
    if (url.origin !== canonicalOrigin) fail(`Route has a non-production canonical: ${route} -> ${canonical}`);
    if (normalizedPath(url.pathname) !== normalizedPath(route)) fail(`Canonical path does not match route: ${route} -> ${canonical}`);
  }
  if (!/<html[^>]+lang=["']en["']/i.test(html)) fail(`Route does not declare English: ${route}`);
  if (!/<h1(?:\s|>)/i.test(html)) fail(`Route has no semantic H1: ${route}`);
  const sourcePath = route === "/" ? "index.md" : `${route.slice(1, -1)}.md`;
  if (!html.includes(`href="${editOrigin}${sourcePath}"`)) fail(`Route has a missing or incorrect Edit page link: ${route}`);
}

for (const [route, html] of routeHtml) {
  for (const href of attributes(html, "href")) {
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) continue;
    const url = new URL(href, `${canonicalOrigin}${route}`);
    if (url.origin !== canonicalOrigin) continue;
    if (url.pathname.startsWith("/_astro/") || url.pathname.startsWith("/pagefind/")) continue;

    const targetPath = normalizedPath(url.pathname);
    const target = extname(targetPath)
      ? join(distRoot, ...targetPath.split("/").filter(Boolean))
      : routeFile(targetPath);
    if (!existsSync(target)) {
      fail(`Broken internal link on ${route}: ${href}`);
      continue;
    }
    if (url.hash && target.endsWith(".html")) {
      const targetHtml = routeHtml.get(targetPath) ?? await readFile(target, "utf8");
      const id = decodeURIComponent(url.hash.slice(1));
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`\\sid=["']${escaped}["']`, "i").test(targetHtml)) fail(`Broken anchor on ${route}: ${href}`);
    }
  }
}

const outputFiles = await filesUnder(distRoot);
const sourceMaps = outputFiles.filter((file) => file.endsWith(".map"));
if (sourceMaps.length) fail(`Public source maps were generated: ${sourceMaps.map((file) => relative(distRoot, file)).join(", ")}`);

for (const file of outputFiles.filter((candidate) => [".html", ".js", ".json", ".txt", ".xml"].includes(extname(candidate)))) {
  const content = await readFile(file, "utf8");
  if (/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i.test(content)) fail(`Local development URL leaked into ${relative(distRoot, file)}`);
  if (/wheeljack-docs\.pages\.dev/i.test(content)) fail(`Provider preview URL leaked into ${relative(distRoot, file)}`);
}

const llms = await readFile(join(distRoot, "llms.txt"), "utf8");
for (const match of llms.matchAll(/https:\/\/docs\.wheeljack\.dev([^\s)]+)/g)) {
  const route = normalizedPath(new URL(match[0]).pathname);
  const target = extname(route) ? join(distRoot, ...route.split("/").filter(Boolean)) : routeFile(route);
  if (!existsSync(target)) fail(`llms.txt links to a missing route: ${match[0]}`);
}

if (errors.length) {
  throw new Error(`Docs site validation failed:\n- ${errors.join("\n- ")}`);
}

const relativeOutput = (file) => relative(repositoryRoot, file).split(sep).join("/");
console.log(`Docs site validated: ${expectedRoutes.length} routes, ${outputFiles.length} files, ${titles.size} unique titles.`);
console.log(`Output: ${relativeOutput(distRoot)}`);
