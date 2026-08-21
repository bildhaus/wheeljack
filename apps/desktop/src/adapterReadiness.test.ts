import {
  adapterReadinessLabel,
  canVerifyAdapter,
  isAdapterReady,
  shouldAutoVerifyAdapter,
} from "./adapterReadiness";
import type { Adapter } from "./types";

const installed: Adapter = {
  id: "codex-cli",
  displayName: "Codex",
  status: "installed",
  setupHint: "Install Codex.",
  enabled: true,
  supportsStructured: true,
  supportedApprovalPolicies: ["on-request"],
};

describe("coding-agent readiness", () => {
  test("requires every structured coding adapter to verify", () => {
    expect(isAdapterReady(installed)).toBe(false);
    expect(canVerifyAdapter(installed)).toBe(true);
    expect(adapterReadinessLabel(installed)).toBe("Verify");
  });

  test("requires authentication and verification when the probe exposes repair guidance", () => {
    const signedOut: Adapter = {
      ...installed,
      probe: {
        adapterId: installed.id,
        authStatus: "unauthenticated",
        verificationStatus: "unverified",
        verifiedArgs: [],
        repairCommand: "codex login",
        message: "Sign in to Codex.",
        checkedAt: "now",
      },
    };
    expect(isAdapterReady(signedOut)).toBe(false);
    expect(canVerifyAdapter(signedOut)).toBe(false);
    expect(adapterReadinessLabel(signedOut)).toBe("Sign in");

    const unverified: Adapter = {
      ...signedOut,
      probe: {
        ...signedOut.probe!,
        authStatus: "authenticated",
      },
    };
    expect(isAdapterReady(unverified)).toBe(false);
    expect(canVerifyAdapter(unverified)).toBe(true);
    expect(adapterReadinessLabel(unverified)).toBe("Verify");

    const failed = {
      ...unverified,
      probe: {
        ...unverified.probe!,
        verificationStatus: "failed",
      },
    };
    expect(isAdapterReady(failed)).toBe(false);
    expect(adapterReadinessLabel(failed)).toBe("Failed");
    expect(shouldAutoVerifyAdapter(failed)).toBe(true);

    const verifying = { ...failed, probe: { ...failed.probe, verificationStatus: "verifying" } };
    expect(canVerifyAdapter(verifying)).toBe(false);
    expect(shouldAutoVerifyAdapter(verifying)).toBe(false);
    expect(adapterReadinessLabel(verifying)).toBe("Verifying");

    const verified: Adapter = {
      ...unverified,
      probe: {
        ...unverified.probe!,
        verificationStatus: "verified",
      },
    };
    expect(isAdapterReady(verified)).toBe(true);
    expect(shouldAutoVerifyAdapter(verified)).toBe(false);
    expect(shouldAutoVerifyAdapter(verified, ["--model", "changed"])).toBe(true);
    expect(adapterReadinessLabel(verified)).toBe("Ready");
  });

  test("does not launch missing, disabled, or non-structured adapters", () => {
    expect(isAdapterReady({ ...installed, status: "missing" })).toBe(false);
    expect(adapterReadinessLabel({ ...installed, status: "missing" })).toBe("Missing");
    expect(isAdapterReady({ ...installed, enabled: false })).toBe(false);
    expect(adapterReadinessLabel({ ...installed, enabled: false })).toBe("Disabled");
    expect(isAdapterReady({ ...installed, supportsStructured: false })).toBe(false);
    expect(adapterReadinessLabel({ ...installed, supportsStructured: false })).toBe("Unsupported");
  });

  test("does not let Pi bypass verification when auth has no probe command", () => {
    const pi = {
      ...installed,
      id: "pi-coding-agent",
      probe: {
        adapterId: "pi-coding-agent",
        authStatus: "unknown",
        verificationStatus: "untested",
        verifiedArgs: [],
        message: "Authentication cannot be probed for this adapter.",
        checkedAt: "now",
      },
    };
    expect(isAdapterReady(pi)).toBe(false);
    expect(canVerifyAdapter(pi)).toBe(true);
    expect(adapterReadinessLabel(pi)).toBe("Verify");
  });

  test("invalidates readiness when launch arguments differ from the verified profile", () => {
    const verified = {
      ...installed,
      probe: {
        adapterId: installed.id,
        authStatus: "authenticated",
        verificationStatus: "verified",
        verifiedArgs: ["--model", "one"],
        message: "Verified.",
        checkedAt: "now",
      },
    };

    expect(isAdapterReady(verified, ["--model", "one"])).toBe(true);
    expect(isAdapterReady(verified, ["--model", "two"])).toBe(false);
    expect(adapterReadinessLabel(verified, ["--model", "two"])).toBe("Reverify");
  });
});
