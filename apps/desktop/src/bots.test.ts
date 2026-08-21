import {
  botSnapshot,
  botSnapshotFromNode,
  botStandingPrompt,
  specialistSnapshot,
  specialistSuggestion,
} from "./bots";
import type { AgentProfile, BotProfile } from "./types";

const profile: BotProfile = {
  id: "bot_verifier",
  scope: "project",
  projectId: "project_one",
  name: "Verifier",
  roleDescription: "Verify observable behavior and report exact evidence.",
  avatarSeed: "avatar_verifier",
  launch: { adapterId: "claude-code", model: "sonnet", thinking: "high" },
  launchCount: 2,
  createdAt: "2026-08-21T00:00:00Z",
  updatedAt: "2026-08-21T00:00:00Z",
};

const agentProfile: AgentProfile = {
  adapterId: "claude-code",
  provider: "anthropic",
  model: "sonnet",
  thinking: "high",
  approvalPolicy: "default",
};

test("saved bot snapshots remain complete and detached from profile edits", () => {
  const editable = { ...profile, launch: { ...profile.launch } };
  const snapshot = botSnapshot(editable);
  editable.launch.model = "opus";
  editable.roleDescription = "Changed later";

  expect(snapshot.launch.model).toBe("sonnet");
  expect(snapshot.roleDescription).toContain("observable behavior");
  expect(botSnapshotFromNode({ botSnapshot: snapshot })).toEqual(snapshot);
});

test("one-off avatar seeds are stable for the same task and suggestion", () => {
  const suggestion = {
    name: "Accessibility reviewer",
    roleDescription: "Audit focus order, labels, and reduced motion.",
    rationale: "The change adds a modal workflow.",
  };
  const first = specialistSnapshot(suggestion, agentProfile, "task:reviewer");
  const second = specialistSnapshot(suggestion, agentProfile, "task:reviewer");
  expect(first.avatarSeed).toBe(second.avatarSeed);
  expect(first.source).toBe("one-off");
});

test("standing roles are separated from the user-authored task", () => {
  const prompt = botStandingPrompt("Check the dialog.", botSnapshot(profile));
  expect(prompt).toContain("Standing specialist role: Verifier");
  expect(prompt).toContain("Current task:\nCheck the dialog.");
  expect(prompt).toContain("do not assume any additional authority");
});

test("specialist suggestion parsing enforces the proposal limits", () => {
  expect(specialistSuggestion({
    name: "Verifier",
    roleDescription: "Verify the task.",
    rationale: "Distinct verification is useful.",
    adapterId: "claude-code",
  })).toEqual({
    name: "Verifier",
    roleDescription: "Verify the task.",
    rationale: "Distinct verification is useful.",
    adapterId: "claude-code",
  });
  expect(specialistSuggestion({
    name: "Verifier",
    roleDescription: "Verify the task.",
    rationale: "x".repeat(241),
  })).toBeUndefined();
});
