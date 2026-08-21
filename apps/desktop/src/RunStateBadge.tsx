import type { ComponentType, HTMLAttributes } from "react";
import { Activity, Bell, CheckIcon, Checklist, CircleDot, Square, X } from "./SargamIcon";
import { isRoutineWorkingState, resolveRunState, type RunStateIcon } from "./runState";

const icons: Record<RunStateIcon, ComponentType<HTMLAttributes<HTMLSpanElement>>> = {
  idle: CircleDot,
  starting: Activity,
  working: Activity,
  waiting: Bell,
  verifying: Checklist,
  success: CheckIcon,
  stopped: Square,
  error: X,
  offline: CircleDot,
};

export function RunStateBadge({
  status,
  label,
  variant = "default",
  className = "",
}: {
  status?: string;
  label?: string;
  variant?: "default" | "compact" | "indicator";
  className?: string;
}) {
  if (isRoutineWorkingState(status, label)) return null;
  const state = resolveRunState(status, label);
  const Icon = icons[state.icon];
  return <span
    className={`wj-run-state ${className}`.trim()}
    data-phase={state.phase}
    data-tone={state.tone}
    data-motion={state.motion}
    data-variant={variant}
    aria-label={state.ariaLabel}
  >
    <Icon />
    <span className={variant === "indicator" ? "sr-only" : undefined}>{state.label}</span>
  </span>;
}
