import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const sourceApp = resolve(argument("--app") ?? "");
const expectRollback = argument("--expect-rollback") === "true";
const verifySignature = argument("--verify-signature") === "true";
await access(join(sourceApp, "Contents/MacOS/wheeljack-desktop"));

const root = resolve(import.meta.dirname, "..");
const version = (await readFile(join(root, "VERSION"), "utf8")).trim();
const versionParts = version.split(".").map(Number);
versionParts[versionParts.length - 1] += 1;
const nextVersion = versionParts.join(".");
const temporary = await mkdtemp(join(tmpdir(), "wheeljack-macos-updater-"));
const targetApp = join(temporary, "wheeljack.app");
const profile = join(temporary, "profile");
const archive = join(temporary, "wheeljack.app.zip");
await mkdir(profile);

const run = async (command, args) => {
  const child = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${command} failed: ${stderr || stdout}`);
  return stdout.trim();
};
const hashFile = async (path) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};
const waitFor = async (predicate, description, milliseconds = 90_000) => {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await Bun.sleep(200);
  }
  throw new Error(`Timed out waiting for ${description}.`);
};

let server;
try {
  await run("/usr/bin/ditto", [sourceApp, targetApp]);
  await run("/usr/bin/ditto", ["-c", "-k", "--keepParent", targetApp, archive]);
  const archiveHash = await hashFile(archive);
  const archiveSize = (await stat(archive)).size;
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      const origin = `http://127.0.0.1:${server.port}`;
      if (path === "/release") {
        return Response.json({
          tagName: `v${nextVersion}`,
          body: "macOS updater smoke",
          publishedAt: new Date().toISOString(),
          assets: [
            {
              name: "wheeljack.app.zip",
              browserDownloadUrl: `${origin}/wheeljack.app.zip`,
              size: archiveSize,
            },
            {
              name: "wheeljack.app.zip.sha256",
              browserDownloadUrl: `${origin}/wheeljack.app.zip.sha256`,
              size: 64,
            },
          ],
        });
      }
      if (path === "/wheeljack.app.zip") return new Response(Bun.file(archive));
      if (path === "/wheeljack.app.zip.sha256") {
        return new Response(`${archiveHash}  wheeljack.app.zip\n`);
      }
      return new Response("not found", { status: 404 });
    },
  });

  const binary = join(targetApp, "Contents/MacOS/wheeljack-desktop");
  const originalInode = await run("/usr/bin/stat", ["-f", "%i", binary]);
  const child = Bun.spawn([binary, "--ui-smoke"], {
    env: {
      ...process.env,
      WHEELJACK_DESKTOP_DATA_DIR: profile,
      WHEELJACK_DESKTOP_VERSION_OVERRIDE: version,
      WHEELJACK_UI_SMOKE: "1",
      WHEELJACK_UPDATE_FEED_URL: `http://127.0.0.1:${server.port}/release`,
      WHEELJACK_UPDATE_SMOKE_MODE: expectRollback ? "rollback" : "healthy",
      ...(verifySignature ? {} : { WHEELJACK_SKIP_SIGNATURE_VERIFY: "1" }),
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  await Promise.race([
    child.exited,
    Bun.sleep(90_000).then(() => {
      throw new Error("The original macOS app did not exit for update.");
    }),
  ]);

  const backup = targetApp.replace(/\.app$/, ".app.previous");
  const installLog = join(profile, "updates/install.log");
  if (expectRollback) {
    await waitFor(async () => {
      const log = await readFile(installLog, "utf8").catch(() => "");
      const inode = await run("/usr/bin/stat", ["-f", "%i", binary]).catch(() => "");
      return log.includes("restored the previous app bundle") && inode === originalInode;
    }, "health-confirmed macOS rollback", 60_000);
  } else {
    await waitFor(async () => {
      const inode = await run("/usr/bin/stat", ["-f", "%i", binary]).catch(() => "");
      return inode && inode !== originalInode && !await stat(backup).then(() => true).catch(() => false);
    }, "healthy macOS app replacement", 45_000);
  }
  await access(join(profile, "wheeljack.sqlite3"));
  console.log(expectRollback
    ? "macOS packaged updater rollback passed."
    : "macOS packaged updater replacement and health acknowledgement passed.");

  const processes = await run("/bin/ps", ["-axo", "pid=,command="]);
  for (const line of processes.split("\n").filter((value) => value.includes(binary))) {
    const pid = Number.parseInt(line.trim(), 10);
    if (pid && pid !== process.pid) process.kill(pid, "SIGTERM");
  }
} finally {
  server?.stop(true);
  await Bun.sleep(500);
  await rm(temporary, { recursive: true, force: true });
}
