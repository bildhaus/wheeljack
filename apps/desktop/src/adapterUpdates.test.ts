import { beforeEach, describe, expect, test, vi } from "vitest";

import { callCore } from "./core";
import { previewAndRunAdapterUpdates } from "./adapterUpdates";

vi.mock("./core", () => ({ callCore: vi.fn() }));

const mockedCallCore = vi.mocked(callCore);

describe("adapter updates", () => {
  beforeEach(() => mockedCallCore.mockReset());

  test("previews exact provenance commands before using the one-time token", async () => {
    mockedCallCore
      .mockResolvedValueOnce({
        confirmationToken: "update-token",
        requiresConfirmation: true,
        updates: [{
          adapterId: "codex-cli",
          displayName: "Codex CLI",
          executablePath: "/opt/homebrew/bin/codex",
          manager: "Homebrew",
          packageName: "codex",
          command: "brew upgrade --cask codex --no-ask",
        }],
        skipped: [{ adapterId: "custom", displayName: "Custom", reason: "Unknown owner." }],
      })
      .mockResolvedValueOnce({
        results: [{
          adapterId: "codex-cli",
          displayName: "Codex CLI",
          manager: "Homebrew",
          command: "brew upgrade --cask codex --no-ask",
          success: true,
          message: "Updated.",
        }],
      });
    const confirm = vi.fn().mockResolvedValue(true);

    const outcome = await previewAndRunAdapterUpdates(confirm);

    expect(confirm).toHaveBeenCalledWith(
      "Update 1 coding agent?",
      expect.stringContaining("brew upgrade --cask codex --no-ask"),
      "Update all",
    );
    expect(mockedCallCore).toHaveBeenLastCalledWith("adapter_update_execute", {
      confirmationToken: "update-token",
    });
    expect(outcome.summary).toBe("1 adapter updated.");
  });

  test("does not mutate when every installed adapter has ambiguous provenance", async () => {
    mockedCallCore.mockResolvedValueOnce({
      requiresConfirmation: false,
      updates: [],
      skipped: [{ adapterId: "custom", displayName: "Custom", reason: "Unknown owner." }],
    });
    const confirm = vi.fn();

    const outcome = await previewAndRunAdapterUpdates(confirm);

    expect(confirm).not.toHaveBeenCalled();
    expect(mockedCallCore).toHaveBeenCalledTimes(1);
    expect(outcome.summary).toContain("Custom: Unknown owner.");
  });
});
