import { render, screen } from "@testing-library/react";
import { ReviewDrawerSurface } from "./ParitySurfaces";
import type { OpsCard } from "./types";

test("shows worker evidence and exposes a repair action only for an intervention", () => {
  const evidence = "Tests passed and the implementation was committed.";
  const reviewCard: OpsCard = {
    id: "review-long-feedback",
    columnId: "review",
    title: "Long review feedback",
    detail: "Keep the review action reachable.",
    assignee: "Reviewer",
    priority: "normal",
    assigneeIds: [],
    agentStatuses: {},
    expectedFiles: [],
    lastNote: "",
    report: { status: "reported", summary: "Implementation complete", evidence, checks: ["bun run test"], risks: [], reportedAt: "2026-08-23T10:00:00Z" },
    reconciliation: { status: "needs_human", attempts: 3, message: "Integration conflict needs intervention.", updatedAt: "2026-08-23T10:01:00Z" },
  };

  render(<ReviewDrawerSurface
    reviewCard={reviewCard}
    reviewEvidenceReady={false}
    reviewEvidenceMessage="Review evidence is incomplete."
    hasFileConflict={false}
    verificationBusy={false}
    onClose={() => undefined}
    onReviewAction={async () => undefined}
    onStartReviewer={async () => true}
    onRunVerification={async () => undefined}
    onCancelVerification={async () => undefined}
    onViewVerificationOutput={async () => undefined}
    onRequestChanges={async () => true}
    onUpdateContract={() => undefined}
  />);

  expect(screen.getByText(evidence)).toBeTruthy();
  expect(screen.getByText("Integration conflict needs intervention.")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Task feedback" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "Send repair task" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Accept and reconcile" })).toBeNull();
});

test("offers a direct reconciliation retry when only the target checkout was dirty", () => {
  const reviewCard: OpsCard = {
    id: "target-dirty",
    columnId: "review",
    title: "Target dirty",
    detail: "Retry after the opened checkout is clean.",
    assignee: "Worker",
    priority: "normal",
    assigneeIds: [],
    agentStatuses: {},
    expectedFiles: [],
    lastNote: "",
    report: { status: "reported", summary: "Complete", evidence: "Committed.", checks: [], risks: [], reportedAt: "2026-08-23T10:00:00Z" },
    reconciliation: {
      status: "needs_human",
      attempts: 1,
      message: "The opened checkout has local changes.",
      reason: "target_dirty",
      updatedAt: "2026-08-23T10:01:00Z",
    },
  };

  render(<ReviewDrawerSurface
    reviewCard={reviewCard}
    reviewEvidenceReady={false}
    reviewEvidenceMessage="Review evidence is incomplete."
    hasFileConflict={false}
    verificationBusy={false}
    onClose={() => undefined}
    onReviewAction={async () => undefined}
    onStartReviewer={async () => true}
    onRunVerification={async () => undefined}
    onCancelVerification={async () => undefined}
    onViewVerificationOutput={async () => undefined}
    onRequestChanges={async () => true}
    onUpdateContract={() => undefined}
  />);

  expect(screen.getByRole("button", { name: "Retry reconciliation" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Send repair task" })).toBeNull();
});
