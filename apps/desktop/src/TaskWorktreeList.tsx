import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { GitBranch } from "./SargamIcon";
import { taskWorktreeRows } from "./taskWorktrees";
import type { GitStatus, OpsCard } from "./types";

export default function TaskWorktreeList({
  git,
  cards,
  onOpenTask,
  onResolveTask,
}: {
  git: GitStatus;
  cards: OpsCard[];
  onOpenTask: (card: OpsCard) => void;
  onResolveTask: (card: OpsCard) => void;
}) {
  const worktrees = taskWorktreeRows(git, cards);
  return <section className="wj-drawer-group">
    <div className="wj-drawer-group-heading"><h3>Worktrees</h3><span>{worktrees.length}</span></div>
    <div className="wj-worktree-list">{worktrees.map((row) => {
      const cleanup = row.card?.taskLane?.cleanup;
      const status = !row.registered ? "Missing" : cleanup?.status === "blocked" ? "Blocked" : cleanup ? "Resolving" : row.dirty ? "Dirty" : "Clean";
      return <div className="wj-worktree-row" data-status={status.toLowerCase()} key={`${row.path}:${row.card?.id ?? "git"}`}>
        <div><GitBranch /><span><strong>{row.branch || "Detached"}</strong><small>{row.primary ? "Primary worktree" : row.card?.title ?? "Unlinked worktree"}</small></span><Badge variant="outline">{status}</Badge></div>
        <code title={row.path}>{row.path}</code>
        {cleanup?.message && <p>{cleanup.message}</p>}
        {row.card && <footer><Button size="xs" variant="ghost" onClick={() => onOpenTask(row.card!)}>Open task</Button>{!row.primary && !row.card.taskLane?.closedAt && <Button size="xs" variant="outline" disabled={Boolean(cleanup && ["queued", "resolving"].includes(cleanup.status))} onClick={() => onResolveTask(row.card!)}>{cleanup?.status === "blocked" ? "Retry agent" : cleanup ? "Resolving…" : !row.registered ? "Reconcile" : row.dirty ? "Resolve with agent" : "Remove"}</Button>}</footer>}
      </div>;
    })}</div>
  </section>;
}
