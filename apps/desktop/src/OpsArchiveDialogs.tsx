import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Button } from "./components/ui/button";
import { ScrollArea } from "./components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "./components/ui/sheet";
import { CircleDot, RefreshCw } from "./SargamIcon";
import { DotMatrixLoader } from "./DotMatrixLoader";
import { isTerminalSessionStatus } from "./agentRuntime";
import { opsCardParticipantIds } from "./opsPresence";
import type { OpsState, PaneRuntime } from "./types";

export default function OpsArchiveDialogs({
  archiveDoneOpen,
  archiveOpen,
  writable,
  state,
  runtimes,
  onArchiveDoneOpen,
  onArchiveOpen,
  onArchiveDone,
  onRestoreArchived,
}: {
  archiveDoneOpen: boolean;
  archiveOpen: boolean;
  writable: boolean;
  state: OpsState;
  runtimes: PaneRuntime[];
  onArchiveDoneOpen: (open: boolean) => void;
  onArchiveOpen: (open: boolean) => void;
  onArchiveDone: (cardIds: string[]) => Promise<void>;
  onRestoreArchived: (cardIds: string[]) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const doneIds = new Set(state.columns.filter((column) => column.role === "done").map((column) => column.id));
  const doneCards = state.cards.filter((card) => doneIds.has(card.columnId));
  const laneCards = doneCards.filter((card) => Boolean(card.taskLane && !card.taskLane.closedAt));
  const blockedCards = doneCards.filter((card) => Boolean(
    (!card.taskLane || card.taskLane.closedAt)
    && opsCardParticipantIds(card, runtimes).some((id) => runtimes.some((runtime) =>
      runtime.nodeId === id && !isTerminalSessionStatus(runtime.status))),
  ));
  const blockedIds = new Set(blockedCards.map((card) => card.id));
  const archiveableCards = doneCards.filter((card) => !blockedIds.has(card.id));
  const archivedCards = [...(state.archivedCards ?? [])].sort((left, right) => (right.completedAt ?? "").localeCompare(left.completedAt ?? ""));
  const run = (operation: Promise<void>, completed?: () => void) => {
    setBusy(true);
    setError("");
    void operation.then(completed).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => setBusy(false));
  };

  return <>
    <AlertDialog open={archiveDoneOpen} onOpenChange={(open) => { if (!busy) onArchiveDoneOpen(open); }}>
      <AlertDialogContent className="wj-dialog wj-dialog-medium">
        <AlertDialogHeader>
          <AlertDialogTitle>Archive completed tasks?</AlertDialogTitle>
          <AlertDialogDescription>{archiveableCards.length} completed {archiveableCards.length === 1 ? "task" : "tasks"} will leave the board and KANBAN.md. Task worktrees will be resolved first when needed, and history remains restorable.</AlertDialogDescription>
        </AlertDialogHeader>
        {laneCards.length > 0 && <div className="wj-inspector-warning"><CircleDot />{laneCards.length === 1 ? "1 task has a worktree. Wheeljack will remove it when clean or assign its agent to preserve and resolve local changes first." : `${laneCards.length} tasks have worktrees. Wheeljack will resolve cleanups automatically with bounded agent concurrency.`}</div>}
        {blockedCards.length > 0 && <div className="wj-inspector-warning"><CircleDot />{blockedCards.length === 1 ? "1 task without a worktree is excluded until its active agent finishes." : `${blockedCards.length} tasks without worktrees are excluded until their active agents finish.`}</div>}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={busy || archiveableCards.length === 0} onClick={(event) => {
            event.preventDefault();
            run(onArchiveDone(archiveableCards.map((card) => card.id)), () => onArchiveDoneOpen(false));
          }}>{busy ? <><DotMatrixLoader size={14} />Archiving…</> : `Archive ${archiveableCards.length}`}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <Sheet open={archiveOpen} onOpenChange={onArchiveOpen}>
      <SheetContent className="wj-sheet wj-sheet-medium">
        <SheetHeader><SheetTitle>Archived tasks</SheetTitle><SheetDescription>Completed tasks removed from the live board. Restoring returns them to Done and writes them back to KANBAN.md.</SheetDescription></SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="wj-archive-list">
            {archivedCards.map((card) => <div className="wj-archive-item" key={card.id}>
              <div><strong>{card.title}</strong>{card.completedAt && <small>Completed {new Date(card.completedAt).toLocaleString()}</small>}</div>
              <Button variant="outline" size="sm" disabled={busy || !writable} onClick={() => run(onRestoreArchived([card.id]))}><RefreshCw />Restore</Button>
            </div>)}
            {!archivedCards.length && <p className="wj-inspector-empty">No archived tasks.</p>}
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          </div>
        </ScrollArea>
        {archivedCards.length > 1 && <SheetFooter><Button disabled={busy || !writable} onClick={() => run(onRestoreArchived(archivedCards.map((card) => card.id)))}><RefreshCw />Restore all</Button></SheetFooter>}
      </SheetContent>
    </Sheet>
  </>;
}
