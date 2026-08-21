import { describe, expect, test } from "vitest";
import { isRoutineWorkingState, resolveRunState, runGraphTone, titleCaseStatus, visibleRunStateDetail } from "./runState";

describe("resolveRunState", () => {
  test.each([
    ["ready", "idle", "neutral", "none", "Ready"],
    ["pending", "idle", "neutral", "none", "Pending"],
    ["queued", "idle", "neutral", "none", "Queued"],
    ["connected", "idle", "neutral", "none", "Connected"],
    ["starting", "starting", "active", "pulse", "Starting"],
    ["canceling", "starting", "active", "pulse", "Stopping"],
    ["running", "working", "active", "pulse", "Working"],
    ["in_progress", "working", "active", "pulse", "Working"],
    ["delivering", "working", "active", "pulse", "Delivering"],
    ["needs_input", "waiting", "attention", "none", "Needs input"],
    ["review", "waiting", "attention", "none", "Review needed"],
    ["blocked", "waiting", "attention", "none", "Blocked"],
    ["attention", "waiting", "attention", "none", "Needs attention"],
    ["stale", "waiting", "attention", "none", "Stale"],
    ["verifying", "verifying", "active", "pulse", "Verifying"],
    ["completed", "success", "success", "none", "Completed"],
    ["done", "success", "success", "none", "Done"],
    ["passed", "success", "success", "none", "Passed"],
    ["verified", "success", "success", "none", "Verified"],
    ["approved", "success", "success", "none", "Approved"],
    ["succeeded", "success", "success", "none", "Succeeded"],
    ["canceled", "stopped", "neutral", "none", "Canceled"],
    ["paused", "stopped", "neutral", "none", "Paused"],
    ["cancelled", "stopped", "neutral", "none", "Canceled"],
    ["denied", "stopped", "neutral", "none", "Denied"],
    ["failed", "error", "destructive", "none", "Failed"],
    ["interrupted", "error", "destructive", "none", "Interrupted"],
    ["disconnected", "offline", "muted", "none", "Disconnected"],
    ["unavailable", "offline", "muted", "none", "Unavailable"],
    ["recorded", "offline", "muted", "none", "Recorded"],
  ] as const)("maps %s", (status, phase, tone, motion, label) => {
    expect(resolveRunState(status)).toMatchObject({ phase, tone, motion, label, ariaLabel: label });
  });

  test("normalizes source spelling and accepts a contextual label", () => {
    expect(resolveRunState("In Progress", "Running checks")).toMatchObject({ phase: "working", label: "Running checks", ariaLabel: "Running checks" });
  });

  test("uses a readable neutral fallback for unknown states", () => {
    expect(resolveRunState("awaiting_operator")).toMatchObject({ phase: "idle", tone: "neutral", label: "Awaiting Operator" });
    expect(titleCaseStatus(undefined)).toBe("Ready");
  });

  test("keeps attention and failure distinct in graph tones", () => {
    expect(runGraphTone("blocked")).toBe("warning");
    expect(runGraphTone("disconnected")).toBe("neutral");
    expect(runGraphTone("failed")).toBe("destructive");
    expect(runGraphTone("passed")).toBe("success");
  });

  test("recognizes and removes only generic working presentation", () => {
    expect(isRoutineWorkingState("running")).toBe(true);
    expect(isRoutineWorkingState("in_progress")).toBe(true);
    expect(isRoutineWorkingState("delivering")).toBe(false);
    expect(visibleRunStateDetail("running", "Agent is working...")).toBeUndefined();
    expect(visibleRunStateDetail("running", "Agent is working…")).toBeUndefined();
    expect(visibleRunStateDetail("running", "Running tests")).toBe("Running tests");
    expect(visibleRunStateDetail("failed", "Agent is working...")).toBe("Agent is working...");
  });
});
