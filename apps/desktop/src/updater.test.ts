import { act, renderHook, waitFor } from "@testing-library/react";
import { callCore } from "./core";
import {
  BACKGROUND_CHECK_GUARD_MS,
  STARTUP_CHECK_GUARD_MS,
  compareUpdateVersions,
  installedReleaseAfterHealth,
  normalizeUpdateState,
  shouldAutomaticallyCheck,
  updateVersionsMatch,
  UPDATE_STORAGE_KEY,
  useUpdater,
} from "./updater";
import updaterSource from "./updater.ts?raw";

vi.mock("./core", () => ({ callCore: vi.fn() }));

const availableUpdate = {
  version: "0.1.1",
  platform: "windows-x86_64",
  assetName: "wheeljack-windows-x64-portable.exe",
  downloadUrl: "https://example.test/wheeljack.exe",
  sha256: "a".repeat(64),
};

function mockUpdaterCore() {
  vi.mocked(callCore).mockImplementation(async (command) => {
    if (command === "updater_recovery_error") return null as never;
    if (command === "updater_check") return {
      currentVersion: "0.1.0",
      update: availableUpdate,
      message: "Update available",
    } as never;
    if (command === "updater_download") return {
      version: "0.1.1",
      assetName: availableUpdate.assetName,
      updatePath: "updates/wheeljack-0.1.1.exe",
      signatureStatus: "unsigned",
      message: "Downloaded",
    } as never;
    throw new Error(`Unexpected updater command: ${command}`);
  });
}

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
  expect(normalizeUpdateState({
    pendingRelease: { version: "0.1.1", notes: "Shipped" },
  }, "0.1.1").pendingRelease).toEqual({ version: "0.1.1", notes: "Shipped" });
  expect(normalizeUpdateState({
    pendingRelease: { version: "0.1.1", notes: "Old" },
  }, "0.1.2").pendingRelease).toBeUndefined();
});

test("compares updater versions and enforces startup and background guards", () => {
  expect(compareUpdateVersions("v0.2.0", "0.1.9")).toBe(1);
  expect(compareUpdateVersions("0.1.1-beta.1", "0.1.1")).toBe(0);
  expect(updateVersionsMatch("v0.1.1", "0.1.1")).toBe(true);
  expect(updateVersionsMatch("0.1.1-beta.1", "0.1.1")).toBe(false);
  const now = 1_000_000_000;
  expect(shouldAutomaticallyCheck(now - STARTUP_CHECK_GUARD_MS + 1, STARTUP_CHECK_GUARD_MS, now)).toBe(false);
  expect(shouldAutomaticallyCheck(now - STARTUP_CHECK_GUARD_MS, STARTUP_CHECK_GUARD_MS, now)).toBe(true);
  expect(shouldAutomaticallyCheck(now - BACKGROUND_CHECK_GUARD_MS + 1, BACKGROUND_CHECK_GUARD_MS, now)).toBe(false);
});

test("automatic checks may download but installation stays a separate recoverable action", () => {
  expect(updaterSource).toContain("if (checked.update && downloadAutomatically) await downloadNow()");
  expect(updaterSource).toContain("checkNow: () => runCheck(false)");
  expect(updaterSource).toContain("shouldAutomaticallyCheck(current.lastCheckedAt, STARTUP_CHECK_GUARD_MS)");
  expect(updaterSource.match(/await applyUpdate\(updatePath\)/g)).toHaveLength(1);
  expect(updaterSource).toContain('status: "ready", error: errorMessage(cause)');
  expect(updaterSource).toContain('status: current.update ? "available" : "error"');
  expect(updaterSource).toContain("updatePath: undefined");
});

test("only acknowledges release notes after a matching installed update health check", () => {
  const state = normalizeUpdateState({
    status: "installing",
    automaticCheck: true,
    automaticDownload: true,
    updatePath: "updates/wheeljack-0.1.1.exe",
    update: {
      version: "0.1.1",
      assetName: "wheeljack-windows-x64-portable.exe",
      notes: "New release notes",
      publishedAt: "2026-08-21T10:00:00Z",
    },
  });
  expect(installedReleaseAfterHealth(state, "0.1.2")).toBeUndefined();
  expect(installedReleaseAfterHealth(state, "v0.1.1")).toEqual({
    version: "0.1.1",
    notes: "New release notes",
    publishedAt: "2026-08-21T10:00:00Z",
  });
});

test("manual checks never inherit automatic-download policy", async () => {
  vi.stubEnv("DEV", false);
  localStorage.setItem(UPDATE_STORAGE_KEY, JSON.stringify({
    status: "idle",
    automaticCheck: false,
    automaticDownload: true,
  }));
  mockUpdaterCore();
  const { result, unmount } = renderHook(() => useUpdater("0.1.0", async () => undefined));
  await waitFor(() => expect(vi.mocked(callCore)).toHaveBeenCalledWith("updater_recovery_error", {}));
  vi.mocked(callCore).mockClear();
  await act(async () => result.current.checkNow());
  expect(vi.mocked(callCore).mock.calls.map(([command]) => command)).toEqual(["updater_check"]);
  expect(result.current.status).toBe("available");
  unmount();
  vi.unstubAllEnvs();
});

test("enabling automatic checks runs once only when the startup guard permits", async () => {
  vi.stubEnv("DEV", false);
  localStorage.setItem(UPDATE_STORAGE_KEY, JSON.stringify({
    status: "idle",
    automaticCheck: false,
    automaticDownload: true,
  }));
  mockUpdaterCore();
  const first = renderHook(() => useUpdater("0.1.0", async () => undefined));
  await waitFor(() => expect(vi.mocked(callCore)).toHaveBeenCalledWith("updater_recovery_error", {}));
  vi.mocked(callCore).mockClear();
  act(() => first.result.current.setAutomaticCheck(true));
  await waitFor(() => expect(first.result.current.status).toBe("ready"));
  expect(vi.mocked(callCore).mock.calls.map(([command]) => command)).toEqual(["updater_check", "updater_download"]);
  first.unmount();

  localStorage.setItem(UPDATE_STORAGE_KEY, JSON.stringify({
    status: "idle",
    automaticCheck: false,
    automaticDownload: true,
    lastCheckedAt: Date.now(),
  }));
  vi.mocked(callCore).mockClear();
  const guarded = renderHook(() => useUpdater("0.1.0", async () => undefined));
  await waitFor(() => expect(vi.mocked(callCore)).toHaveBeenCalledWith("updater_recovery_error", {}));
  vi.mocked(callCore).mockClear();
  act(() => guarded.result.current.setAutomaticCheck(true));
  await act(async () => Promise.resolve());
  expect(vi.mocked(callCore)).not.toHaveBeenCalled();
  guarded.unmount();
  vi.unstubAllEnvs();
});
