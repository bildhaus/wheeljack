import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareDesktopRelease } from "./prepare-desktop-release.mjs";
import { verifyDesktopVersion } from "./verify-desktop-version.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRoot(version = "1.2.3") {
  const root = await mkdtemp(join(tmpdir(), "wheeljack-release-contract-"));
  roots.push(root);
  await mkdir(join(root, "apps/desktop/src-tauri"), { recursive: true });
  await writeFile(join(root, "VERSION"), `${version}\n`);
  await writeFile(join(root, "apps/desktop/package.json"), JSON.stringify({ version }));
  await writeFile(join(root, "apps/desktop/src-tauri/tauri.conf.json"), JSON.stringify({ version }));
  await writeFile(join(root, "Cargo.toml"), `[workspace.package]\nversion = "${version}"\n`);
  await writeFile(join(root, "Cargo.lock"), [
    "[[package]]",
    'name = "wheeljack-core"',
    `version = "${version}"`,
    "",
    "[[package]]",
    'name = "wheeljack-desktop"',
    `version = "${version}"`,
    "",
  ].join("\n"));
  return root;
}

const hash = (content) => createHash("sha256").update(content).digest("hex");

async function writePackage(directory, name, content = `package:${name}`) {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, name), content);
  await writeFile(join(directory, `${name}.sha256`), `${hash(content)}  ${name}\n`, "ascii");
}

describe("desktop version contract", () => {
  test("accepts aligned source and lockfile versions", async () => {
    const root = await fixtureRoot();
    expect(await verifyDesktopVersion(root, "v1.2.3")).toBe("1.2.3");
  });

  test("rejects a stale Cargo.lock package version", async () => {
    const root = await fixtureRoot();
    const lock = (await readFile(join(root, "Cargo.lock"), "utf8")).replace('version = "1.2.3"', 'version = "1.2.2"');
    await writeFile(join(root, "Cargo.lock"), lock);
    await expect(verifyDesktopVersion(root)).rejects.toThrow("Desktop versions do not match");
  });

  test("rejects a release tag for another version", async () => {
    const root = await fixtureRoot();
    await expect(verifyDesktopVersion(root, "v1.2.2")).rejects.toThrow("must equal v1.2.3");
  });
});

describe("desktop release asset contract", () => {
  test("runs updater proof from a writable app bundle", async () => {
    const workflow = await readFile(join(import.meta.dirname, "../.github/workflows/desktop.yml"), "utf8");
    expect(workflow).toContain('smoke-desktop-update-macos.mjs --app "$app"');
    expect(workflow).not.toContain('smoke-desktop-update-macos.mjs --app "$installed_app"');
    expect(workflow).toContain('--verify-signature "$REQUIRE_SIGNED_MACOS"');

    const smoke = await readFile(join(import.meta.dirname, "smoke-desktop-update-macos.mjs"), "utf8");
    expect(smoke).toContain('verifySignature ? {} : { WHEELJACK_SKIP_SIGNATURE_VERIFY: "1" }');
    expect(smoke).toContain("binaryPaths.add(await realpath(binary))");
    expect(smoke).toContain("detached: true");
    expect(smoke).toContain("process.kill(-processGroupId, signal)");
    expect(smoke).toContain("await stopTestApps(processGroupId)");
  });

  test("keeps Windows packaging portable-only", async () => {
    const workflow = await readFile(join(import.meta.dirname, "../.github/workflows/desktop.yml"), "utf8");
    expect(workflow).not.toContain("smoke-desktop-installer-windows.ps1");

    const publish = await readFile(join(import.meta.dirname, "publish-desktop-windows.ps1"), "utf8");
    expect(publish).toContain("@('tauri', 'build', '--no-bundle')");
    expect(publish).not.toMatch(/\.msi|x64-setup|x64_en-US/);
    expect(publish).not.toContain("SHA256SUMS-windows.txt");
    expect(publish).not.toContain("THIRD_PARTY_NOTICES.md");
  });

  test("keeps platform artifacts limited to release inputs", async () => {
    const publish = await readFile(join(import.meta.dirname, "publish-desktop-macos.sh"), "utf8");
    expect(publish).not.toContain("SHA256SUMS-macos.txt");
    expect(publish).not.toContain("THIRD_PARTY_NOTICES.md");
  });

  test("assembles the exact public asset set", async () => {
    const root = await fixtureRoot();
    const windows = join(root, "release-input/windows");
    const macos = join(root, "release-input/macos");
    const output = join(root, "release-assets");
    await writePackage(windows, "wheeljack-windows-x64-portable.exe");
    await writePackage(macos, "wheeljack-macos-universal.dmg");
    await writePackage(macos, "wheeljack.app.zip");

    expect(await prepareDesktopRelease({ root, windows, macos, output })).toBe(7);
    const manifest = await readFile(join(output, "SHA256SUMS.txt"), "ascii");
    expect(manifest.trim().split("\n")).toHaveLength(3);
  });

  test("rejects corrupt and missing packages with actionable errors", async () => {
    const root = await fixtureRoot();
    const windows = join(root, "release-input/windows");
    const macos = join(root, "release-input/macos");
    const output = join(root, "release-assets");
    await writePackage(windows, "wheeljack-windows-x64-portable.exe");
    await writePackage(macos, "wheeljack-macos-universal.dmg");
    await writePackage(macos, "wheeljack.app.zip");
    await writeFile(join(windows, "wheeljack-windows-x64-portable.exe"), "corrupt");

    await expect(prepareDesktopRelease({ root, windows, macos, output })).rejects.toThrow("Release checksum does not match");
    await rm(join(windows, "wheeljack-windows-x64-portable.exe"));
    await expect(prepareDesktopRelease({ root, windows, macos, output })).rejects.toThrow("Release package is missing");
  });

  test("reports a missing checksum sidecar explicitly", async () => {
    const root = await fixtureRoot();
    const windows = join(root, "release-input/windows");
    const macos = join(root, "release-input/macos");
    const output = join(root, "release-assets");
    await writePackage(windows, "wheeljack-windows-x64-portable.exe");
    await writePackage(macos, "wheeljack-macos-universal.dmg");
    await writePackage(macos, "wheeljack.app.zip");
    await rm(join(macos, "wheeljack.app.zip.sha256"));

    await expect(prepareDesktopRelease({ root, windows, macos, output })).rejects.toThrow("Release checksum sidecar is missing");
  });

  test("refuses an output directory that contains release inputs", async () => {
    const root = await fixtureRoot();
    const input = join(root, "release-input");
    await expect(prepareDesktopRelease({
      root,
      windows: join(input, "windows"),
      macos: join(input, "macos"),
      output: input,
    })).rejects.toThrow("Release output must not contain either input directory");
  });
});

describe("workflow ownership contract", () => {
  test("keeps routine CI unprivileged and merge-result based", async () => {
    const workflow = await readFile(join(import.meta.dirname, "../.github/workflows/ci.yml"), "utf8");
    expect(workflow).not.toContain("secrets: inherit");
    expect(workflow).not.toContain("github.event.pull_request.head.sha");
    expect(workflow).not.toContain("artifact_retention_days");
    expect(workflow).toContain("checkout_ref: ${{ github.sha }}");
    expect(workflow).toContain("cancel-in-progress: true");
    expect(workflow).toContain("github.event_name == 'pull_request' && needs.repo.outputs.desktop == 'true'");
    expect(workflow).toContain("github.event_name == 'pull_request' && needs.repo.outputs.docs == 'true'");
    expect(workflow).toContain("needs: [repo, site, docs, desktop]");
  });

  test("keeps signing, environments, and artifacts release owned", async () => {
    const desktop = await readFile(join(import.meta.dirname, "../.github/workflows/desktop.yml"), "utf8");
    const release = await readFile(join(import.meta.dirname, "../.github/workflows/release.yml"), "utf8");
    expect(desktop.match(/if: inputs\.release_mode\r?\n\s+uses: actions\/upload-artifact/g)).toHaveLength(2);
    expect(desktop.match(/environment: \$\{\{ inputs\.release_environment \|\| null \}\}/g)).toHaveLength(2);
    expect(desktop).not.toContain("RUST_VERSION");
    expect(desktop).toContain("rust-toolchain.toml");
    expect(desktop).not.toContain('xcrun stapler validate artifacts/desktop/macos');
    expect(release).not.toContain("secrets: inherit");
    expect(release).not.toContain("push:\n    tags:");
    expect(release).toContain("release_environment: desktop-release");
    expect(release).toContain("environment: desktop-release");
    expect(release).toContain("require_signed_windows: false");
  });

  test("keeps public site delivery main-only and explicitly gated", async () => {
    const site = await readFile(join(import.meta.dirname, "../.github/workflows/site.yml"), "utf8");
    expect(site).toContain("github.ref == 'refs/heads/main'");
    expect(site).toContain("vars.PUBLIC_SITE_ENABLED == 'true'");
    expect(site).toContain("needs.release.outputs.published == 'true'");
    expect(site).toContain('gh api "repos/$GITHUB_REPOSITORY/releases/tags/$tag"');
    expect(site).toContain('jq -r .draft');
    expect(site).toContain('jq -r .prerelease');
    expect(site).toContain("name: site-production");
    expect(site).toContain("--project-name wheeljack --branch main");
    expect(site).toContain("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}");
    expect(site).toContain("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}");
    expect(site).toContain("- 'VERSION'");
  });

  test("keeps documentation delivery main-only, independent, and explicitly gated", async () => {
    const docs = await readFile(join(import.meta.dirname, "../.github/workflows/docs.yml"), "utf8");
    expect(docs).toContain("github.ref == 'refs/heads/main'");
    expect(docs).toContain("vars.PUBLIC_DOCS_ENABLED == 'true'");
    expect(docs).toContain("name: docs-production");
    expect(docs).toContain("url: https://docs.wheeljack.dev");
    expect(docs).toContain("--project-name wheeljack-docs --branch main");
    expect(docs).toContain("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}");
    expect(docs).toContain("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}");
    expect(docs).not.toContain("Resolve public release");
    expect(docs).not.toContain("VERSION");
  });

  test("keeps published download controls live and signing status explicit", async () => {
    const app = await readFile(join(import.meta.dirname, "../apps/site/src/App.tsx"), "utf8");
    const fallback = await readFile(join(import.meta.dirname, "../apps/site/index.html"), "utf8");
    expect(app).toContain("const downloadsLive = true;");
    expect(app).toContain("releases/latest/download/wheeljack-windows-x64-portable.exe");
    expect(app).toContain("releases/latest/download/wheeljack-macos-universal.dmg");
    expect(app).toContain("Your workspace is ready.");
    expect(app).toContain("macOS builds are signed and notarized. Windows builds are currently unsigned.");
    expect(app).toContain('id: "bots"');
    expect(app).toContain("Updates include a recovery path.");
    expect(app).toContain("Upgrading from v0.1.0 requires this one-time manual download");
    expect(app).toContain("__WHEELJACK_VERSION__");
    expect(app).toContain("SHA256SUMS.txt");
    expect(app).toContain('href="https://docs.wheeljack.dev">Docs</a>');
    expect(app).toContain('href="https://github.com/bildhaus/wheeljack">GitHub</a>');
    expect(app).toContain("https://github.com/bildhaus/wheeljack/issues/new/choose");
    expect(fallback).toContain('href="https://docs.wheeljack.dev">Docs</a>');
    expect(fallback).toContain('href="https://github.com/bildhaus/wheeljack">GitHub</a>');
    expect(fallback).toContain("%WHEELJACK_VERSION%");
    expect(fallback).toContain("og-wheeljack.png");
    expect(fallback).toContain("Controlled autonomy");
    expect(fallback).toContain("Upgrading from v0.1.0 requires a one-time manual download");
    expect(fallback).toContain("https://github.com/bildhaus/wheeljack/issues/new/choose");
  });
});
