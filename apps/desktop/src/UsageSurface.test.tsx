import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { UsageSurface } from "./UsageSurface";
import type { UsageDashboard } from "./usage";

const coreMocks = vi.hoisted(() => ({ callCore: vi.fn() }));
vi.mock("./core", () => coreMocks);

const amounts = {
  costNanoUsd: 2_500_000,
  inputTokens: 1_200,
  outputTokens: 340,
  reasoningTokens: 80,
  cacheReadTokens: 400,
  cacheWriteTokens: 20,
  pricedRecords: 1,
  unpricedRecords: 1,
};

function dashboard(pending = true): UsageDashboard {
  return {
    totals: amounts,
    daily: [{ day: "2026-08-20", totals: amounts }],
    providers: [{ key: "openrouter", label: "openrouter", totals: amounts }],
    models: [{ key: "model-a", label: "model-a", totals: amounts }],
    projects: [{ key: "project-1", label: "wheeljack", totals: amounts }],
    sessions: [{
      sessionId: "session-1",
      nodeId: "node-1",
      nodeTitle: "Cost agent",
      adapterId: "opencode",
      providerId: "openrouter",
      modelId: "model-a",
      projectId: "project-1",
      projectName: "wheeljack",
      cwd: "C:\\wheeljack",
      status: "completed",
      startedAt: "2026-08-20T09:00:00Z",
      lastOccurredAt: "2026-08-20T09:05:00Z",
      totals: amounts,
    }],
    coverage: {
      unpricedRecords: 1,
      excludedSubscriptionRecords: 2,
      unknownRecords: pending ? 1 : 0,
      unsupportedSessions: 0,
      supportedSessionsWithoutUsage: 0,
      pendingProfiles: pending ? [{ adapterId: "opencode", providerId: "anthropic", recordCount: 1 }] : [],
    },
    options: {
      adapters: [{ key: "opencode", label: "opencode" }],
      providers: [{ key: "openrouter", label: "openrouter" }],
      models: [{ key: "model-a", label: "model-a" }],
      projects: [{ key: "project-1", label: "wheeljack" }],
    },
  };
}

describe("UsageSurface", () => {
  beforeEach(() => {
    coreMocks.callCore.mockReset();
    coreMocks.callCore.mockImplementation((command: string) => {
      if (command === "usage_dashboard") return Promise.resolve(dashboard());
      return Promise.resolve({});
    });
  });

  test("renders API totals, coverage, and opens a recent session", async () => {
    const onOpenSession = vi.fn();
    render(<UsageSurface refreshKey={0} onOpenSession={onOpenSession} />);

    expect(await screen.findByRole("heading", { name: "API usage" })).toBeTruthy();
    expect(await screen.findByText("Classify anthropic for opencode")).toBeTruthy();
    expect(screen.getAllByText("1 unpriced").length).toBeGreaterThan(0);
    expect(screen.getByText("2 subscription-excluded")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getByText("1.2K in · 340 out")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Open Cost agent session" }));
    expect(onOpenSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-1" }));
  });

  test("persists API classification and confirms isolated usage clearing", async () => {
    let pending = true;
    coreMocks.callCore.mockImplementation((command: string) => {
      if (command === "usage_dashboard") return Promise.resolve(dashboard(pending));
      if (command === "usage_billing_override_set") {
        pending = false;
        return Promise.resolve({});
      }
      if (command === "usage_clear") return Promise.resolve({ deletedRecords: 2 });
      return Promise.resolve({});
    });
    render(<UsageSurface refreshKey={0} onOpenSession={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "API usage" }));
    await waitFor(() => expect(coreMocks.callCore).toHaveBeenCalledWith("usage_billing_override_set", {
      adapterId: "opencode",
      providerId: "anthropic",
      billingKind: "api",
    }));
    await waitFor(() => expect(screen.queryByText("Classify anthropic for opencode")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "Clear data" }));
    await userEvent.click(await screen.findByRole("button", { name: "Clear usage data" }));
    await waitFor(() => expect(coreMocks.callCore).toHaveBeenCalledWith("usage_clear", {}));
  });
});
