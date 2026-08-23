import { render, screen } from "@testing-library/react";
import { ReviewDrawerSurface } from "./ParitySurfaces";
import type { OpsCard } from "./types";

test("keeps a long requested-changes verdict inside the review footer", () => {
  const feedback = `REVIEW VERDICT: REQUEST CHANGES\n${"Add concrete verification evidence before approval. ".repeat(80)}`;
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
    reviewerId: "reviewer",
    events: [{ id: "review-verdict", kind: "handoff", timestamp: "2026-08-23T10:00:00Z", message: feedback }],
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

  const editor = screen.getByRole("textbox", { name: "Review feedback" }) as HTMLTextAreaElement;
  const footer = document.querySelector(".wj-review-recommendation");
  expect(editor.value).toBe(feedback);
  expect(editor.classList.contains("max-h-40")).toBe(true);
  expect(editor.classList.contains("overflow-y-auto")).toBe(true);
  expect(footer?.classList.contains("max-h-[min(440px,58vh)]")).toBe(true);
  expect(footer?.classList.contains("overflow-y-auto")).toBe(true);
  expect(screen.queryByText(feedback)).toBeNull();
  expect(screen.getByRole("button", { name: "Start fresh worker" })).toBeTruthy();
});
