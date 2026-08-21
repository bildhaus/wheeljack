import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { vi } from "vitest";
import { SpecialistProposalDialog, type SpecialistDialogRequest } from "./SpecialistProposalDialog";
import type { Adapter, Project } from "./types";

const project: Project = {
  id: "project_one",
  name: "Wheeljack",
  path: "C:\\wheeljack",
  icon: "folder",
  iconColor: "#777777",
  agentAccess: "default",
  branch: "dev",
  dirty: false,
  githubRemote: true,
  pathExists: true,
};

const adapters: Adapter[] = [{
  id: "claude-code",
  displayName: "Claude Code",
  status: "ready",
  setupHint: "",
  enabled: true,
  supportsStructured: true,
  supportedApprovalPolicies: ["default"],
}];

const proposal: SpecialistDialogRequest = {
  key: "proposal_one",
  intent: "proposal",
  initial: {
    scope: "project",
    projectId: project.id,
    name: "Verifier",
    roleDescription: "Verify observable behavior and report exact evidence.",
    avatarSeed: "avatar_verifier",
    launch: { adapterId: "claude-code", model: "sonnet", thinking: "high" },
  },
  rationale: "Independent verification will improve confidence.",
  targetTask: "Ship Bots",
  allowLaunch: true,
};

function renderDialog(overrides: Partial<ComponentProps<typeof SpecialistProposalDialog>> = {}) {
  const props: ComponentProps<typeof SpecialistProposalDialog> = {
    request: proposal,
    project,
    adapters,
    onDismiss: vi.fn(),
    onReadiness: vi.fn().mockResolvedValue({ label: "Ready", message: "Verified profile." }),
    onVerify: vi.fn().mockResolvedValue({ label: "Ready", message: "Verified profile." }),
    onAction: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<SpecialistProposalDialog {...props} />);
  return props;
}

test("proposal celebrates the specialist and makes launch once the primary action", async () => {
  renderDialog();
  expect(screen.getByRole("heading", { name: "Meet Verifier" })).toBeTruthy();
  expect(screen.getByText("Uses this project’s current agent permissions. Saving this profile grants no additional access.")).toBeTruthy();
  expect(screen.getByRole("radio", { name: /This project/ }).getAttribute("aria-checked")).toBe("true");
  const launch = screen.getByRole("button", { name: "Launch once" }) as HTMLButtonElement;
  await waitFor(() => expect(launch.disabled).toBe(false));
  expect(launch.dataset.variant).toBe("default");
  expect(screen.getByRole("button", { name: "Save & launch" }).dataset.variant).toBe("outline");
});

test("keeps profile editing collapsed until requested", async () => {
  renderDialog();
  const editor = screen.getByText("Edit details").closest("details") as HTMLDetailsElement;
  expect(editor.open).toBe(false);
  await userEvent.click(screen.getByText("Edit details"));
  expect(editor.open).toBe(true);
  expect(screen.getByLabelText("Standing role")).toBeTruthy();
});

test("launch once does not save and dispatches the edited draft", async () => {
  const props = renderDialog();
  const launch = screen.getByRole("button", { name: "Launch once" }) as HTMLButtonElement;
  await waitFor(() => expect(launch.disabled).toBe(false));
  await userEvent.click(launch);
  await waitFor(() => expect(props.onAction).toHaveBeenCalledWith("launch-once", expect.objectContaining({ name: "Verifier", projectId: project.id })));
});

test("save-only mode retains the avatar and has no launch action", async () => {
  const onAction = vi.fn().mockResolvedValue(undefined);
  renderDialog({
    request: { ...proposal, key: "save_one", intent: "save-one-off", allowLaunch: false },
    onAction,
  });
  expect(screen.queryByRole("button", { name: "Launch once" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Save bot" }));
  await waitFor(() => expect(onAction).toHaveBeenCalledWith("save", expect.objectContaining({ avatarSeed: "avatar_verifier" })));
});

test("save or launch failures remain visible without dismissing the proposal", async () => {
  const onAction = vi.fn().mockRejectedValue(new Error("Saved, but launch failed. Retry."));
  renderDialog({ onAction });
  const save = screen.getByRole("button", { name: "Save & launch" }) as HTMLButtonElement;
  await waitFor(() => expect(save.disabled).toBe(false));
  await userEvent.click(save);
  expect((await screen.findByRole("alert")).textContent).toContain("Saved, but launch failed. Retry.");
  expect(screen.getByRole("heading", { name: "Meet Verifier" })).toBeTruthy();
});
