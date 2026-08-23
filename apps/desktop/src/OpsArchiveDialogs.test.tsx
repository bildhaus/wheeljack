import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import OpsArchiveDialogs from "./OpsArchiveDialogs";
import type { OpsCard, OpsState } from "./types";

function completedCard(patch: Partial<OpsCard> = {}): OpsCard {
  return {
    id: "completed",
    columnId: "done",
    title: "Completed task",
    detail: "",
    assignee: "Unassigned",
    priority: "normal",
    assigneeIds: [],
    agentStatuses: {},
    expectedFiles: [],
    lastNote: "",
    ...patch,
  };
}

function state(card: OpsCard): OpsState {
  return {
    version: 2,
    columns: [
      { id: "queued", title: "Ready", role: "queued" },
      { id: "done", title: "Done", role: "done" },
    ],
    cards: [card],
    prd: "",
    tdd: "",
    eventCursors: {},
  };
}

test("confirms archiving eligible completed cards", async () => {
  const onArchiveDone = vi.fn().mockResolvedValue(undefined);
  render(<OpsArchiveDialogs archiveDoneOpen archiveOpen={false} writable state={state(completedCard())} runtimes={[]} onArchiveDoneOpen={() => {}} onArchiveOpen={() => {}} onArchiveDone={onArchiveDone} onRestoreArchived={vi.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: "Archive 1" }));

  await waitFor(() => expect(onArchiveDone).toHaveBeenCalledWith(["completed"]));
});

test("queues completed cards with open worktrees for automatic cleanup", async () => {
  const onArchiveDone = vi.fn().mockResolvedValue(undefined);
  const card = completedCard({ taskLane: { kind: "git-worktree", worktreePath: "C:\\worktree", cwd: "C:\\worktree", branch: "task/lane", baseCommit: "abc123" } });
  render(<OpsArchiveDialogs archiveDoneOpen archiveOpen={false} writable state={state(card)} runtimes={[]} onArchiveDoneOpen={() => {}} onArchiveOpen={() => {}} onArchiveDone={onArchiveDone} onRestoreArchived={vi.fn()} />);

  expect(screen.getByText(/preserve and resolve local changes first/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Archive 1" }));
  await waitFor(() => expect(onArchiveDone).toHaveBeenCalledWith(["completed"]));
});
