import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const sha256 = async (path) =>
  createHash("sha256").update(await readFile(path)).digest("hex");

export async function prepareDesktopRelease({ root, windows, macos, output }) {
  const repository = resolve(root);
  const windowsRoot = resolve(windows);
  const macosRoot = resolve(macos);
  const outputRoot = resolve(output);
  if (![windowsRoot, macosRoot, outputRoot].every((path) => path.startsWith(`${repository}${sep}`)) || outputRoot === repository) {
    throw new Error("Release input and output paths must stay inside the repository.");
  }
  if ([windowsRoot, macosRoot].some((path) => path === outputRoot || path.startsWith(`${outputRoot}${sep}`))) {
    throw new Error("Release output must not contain either input directory.");
  }

  const packages = [
    resolve(windowsRoot, "wheeljack-windows-x64-portable.exe"),
    resolve(macosRoot, "wheeljack-macos-universal.dmg"),
    resolve(macosRoot, "wheeljack.app.zip"),
  ];
  const assets = packages.flatMap((path) => [path, `${path}.sha256`]);

  for (const path of packages) {
    const packageStat = await stat(path).catch(() => undefined);
    if (!packageStat?.isFile()) throw new Error(`Release package is missing: ${path}`);
    const sidecar = `${path}.sha256`;
    const sidecarStat = await stat(sidecar).catch(() => undefined);
    if (!sidecarStat?.isFile()) throw new Error(`Release checksum sidecar is missing: ${sidecar}`);
    const values = (await readFile(sidecar, "utf8")).trim().split(/\s+/);
    const [expectedHash, expectedName] = values;
    const name = basename(path);
    if (values.length !== 2 || expectedName !== name || expectedHash?.toLowerCase() !== await sha256(path)) {
      throw new Error(`Release checksum does not match ${name}.`);
    }
  }

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  for (const path of assets) await copyFile(path, resolve(outputRoot, basename(path)));
  const manifest = [];
  for (const path of packages.sort((left, right) => basename(left).localeCompare(basename(right)))) {
    manifest.push(`${await sha256(path)}  ${basename(path)}`);
  }
  await writeFile(resolve(outputRoot, "SHA256SUMS.txt"), `${manifest.join("\n")}\n`, "ascii");
  return assets.length + 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, "..");
  const options = Object.fromEntries(
    process.argv.slice(2).reduce((pairs, value, index, values) => {
      if (value.startsWith("--")) pairs.push([value.slice(2), values[index + 1]]);
      return pairs;
    }, []),
  );
  const count = await prepareDesktopRelease({
    root,
    windows: resolve(options.windows ?? ""),
    macos: resolve(options.macos ?? ""),
    output: resolve(options.output ?? ""),
  });
  const version = (await readFile(resolve(root, "VERSION"), "utf8")).trim();
  console.log(`Prepared ${count} immutable release assets for v${version}.`);
}
