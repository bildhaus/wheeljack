import type { CSSProperties } from "react";

const providerLogos: Record<string, string> = {
  "claude-code": "claude",
  "codex-cli": "codex",
  opencode: "opencode",
  "pi-coding-agent": "pi-coding-agent",
};

export function ProviderMark({ adapterId, className = "" }: { adapterId: string; className?: string }) {
  const logo = providerLogos[adapterId];
  if (!logo) return null;
  return <span className={`wj-provider-mark ${className}`.trim()} style={{ "--wj-provider-logo": `url(/providers/${logo}.svg)` } as CSSProperties} aria-hidden="true" />;
}
