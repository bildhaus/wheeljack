import { fireEvent, render, screen } from "@testing-library/react";
import type { UpdateController } from "./updater";
import {
  formatUpdateBytes,
  UpdateProgressView,
  UpdateReleaseNotesSheet,
  updateAttentionLabel,
  updateStatusLabel,
} from "./UpdaterPresentation";

function updaterState(patch: Partial<UpdateController> = {}): UpdateController {
  return {
    status: "idle",
    automaticCheck: true,
    automaticDownload: true,
    checkNow: async () => undefined,
    downloadNow: async () => undefined,
    installNow: async () => false,
    onProgress: () => undefined,
    setAutomaticCheck: () => undefined,
    setAutomaticDownload: () => undefined,
    dismissError: () => undefined,
    acknowledgeInstalledUpdate: () => undefined,
    dismissInstalledRelease: () => undefined,
    ...patch,
  };
}

test("presents updater attention and human-readable status", () => {
  expect(updateAttentionLabel(updaterState({ status: "available" }))).toBe("Update");
  expect(updateAttentionLabel(updaterState({ status: "ready" }))).toBe("Restart");
  expect(updateAttentionLabel(updaterState({ status: "available", recoveryError: "rolled back" }))).toBe("Error");
  expect(updateStatusLabel(updaterState({ status: "checking" }))).toBe("Checking…");
  expect(updateStatusLabel(updaterState({ status: "ready" }))).toBe("Ready to install");
});

test("shows determinate byte progress and indeterminate verification accessibly", () => {
  const { rerender } = render(<UpdateProgressView updater={updaterState({
    status: "downloading",
    progress: { phase: "downloading", downloadedBytes: 5 * 1024 * 1024, totalBytes: 20 * 1024 * 1024 },
  })} />);
  expect(formatUpdateBytes(5 * 1024 * 1024)).toBe("5 MB");
  expect(screen.getByRole("progressbar").getAttribute("value")).toBe("25");
  expect(screen.getByText(/25% · 5 MB of 20 MB/)).toBeTruthy();

  rerender(<UpdateProgressView updater={updaterState({
    status: "downloading",
    progress: { phase: "verifying", downloadedBytes: 20 * 1024 * 1024, totalBytes: 20 * 1024 * 1024 },
  })} />);
  expect(screen.getByRole("progressbar").hasAttribute("aria-valuenow")).toBe(false);
  expect(screen.getByText(/Verifying update/)).toBeTruthy();
  expect(screen.getByRole("progressbar").getAttribute("value")).toBeNull();
});

test("shows persisted release notes in an accessible once-dismissible sheet", () => {
  const onDismiss = vi.fn();
  render(<UpdateReleaseNotesSheet
    open
    release={{ version: "0.1.1", notes: "## Faster updates\n\nVerified before restart." }}
    onDismiss={onDismiss}
  />);
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "What’s new in wheeljack 0.1.1" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Faster updates" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Got it" }));
  expect(onDismiss).toHaveBeenCalledOnce();
});
