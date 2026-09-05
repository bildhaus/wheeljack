import type { OpsCard, OpsState } from "./types";
import { columnIdForRole } from "./opsOrchestration";

export function addDocumentStarterTasks(current: OpsState, kind: "prd" | "tdd"): OpsState {
  const starters = kind === "prd"
    ? [["Validate primary workflow", "Exercise the end-to-end user journey against acceptance criteria."], ["Review edge states", "Verify empty, loading, denied, failed, and recovery behavior."]]
    : [["Implement architecture slice", "Build the smallest cross-boundary implementation described by the TDD."], ["Run acceptance validation", "Verify runtime behavior, data safety, and packaged execution."]];
  const titles = new Set(current.cards.map((card) => card.title.trim().toLowerCase()));
  const additions: OpsCard[] = starters.filter(([title]) => !titles.has(title.toLowerCase())).map(([title, detail]) => ({
    id: crypto.randomUUID().replaceAll("-", ""),
    columnId: columnIdForRole(current, "queued"), title, detail,
    assignee: "Unassigned", priority: "normal", assigneeIds: [], agentStatuses: {},
    expectedFiles: [], lastNote: `Starter from ${kind.toUpperCase()}. Define the task contract before running.`, reviewPolicy: "agent",
  }));
  return additions.length ? { ...current, cards: [...current.cards, ...additions] } : current;
}
