import { AGENT_CALLSIGNS, nextAgentCallsign, reserveAgentCallsign, resolveAgentLabel } from "./agentIdentity";

const agent = (title: string, adapterId: string, status = "running") => ({
  kind: "agent_terminal",
  title,
  data: { adapterId, status },
});

test("allocates callsigns across providers and canvases case-insensitively", () => {
  const reservations = new Set<string>();
  const canvases = [
    { nodes: [agent("atlas", "codex-cli")] },
    { nodes: [agent("Beacon", "claude-code")] },
  ];

  expect(reserveAgentCallsign(canvases, reservations)).toBe("Cipher");
});

test("reserves distinct callsigns for concurrent launches", () => {
  const reservations = new Set<string>();

  expect(reserveAgentCallsign([], reservations)).toBe("Atlas");
  expect(reserveAgentCallsign([], reservations)).toBe("Beacon");
});

test("retained panes keep callsigns while removed panes release them", () => {
  expect(reserveAgentCallsign([
    { nodes: [agent("Atlas", "codex-cli", "completed")] },
  ], new Set())).toBe("Beacon");
  expect(reserveAgentCallsign([{ nodes: [] }], new Set())).toBe("Atlas");
});

test("preserves legacy titles and ignores generic shell panes", () => {
  const legacy = agent("Codex 1", "codex-cli");
  const genericShell = agent("Atlas", "generic-shell");

  expect(reserveAgentCallsign([{ nodes: [legacy, genericShell] }], new Set())).toBe("Atlas");
  expect(legacy.title).toBe("Codex 1");
});

test("uses routable hyphenated suffixes after exhausting the pool", () => {
  expect(nextAgentCallsign(AGENT_CALLSIGNS)).toBe("Atlas-2");
  expect(nextAgentCallsign([...AGENT_CALLSIGNS, "Atlas-2"])).toBe("Beacon-2");
});

test("resolves live and recorded labels without exposing internal ids", () => {
  expect(resolveAgentLabel(" Atlas ", "Old Atlas")).toBe("Atlas");
  expect(resolveAgentLabel(undefined, " Beacon ")).toBe("Beacon");
  expect(resolveAgentLabel()).toBe("Former agent");
});
