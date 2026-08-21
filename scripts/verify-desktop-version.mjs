import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const packageVersionFromLock = (lock, name) =>
  lock.match(new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = "([^"]+)"`))?.[1];

export async function verifyDesktopVersion(root, releaseTag = process.env.WHEELJACK_RELEASE_TAG) {
  const read = (path) => readFile(resolve(root, path), "utf8");
  const version = (await read("VERSION")).trim();
  const packageVersion = JSON.parse(await read("apps/desktop/package.json")).version;
  const tauriVersion = JSON.parse(await read("apps/desktop/src-tauri/tauri.conf.json")).version;
  const cargoVersion = (await read("Cargo.toml")).match(/\[workspace\.package\][\s\S]*?\bversion\s*=\s*"([^"]+)"/)?.[1];
  const cargoLock = await read("Cargo.lock");
  const versions = {
    VERSION: version,
    package: packageVersion,
    tauri: tauriVersion,
    cargo: cargoVersion ?? null,
    cargoLockCore: packageVersionFromLock(cargoLock, "wheeljack-core") ?? null,
    cargoLockDesktop: packageVersionFromLock(cargoLock, "wheeljack-desktop") ?? null,
  };

  if (!version || Object.values(versions).some((value) => value !== version)) {
    throw new Error(`Desktop versions do not match: ${JSON.stringify(versions)}`);
  }
  if (releaseTag && releaseTag !== `v${version}`) {
    throw new Error(`Release tag ${releaseTag} must equal v${version}.`);
  }
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, "..");
  const version = await verifyDesktopVersion(root);
  console.log(`Desktop version ${version} is aligned.`);
}
