export type RunPhase =
  | "idle"
  | "starting"
  | "working"
  | "waiting"
  | "verifying"
  | "success"
  | "stopped"
  | "error"
  | "offline";

export type RunTone =
  | "neutral"
  | "active"
  | "attention"
  | "success"
  | "destructive"
  | "muted";

export type RunStateMotion = "none" | "pulse";

export type RunStateIcon =
  | "idle"
  | "starting"
  | "working"
  | "waiting"
  | "verifying"
  | "success"
  | "stopped"
  | "error"
  | "offline";

export interface RunStatePresentation {
  phase: RunPhase;
  label: string;
  tone: RunTone;
  motion: RunStateMotion;
  icon: RunStateIcon;
  ariaLabel: string;
}

const states: Record<string, Omit<RunStatePresentation, "ariaLabel">> = {
  ready: { phase: "idle", label: "Ready", tone: "neutral", motion: "none", icon: "idle" },
  pending: { phase: "idle", label: "Pending", tone: "neutral", motion: "none", icon: "idle" },
  queued: { phase: "idle", label: "Queued", tone: "neutral", motion: "none", icon: "idle" },
  connected: { phase: "idle", label: "Connected", tone: "neutral", motion: "none", icon: "idle" },
  starting: { phase: "starting", label: "Starting", tone: "active", motion: "pulse", icon: "starting" },
  submitting: { phase: "starting", label: "Submitting", tone: "active", motion: "pulse", icon: "starting" },
  canceling: { phase: "starting", label: "Stopping", tone: "active", motion: "pulse", icon: "starting" },
  retrying: { phase: "starting", label: "Retrying", tone: "active", motion: "pulse", icon: "starting" },
  running: { phase: "working", label: "Working", tone: "active", motion: "pulse", icon: "working" },
  in_progress: { phase: "working", label: "Working", tone: "active", motion: "pulse", icon: "working" },
  working: { phase: "working", label: "Working", tone: "active", motion: "pulse", icon: "working" },
  delivering: { phase: "working", label: "Delivering", tone: "active", motion: "pulse", icon: "working" },
  needs_input: { phase: "waiting", label: "Needs input", tone: "attention", motion: "none", icon: "waiting" },
  review: { phase: "waiting", label: "Review needed", tone: "attention", motion: "none", icon: "waiting" },
  blocked: { phase: "waiting", label: "Blocked", tone: "attention", motion: "none", icon: "waiting" },
  attention: { phase: "waiting", label: "Needs attention", tone: "attention", motion: "none", icon: "waiting" },
  stale: { phase: "waiting", label: "Stale", tone: "attention", motion: "none", icon: "waiting" },
  changes_requested: { phase: "waiting", label: "Changes requested", tone: "attention", motion: "none", icon: "waiting" },
  verifying: { phase: "verifying", label: "Verifying", tone: "active", motion: "pulse", icon: "verifying" },
  completed: { phase: "success", label: "Completed", tone: "success", motion: "none", icon: "success" },
  complete: { phase: "success", label: "Complete", tone: "success", motion: "none", icon: "success" },
  done: { phase: "success", label: "Done", tone: "success", motion: "none", icon: "success" },
  passed: { phase: "success", label: "Passed", tone: "success", motion: "none", icon: "success" },
  verified: { phase: "success", label: "Verified", tone: "success", motion: "none", icon: "success" },
  approved: { phase: "success", label: "Approved", tone: "success", motion: "none", icon: "success" },
  allowed: { phase: "success", label: "Allowed", tone: "success", motion: "none", icon: "success" },
  answered: { phase: "success", label: "Answered", tone: "success", motion: "none", icon: "success" },
  success: { phase: "success", label: "Succeeded", tone: "success", motion: "none", icon: "success" },
  succeeded: { phase: "success", label: "Succeeded", tone: "success", motion: "none", icon: "success" },
  canceled: { phase: "stopped", label: "Canceled", tone: "neutral", motion: "none", icon: "stopped" },
  cancelled: { phase: "stopped", label: "Canceled", tone: "neutral", motion: "none", icon: "stopped" },
  paused: { phase: "stopped", label: "Paused", tone: "neutral", motion: "none", icon: "stopped" },
  denied: { phase: "stopped", label: "Denied", tone: "neutral", motion: "none", icon: "stopped" },
  failed: { phase: "error", label: "Failed", tone: "destructive", motion: "none", icon: "error" },
  failure: { phase: "error", label: "Failed", tone: "destructive", motion: "none", icon: "error" },
  interrupted: { phase: "error", label: "Interrupted", tone: "destructive", motion: "none", icon: "error" },
  disconnected: { phase: "offline", label: "Disconnected", tone: "muted", motion: "none", icon: "offline" },
  unavailable: { phase: "offline", label: "Unavailable", tone: "muted", motion: "none", icon: "offline" },
  recorded: { phase: "offline", label: "Recorded", tone: "muted", motion: "none", icon: "offline" },
};

function normalizeStatus(status: string | undefined): string {
  return status?.trim().toLowerCase().replace(/[\s-]+/g, "_") || "ready";
}

export function titleCaseStatus(status: string | undefined): string {
  const normalized = normalizeStatus(status);
  return normalized.split("_").map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : "").join(" ");
}

export function resolveRunState(status: string | undefined, label?: string): RunStatePresentation {
  const normalized = normalizeStatus(status);
  const state = states[normalized] ?? {
    phase: "idle" as const,
    label: titleCaseStatus(status),
    tone: "neutral" as const,
    motion: "none" as const,
    icon: "idle" as const,
  };
  const resolvedLabel = label?.trim() || state.label;
  return { ...state, label: resolvedLabel, ariaLabel: resolvedLabel };
}

export function isRoutineWorkingState(status: string | undefined, label?: string): boolean {
  const state = resolveRunState(status, label);
  return state.phase === "working" && state.label === "Working";
}

export function visibleRunStateDetail(status: string | undefined, detail: string | undefined): string | undefined {
  const normalizedDetail = detail?.trim().toLowerCase().replaceAll("…", "...");
  return isRoutineWorkingState(status) && normalizedDetail === "agent is working..." ? undefined : detail;
}

export type RunGraphTone = "neutral" | "success" | "warning" | "destructive";

export function runGraphTone(status: string | undefined): RunGraphTone {
  const tone = resolveRunState(status).tone;
  if (tone === "success") return "success";
  if (tone === "attention") return "warning";
  if (tone === "destructive") return "destructive";
  return "neutral";
}
