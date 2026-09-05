import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { SplitView } from "./WorkspaceRuntimeSurface";
import { defaultShortcutBindings } from "./shortcuts";
import type { AgentProfile, CanvasNode, PaneRuntime } from "./types";

const core = vi.hoisted(() => ({ callCore: vi.fn(), readImageAttachment: vi.fn(), importImageAttachment: vi.fn(), saveImageAttachment: vi.fn() }));
vi.mock("./core", () => core);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));

test("a bot pane displays its effective model and routes Apply to this pane only", async () => {
  localStorage.clear();
  core.callCore.mockResolvedValue({ models: [{ id: "opus", label: "Opus", provider: "anthropic", efforts: ["high"] }] });
  const user = userEvent.setup();
  const base: AgentProfile = { adapterId: "claude-code", provider: "anthropic", model: "haiku", thinking: "low", approvalPolicy: "default" };
  const node: CanvasNode = {
    id: "bot-pane", canvasId: "canvas", kind: "agent_terminal", title: "Verifier", x: 0, y: 0, width: 500, height: 500, zIndex: 1, createdAt: "", updatedAt: "",
    data: { adapterId: "claude-code", botSnapshot: { name: "Verifier", roleDescription: "Verify changes", avatarSeed: "verifier", launch: { adapterId: "claude-code", model: "sonnet", thinking: "high" } } },
  };
  const runtime: PaneRuntime = { nodeId: node.id, sessionId: "session", historySessionId: "session", adapterId: "claude-code", structured: true, protocol: "claude-stream-json", status: "ready", transcript: "", structuredLines: [], messages: [] };
  const onAgentProfile = vi.fn();
  const noop = vi.fn();
  const accept = vi.fn(async () => true);
  render(<SplitView node={{ type: "leaf", paneId: node.id }} path="" nodes={{ [node.id]: node }} runtimes={{ [node.id]: runtime }} agentContexts={{}} agentProfiles={[base]}
    focusedPaneId={null} chatViews={new Set()} showPaneActions={false} shortcuts={defaultShortcutBindings}
    onFocus={noop} onOpenOpsCard={noop} onClose={noop} onToggleView={noop} onRatio={noop} onWrite={noop} onResize={noop} onViewport={noop} onPaint={noop} onResizePaint={noop}
    onPrompt={accept} onPromptEdit={accept} onPromptRetry={accept} onPromptCancel={accept} onRespond={accept} onCancel={accept} onAgentAccess={vi.fn(async () => undefined)} onAgentProfile={onAgentProfile} />);
  await user.click(screen.getByRole("button", { name: "Model: sonnet, reasoning effort: high" }));
  expect(screen.getByText(/Applies to this agent/)).toBeTruthy();
  await user.click(await screen.findByRole("option", { name: "Opus" }));
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(onAgentProfile).toHaveBeenCalledWith("bot-pane", { model: "opus", provider: "anthropic", thinking: "high" });
  expect(base.model).toBe("haiku");
});
