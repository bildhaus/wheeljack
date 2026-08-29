import type { Adapter } from "./types";

export function adapterRequiresVerification(adapter?: Adapter): boolean {
  return Boolean(adapter?.supportsStructured && adapter.id !== "generic-shell");
}

export function isAdapterReady(adapter?: Adapter, args?: string[]): boolean {
  if (
    !adapter ||
    !adapter.enabled ||
    !adapter.supportsStructured ||
    !adapter.probe ||
    adapter.status.toLowerCase() !== "installed"
  ) return false;
  if (!adapterRequiresVerification(adapter)) return true;
  return adapter.probe?.authStatus === "authenticated" &&
    adapter.probe.verificationStatus === "verified" &&
    (args === undefined || sameArgs(adapter.probe.verifiedArgs, args));
}

export function canVerifyAdapter(adapter?: Adapter): boolean {
  if (
    !adapter ||
    !adapter.enabled ||
    !adapter.supportsStructured ||
    !adapter.probe ||
    adapter.status.toLowerCase() !== "installed"
  ) return false;
  if (adapter.probe.verificationStatus === "verifying") return false;
  return !adapterRequiresVerification(adapter) ||
    !["missing", "unauthenticated"].includes(adapter.probe.authStatus);
}

export function adapterReadinessLabel(adapter: Adapter, args?: string[]): string {
  if (!adapter.enabled) return "Disabled";
  if (!adapter.status) return "Checking";
  if (adapter.status.toLowerCase() !== "installed") return "Missing";
  if (!adapter.supportsStructured) return "Unsupported";
  if (!adapterRequiresVerification(adapter)) return "Ready";
  if (["missing", "unauthenticated"].includes(adapter.probe?.authStatus ?? "unknown")) return "Sign in";
  if (adapter.probe?.verificationStatus === "verifying") return "Verifying";
  if (adapter.probe?.verificationStatus === "failed") return "Failed";
  if (adapter.probe?.verificationStatus === "stale" || (args !== undefined && !sameArgs(adapter.probe?.verifiedArgs, args))) return "Reverify";
  return adapter.probe?.verificationStatus === "verified" ? "Ready" : "Verify";
}

function sameArgs(left: string[] | undefined, right: string[]): boolean {
  return Boolean(left && left.length === right.length && left.every((value, index) => value === right[index]));
}
