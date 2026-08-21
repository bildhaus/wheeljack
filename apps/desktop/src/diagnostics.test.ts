import { describe, expect, test } from "vitest";

import { createDiagnosticsReport } from "./diagnostics";
import type { Adapter, PaneRuntime } from "./types";

describe("diagnostics report", () => {
  test("allowlists operational data without credentials or transcript content", () => {
    const adapter = {
      id: "codex",
      displayName: "Codex",
      status: "ready",
      setupHint: "",
      enabled: true,
      supportsStructured: true,
      supportedApprovalPolicies: ["on-request"],
      secretToken: "do-not-copy",
      probe: {
        adapterId: "codex",
        authStatus: "signed-in",
        verificationStatus: "verified",
        verifiedArgs: [],
        message: "CLI failed with token do-not-copy-from-message",
        checkedAt: "2026-07-29T00:00:00Z",
      },
    } as Adapter;
    const runtime = {
      nodeId: "node",
      sessionId: "session",
      historySessionId: "history",
      adapterId: "codex",
      structured: true,
      status: "running",
      transcript: "private transcript",
      structuredLines: ["private prompt"],
      messages: [{ id: "message", role: "user", kind: "text", text: "private response" }],
    } satisfies PaneRuntime;

    const report = createDiagnosticsReport({
      version: "0.1.0",
      platform: "windows",
      appDataDir: "C:\\wheeljack",
      adapters: [adapter],
      runtimes: [runtime],
    });

    expect(JSON.parse(report)).toMatchObject({
      version: "0.1.0",
      adapters: [{ id: "codex", probe: { authStatus: "signed-in" } }],
      sessions: { total: 1, byStatus: { running: 1 } },
    });
    expect(report).not.toContain("do-not-copy");
    expect(report).not.toContain("do-not-copy-from-message");
    expect(report).not.toContain("private transcript");
    expect(report).not.toContain("private prompt");
    expect(report).not.toContain("private response");
  });
});
