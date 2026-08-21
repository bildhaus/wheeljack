import {
  BACKGROUND_CHECK_GUARD_MS,
  STARTUP_CHECK_GUARD_MS,
  compareUpdateVersions,
  normalizeUpdateState,
  shouldAutomaticallyCheck,
} from "./updater";
import updaterSource from "./updater.ts?raw";

test("normalizes persisted updater state and clears an installed staged update", () => {
  expect(normalizeUpdateState({}).automaticDownload).toBe(true);
  expect(normalizeUpdateState({ status: "downloading", update: {
    version: "0.1.1",
    assetName: "wheeljack-windows-x64-portable.exe",
  } }).status).toBe("available");
  expect(normalizeUpdateState({
    status: "installing",
    updatePath: "updates/wheeljack-0.1.1.exe",
    update: { version: "0.1.1", assetName: "wheeljack-windows-x64-portable.exe" },
  }).status).toBe("ready");
  expect(normalizeUpdateState({
    status: "ready",
    updatePath: "updates/wheeljack-0.1.1.exe",
    update: { version: "0.1.1", assetName: "wheeljack-windows-x64-portable.exe" },
  }, "0.1.1")).toMatchObject({ status: "idle", update: undefined, updatePath: undefined });
});

test("compares updater versions and enforces startup and background guards", () => {
  expect(compareUpdateVersions("v0.2.0", "0.1.9")).toBe(1);
  expect(compareUpdateVersions("0.1.1-beta.1", "0.1.1")).toBe(0);
  const now = 1_000_000_000;
  expect(shouldAutomaticallyCheck(now - STARTUP_CHECK_GUARD_MS + 1, STARTUP_CHECK_GUARD_MS, now)).toBe(false);
  expect(shouldAutomaticallyCheck(now - STARTUP_CHECK_GUARD_MS, STARTUP_CHECK_GUARD_MS, now)).toBe(true);
  expect(shouldAutomaticallyCheck(now - BACKGROUND_CHECK_GUARD_MS + 1, BACKGROUND_CHECK_GUARD_MS, now)).toBe(false);
});

test("automatic checks may download but installation stays a separate recoverable action", () => {
  expect(updaterSource).toContain("if (checked.update && automaticDownload) await downloadNow()");
  expect(updaterSource.match(/await applyUpdate\(updatePath\)/g)).toHaveLength(1);
  expect(updaterSource).toContain('status: "ready", error: errorMessage(cause)');
  expect(updaterSource).toContain('status: current.update ? "available" : "error"');
  expect(updaterSource).toContain("updatePath: undefined");
});
