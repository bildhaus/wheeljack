import type { CanvasNode, OpsCard, OpsTaskEventKind } from "./types";

export type OpsTimelineKind = OpsTaskEventKind | "lifecycle" | "verification" | "workspace";

export interface OpsTimelineItem {
  id: string;
  kind: OpsTimelineKind;
  timestamp: string;
  message: string;
  actor?: string;
  source: "task" | "agent" | "verification" | "workspace";
}

export function opsTaskTimeline(card: OpsCard, nodes: CanvasNode[]): OpsTimelineItem[] {
  const items: OpsTimelineItem[] = (card.events ?? []).map((event) => ({
    id: `event:${event.id}`,
    kind: event.kind,
    timestamp: event.timestamp,
    message: event.message,
    actor: event.callsign,
    source: "agent",
  }));
  if (card.startedAt) items.push({
    id: `task:started:${card.startedAt}`,
    kind: "lifecycle",
    timestamp: card.startedAt,
    message: "Task started",
    source: "task",
  });
  if (card.pausedAt) items.push({
    id: `task:paused:${card.pausedAt}`,
    kind: "pause",
    timestamp: card.pausedAt,
    message: "Task paused",
    source: "task",
  });
  if (card.completedAt) items.push({
    id: `task:completed:${card.completedAt}`,
    kind: "completion",
    timestamp: card.completedAt,
    message: "Task completed",
    source: "task",
  });
  if (card.taskLane?.closedAt) items.push({
    id: `workspace:closed:${card.taskLane.closedAt}`,
    kind: "workspace",
    timestamp: card.taskLane.closedAt,
    message: "Task worktree removed",
    source: "workspace",
  });
  const verification = card.verificationRun;
  if (verification) {
    items.push({
      id: `verification:started:${verification.sessionId}`,
      kind: "verification",
      timestamp: verification.startedAt,
      message: `Verification started: ${verification.command}`,
      source: "verification",
    });
    if (verification.endedAt) items.push({
      id: `verification:ended:${verification.sessionId}`,
      kind: verification.status === "passed" ? "completion" : "verification",
      timestamp: verification.endedAt,
      message: verification.message || `Verification ${verification.status}`,
      source: "verification",
    });
  }
  for (const node of nodes) {
    if (node.data.taskId !== card.id || node.kind !== "agent_terminal") continue;
    items.push({
      id: `agent:created:${node.id}`,
      kind: "assignment",
      timestamp: node.createdAt,
      message: `${node.data.taskRole === "reviewer" ? "Reviewer" : "Task agent"} opened`,
      actor: node.title,
      source: "agent",
    });
  }
  return items
    .filter((item) => !Number.isNaN(Date.parse(item.timestamp)))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || right.id.localeCompare(left.id));
}
