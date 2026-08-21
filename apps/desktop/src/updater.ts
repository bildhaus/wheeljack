import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callCore } from "./core";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "disabled"
  | "error";

export interface UpdateInfo {
  version: string;
  notes?: string;
  publishedAt?: string;
  platform: string;
  assetName: string;
  downloadUrl: string;
  sha256: string;
  size?: number;
}

interface UpdateCheck {
  currentVersion: string;
  update?: UpdateInfo;
  message: string;
}

export interface UpdateDownload {
  version: string;
  assetName: string;
  updatePath: string;
  signatureStatus: string;
  message: string;
}

export interface UpdateProgress {
  phase: string;
  downloadedBytes: number;
  totalBytes?: number;
}

export interface InstalledReleaseInfo {
  version: string;
  notes?: string;
  publishedAt?: string;
}

export interface UpdateState {
  status: UpdateStatus;
  automaticCheck: boolean;
  automaticDownload: boolean;
  lastCheckedAt?: number;
  update?: UpdateInfo;
  updatePath?: string;
  signatureStatus?: string;
  error?: string;
  recoveryError?: string;
  progress?: UpdateProgress;
  pendingRelease?: InstalledReleaseInfo;
}

export interface UpdateController extends UpdateState {
  checkNow: () => Promise<void>;
  downloadNow: () => Promise<UpdateDownload | undefined>;
  installNow: (updatePath?: string) => Promise<boolean>;
  onProgress: (progress: UpdateProgress) => void;
  setAutomaticCheck: (enabled: boolean) => void;
  setAutomaticDownload: (enabled: boolean) => void;
  dismissError: () => void;
  acknowledgeInstalledUpdate: (installedVersion: string) => void;
  dismissInstalledRelease: () => void;
}

export const UPDATE_STORAGE_KEY = "wheeljack.local.updates";
export const STARTUP_CHECK_GUARD_MS = 120 * 60 * 1000;
export const BACKGROUND_CHECK_GUARD_MS = 12 * 60 * 60 * 1000;

const statuses = new Set<UpdateStatus>([
  "idle",
  "checking",
  "up-to-date",
  "available",
  "downloading",
  "ready",
  "installing",
  "disabled",
  "error",
]);

const defaults: UpdateState = {
  status: "idle",
  automaticCheck: true,
  automaticDownload: true,
};

export function compareUpdateVersions(left: string, right: string): number {
  const parts = (value: string) =>
    value
      .trim()
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const leftParts = parts(left);
  const rightParts = parts(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function updateVersionsMatch(left: string, right: string): boolean {
  return left.trim().replace(/^v/i, "") === right.trim().replace(/^v/i, "");
}

export function shouldAutomaticallyCheck(lastCheckedAt: number | undefined, guardMs: number, now = Date.now()): boolean {
  return !lastCheckedAt || now - lastCheckedAt >= guardMs;
}

export function normalizeUpdateState(value: unknown, currentVersion?: string): UpdateState {
  if (!value || typeof value !== "object") return defaults;
  const stored = value as Partial<UpdateState>;
  const update = stored.update
    && typeof stored.update.version === "string"
    && typeof stored.update.assetName === "string"
    ? stored.update
    : undefined;
  const updatePath = typeof stored.updatePath === "string" && stored.updatePath ? stored.updatePath : undefined;
  const stale = Boolean(update && currentVersion && compareUpdateVersions(currentVersion, update.version) >= 0);
  const storedPendingRelease = stored.pendingRelease
    && typeof stored.pendingRelease.version === "string"
    ? stored.pendingRelease
    : undefined;
  const pendingRelease = storedPendingRelease
    && (!currentVersion || updateVersionsMatch(storedPendingRelease.version, currentVersion))
    ? storedPendingRelease
    : undefined;
  const status = statuses.has(stored.status as UpdateStatus) ? stored.status as UpdateStatus : "idle";
  const recoveredStatus = updatePath ? "ready" : update ? "available" : status === "up-to-date" ? status : "idle";
  return {
    status: stale ? "idle" : ["checking", "downloading", "installing", "error"].includes(status) ? recoveredStatus : status,
    automaticCheck: typeof stored.automaticCheck === "boolean" ? stored.automaticCheck : true,
    automaticDownload: typeof stored.automaticDownload === "boolean" ? stored.automaticDownload : true,
    lastCheckedAt: typeof stored.lastCheckedAt === "number" && Number.isFinite(stored.lastCheckedAt)
      ? stored.lastCheckedAt
      : undefined,
    update: stale ? undefined : update,
    updatePath: stale ? undefined : updatePath,
    signatureStatus: stale || typeof stored.signatureStatus !== "string" ? undefined : stored.signatureStatus,
    error: typeof stored.error === "string" ? stored.error : undefined,
    recoveryError: typeof stored.recoveryError === "string" ? stored.recoveryError : undefined,
    pendingRelease,
  };
}

export function installedReleaseAfterHealth(
  state: UpdateState,
  installedVersion: string,
): InstalledReleaseInfo | undefined {
  if (!state.update || !updateVersionsMatch(state.update.version, installedVersion)) return undefined;
  return {
    version: state.update.version,
    notes: state.update.notes,
    publishedAt: state.update.publishedAt,
  };
}

function loadState(): UpdateState {
  try {
    return normalizeUpdateState(JSON.parse(localStorage.getItem(UPDATE_STORAGE_KEY) ?? "null"));
  } catch {
    return defaults;
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function useUpdater(
  currentVersion: string | undefined,
  applyUpdate: (updatePath: string) => Promise<void>,
): UpdateController {
  const [state, setState] = useState<UpdateState>(loadState);
  const stateRef = useRef(state);
  const startupVersionRef = useRef<string | undefined>(undefined);
  const checkPromiseRef = useRef<Promise<void> | undefined>(undefined);
  const commit = useCallback((change: UpdateState | ((current: UpdateState) => UpdateState)) => {
    setState((current) => {
      const next = typeof change === "function" ? change(current) : change;
      stateRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    try {
      const { progress: _progress, ...persisted } = state;
      localStorage.setItem(UPDATE_STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      // Updates still work when storage is unavailable.
    }
  }, [state]);

  const downloadNow = useCallback(async () => {
    commit((current) => ({ ...current, status: "downloading", error: undefined, progress: undefined }));
    try {
      const downloaded = await callCore<UpdateDownload>("updater_download", {});
      commit((current) => ({
        ...current,
        status: "ready",
        updatePath: downloaded.updatePath,
        signatureStatus: downloaded.signatureStatus,
        error: undefined,
      }));
      return downloaded;
    } catch (cause) {
      commit((current) => ({
        ...current,
        status: current.update ? "available" : "error",
        error: errorMessage(cause),
        progress: undefined,
      }));
      return undefined;
    }
  }, [commit]);

  const runCheck = useCallback((downloadAutomatically: boolean) => {
    if (checkPromiseRef.current) return checkPromiseRef.current;
    const checking = (async () => {
      if (import.meta.env.DEV) {
        commit((current) => ({ ...current, status: "disabled", error: undefined }));
        return;
      }
      commit((current) => ({ ...current, status: "checking", error: undefined, progress: undefined }));
      try {
        const checked = await callCore<UpdateCheck>("updater_check", {});
        const checkedAt = Date.now();
        commit((current) => ({
          ...current,
          status: checked.update ? "available" : "up-to-date",
          lastCheckedAt: checkedAt,
          update: checked.update,
          updatePath: undefined,
          signatureStatus: undefined,
          error: undefined,
        }));
        if (checked.update && downloadAutomatically) await downloadNow();
      } catch (cause) {
        commit((current) => ({
          ...current,
          status: current.updatePath ? "ready" : current.update ? "available" : "error",
          error: errorMessage(cause),
        }));
      }
    })();
    checkPromiseRef.current = checking;
    checking.then(
      () => {
        if (checkPromiseRef.current === checking) checkPromiseRef.current = undefined;
      },
      () => {
        if (checkPromiseRef.current === checking) checkPromiseRef.current = undefined;
      },
    );
    return checking;
  }, [commit, downloadNow]);

  useEffect(() => {
    if (!currentVersion || startupVersionRef.current === currentVersion) return;
    startupVersionRef.current = currentVersion;
    const normalized = normalizeUpdateState(stateRef.current, currentVersion);
    commit(normalized);
    void callCore<string | null>("updater_recovery_error", {})
      .then((recoveryError) => {
        if (recoveryError) {
          commit((current) => ({
            ...current,
            status: current.update ? "available" : "error",
            updatePath: undefined,
            signatureStatus: undefined,
            recoveryError,
          }));
        }
      })
      .catch(() => undefined);
    if (import.meta.env.DEV) {
      commit((current) => ({ ...current, status: "disabled" }));
      return;
    }
    if (normalized.automaticCheck
      && shouldAutomaticallyCheck(normalized.lastCheckedAt, STARTUP_CHECK_GUARD_MS)) {
      void runCheck(normalized.automaticDownload);
    }
  }, [commit, currentVersion, runCheck]);

  useEffect(() => {
    if (!currentVersion || import.meta.env.DEV) return;
    const timer = window.setInterval(() => {
      const current = stateRef.current;
      if (current.automaticCheck
        && shouldAutomaticallyCheck(current.lastCheckedAt, BACKGROUND_CHECK_GUARD_MS)) {
        void runCheck(current.automaticDownload);
      }
    }, 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [currentVersion, runCheck]);

  const installNow = useCallback(async (requestedUpdatePath?: string) => {
    const updatePath = requestedUpdatePath ?? stateRef.current.updatePath;
    if (!updatePath) return false;
    commit((current) => ({ ...current, status: "installing", error: undefined }));
    try {
      await applyUpdate(updatePath);
      return true;
    } catch (cause) {
      commit((current) => ({ ...current, status: "ready", error: errorMessage(cause) }));
      return false;
    }
  }, [applyUpdate, commit]);

  const onProgress = useCallback((progress: UpdateProgress) => {
    commit((current) => ({ ...current, progress }));
  }, [commit]);

  const setAutomaticCheck = useCallback((automaticCheck: boolean) => {
    const current = stateRef.current;
    commit((latest) => ({ ...latest, automaticCheck }));
    if (
      automaticCheck
      && !current.automaticCheck
      && currentVersion
      && !import.meta.env.DEV
      && shouldAutomaticallyCheck(current.lastCheckedAt, STARTUP_CHECK_GUARD_MS)
    ) {
      void runCheck(current.automaticDownload);
    }
  }, [commit, currentVersion, runCheck]);

  const acknowledgeInstalledUpdate = useCallback((installedVersion: string) => {
    commit((current) => {
      const pendingRelease = installedReleaseAfterHealth(current, installedVersion);
      if (!pendingRelease) return current;
      return {
        ...current,
        status: "idle",
        update: undefined,
        updatePath: undefined,
        signatureStatus: undefined,
        error: undefined,
        recoveryError: undefined,
        progress: undefined,
        pendingRelease,
      };
    });
  }, [commit]);

  return useMemo(() => ({
    ...state,
    checkNow: () => runCheck(false),
    downloadNow,
    installNow,
    onProgress,
    setAutomaticCheck,
    setAutomaticDownload: (automaticDownload: boolean) => commit((current) => ({ ...current, automaticDownload })),
    dismissError: () => commit((current) => ({ ...current, error: undefined, recoveryError: undefined })),
    acknowledgeInstalledUpdate,
    dismissInstalledRelease: () => commit((current) => ({ ...current, pendingRelease: undefined })),
  }), [acknowledgeInstalledUpdate, commit, downloadNow, installNow, onProgress, runCheck, setAutomaticCheck, state]);
}
