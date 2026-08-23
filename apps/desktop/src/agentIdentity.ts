export const AGENT_CALLSIGNS = [
  "Atlas",
  "Beacon",
  "Cipher",
  "Delta",
  "Echo",
  "Forge",
  "Ion",
  "Kepler",
  "Nova",
  "Orbit",
  "Pulse",
  "Relay",
  "Slate",
  "Vector",
  "Vega",
  "Rook",
] as const;

export function resolveAgentLabel(
  liveTitle?: string,
  recordedTitle?: string,
): string {
  return liveTitle?.trim() || recordedTitle?.trim() || "Former agent";
}

interface AgentIdentityNode {
  kind: string;
  title: string;
  data: Record<string, unknown>;
}

interface AgentIdentityCanvas {
  nodes: AgentIdentityNode[];
}

function identityKey(value: string): string {
  return value.trim().toLowerCase();
}

export function nextAgentCallsign(titles: Iterable<string>): string {
  const used = new Set([...titles].map(identityKey));
  for (let cycle = 0; ; cycle++) {
    for (const root of AGENT_CALLSIGNS) {
      const candidate = cycle === 0 ? root : `${root}-${cycle + 1}`;
      if (!used.has(identityKey(candidate))) return candidate;
    }
  }
}

export function reserveAgentCallsign(
  canvases: AgentIdentityCanvas[],
  reservations: Set<string>,
): string {
  const persistedTitles = canvases.flatMap((canvas) => canvas.nodes.flatMap((node) =>
    node.kind === "agent_terminal"
      && typeof node.data.adapterId === "string"
      && node.data.adapterId !== "generic-shell"
      ? [node.title]
      : [],
  ));
  const callsign = nextAgentCallsign([...persistedTitles, ...reservations]);
  reservations.add(callsign);
  return callsign;
}
