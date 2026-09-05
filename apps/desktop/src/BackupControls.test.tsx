import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { BackupControls } from "./BackupControls";

const { callCore, open } = vi.hoisted(() => ({ callCore: vi.fn(), open: vi.fn() }));
vi.mock("./core", () => ({ callCore }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));

beforeEach(() => { vi.resetAllMocks(); });

test("previews restore scope and stages only after explicit confirmation", async () => {
  open.mockResolvedValue("C:/backups/profile");
  callCore.mockResolvedValue({ fingerprint: "checked", createdAt: "2026-09-05T00:00:00Z", projectCount: 2, sessionCount: 3, attachmentCount: 4, totalBytes: 123 });
  render(<BackupControls />);
  fireEvent.click(screen.getByRole("button", { name: "Restore backup" }));
  expect(await screen.findByText(/2 projects, 3 sessions, and 4 attachments/)).toBeTruthy();
  expect(callCore).not.toHaveBeenCalledWith("state_bundle_restore", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "Restore on next launch" }));
  await waitFor(() => expect(callCore).toHaveBeenCalledWith("state_bundle_restore", { path: "C:/backups/profile", fingerprint: "checked" }));
  expect((await screen.findByRole("status")).textContent).toContain("Quit and reopen");
});

test("cancelling a preview never stages replacement", async () => {
  open.mockResolvedValue("C:/backups/profile");
  callCore.mockResolvedValue({ fingerprint: "checked", createdAt: "2026-09-05T00:00:00Z", projectCount: 2, sessionCount: 3, attachmentCount: 4 });
  render(<BackupControls />);
  fireEvent.click(screen.getByRole("button", { name: "Restore backup" }));
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(callCore).not.toHaveBeenCalledWith("state_bundle_restore", expect.anything());
});
