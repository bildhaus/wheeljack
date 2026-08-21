import { pendingAgentInteraction } from "./attention";
import type { AgentMessage, AgentParseResult, AgentRuntimeCapabilities } from "./types";

export function isSuccessfulOnboardingTurn(parsed: AgentParseResult, status: string): boolean {
  return status === "completed" &&
    parsed.events.some((event) => event.type === "turn_done") &&
    parsed.messages.some((item) =>
      item.role === "assistant" && item.kind === "message" && item.text.trim().length > 0);
}

export function agentParseStatus(
  parsed: AgentParseResult,
  messages: AgentMessage[] = parsed.messages,
  currentStatus?: string,
  turnStartLine?: number,
): string {
  const events = turnStartLine === undefined
    ? parsed.events
    : parsed.events.filter((event) => event.sequence === undefined || event.sequence >= turnStartLine);
  const state = [...events].reverse().find((event) =>
    ["turn_canceled", "error"].includes(event.type));
  if (state?.type === "turn_canceled" || (currentStatus === "canceling" && !parsed.active)) return "canceled";
  if (state?.type === "error") return "failed";
  if (currentStatus === "canceled" && !parsed.active) return "canceled";
  if (currentStatus === "canceling") return "canceling";
  if (parsed.active && pendingAgentInteraction(messages)) return "needs_input";
  if (parsed.active) return "running";
  const completed = events.some((event) => ["turn_done", "session_done"].includes(event.type))
    && (messages.some((message) => message.role === "assistant" || ["tool", "reasoning", "plan", "commentary"].includes(message.kind)) || events.some((event) => [
      "turn_started", "assistant_message", "assistant_delta", "reasoning_delta", "commentary",
      "tool_start", "tool_delta", "tool_end", "plan_update", "approval_request", "question_request",
    ].includes(event.type)));
  return completed ? "completed" : currentStatus ?? "completed";
}

export function isLiveSessionStatus(status: string): boolean {
  return ["starting", "ready", "running", "needs_input"].includes(status);
}

export function isTerminalSessionStatus(status: string): boolean {
  return ["completed", "failed", "disconnected", "canceled"].includes(status);
}

export function shouldAutoCloseTaskAgent(
  autoClose: boolean,
  runtimeStatus?: string,
  taskColumnRole?: string,
): boolean {
  return autoClose && (runtimeStatus === "completed" || taskColumnRole === "done");
}

export function appendPendingAgentUserMessage(
  messages: AgentMessage[],
  next: AgentMessage,
): AgentMessage[] {
  const sameImages = (left: AgentMessage, right: AgentMessage) => {
    const leftPaths = left.images?.map((image) => image.path) ?? [];
    const rightPaths = right.images?.map((image) => image.path) ?? [];
    return leftPaths.length === rightPaths.length
      && leftPaths.every((path, index) => path === rightPaths[index]);
  };
  let lastAssistantIndex = -1;
  let matchingUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (lastAssistantIndex < 0
      && message.role === "assistant"
      && message.kind === "message"
      && message.text.trim()) lastAssistantIndex = index;
    if (matchingUserIndex < 0
      && message.role === "user"
      && message.text === next.text
      && sameImages(message, next)) matchingUserIndex = index;
    if (lastAssistantIndex >= 0 && matchingUserIndex >= 0) break;
  }
  return matchingUserIndex > lastAssistantIndex ? messages : [...messages, next];
}

export function agentExitStatus(
  currentStatus: string | undefined,
  exitCode: number | undefined,
  incompleteTurn: boolean,
  terminationReason?: string,
): string {
  if (terminationReason === "completed") return "completed";
  if (terminationReason === "canceled") return "canceled";
  if (terminationReason === "shutdown") return "disconnected";
  return currentStatus === "failed" || exitCode !== 0 || incompleteTurn ? "failed" : "completed";
}

export function agentFailureNeedsRepair(summary?: string): boolean {
  const normalized = summary?.toLowerCase() ?? "";
  return ["authentication", "unauthenticated", "unauthorized", "sign in", "login", "credential"]
    .some((value) => normalized.includes(value));
}

export function hydratedRuntimeStatus(
  structured: boolean,
  hasMessages: boolean,
  sessionStatus?: string,
  turnStatus?: string,
): string {
  if (!structured) return sessionStatus ?? turnStatus ?? "recovered";
  if (sessionStatus && !isLiveSessionStatus(sessionStatus)) return sessionStatus;
  if (!hasMessages && (!turnStatus || turnStatus === "running" || turnStatus === "completed")) return "ready";
  return turnStatus ?? (hasMessages ? "completed" : "ready");
}

export function supportsAgentTurnCancel(protocol?: string): boolean {
  return ["codex-app-server", "claude-stream-json", "opencode-sse", "pi-rpc"].includes(protocol ?? "");
}

export function supportsAgentImageInput(protocol?: string): boolean {
  return ["codex-app-server", "claude-stream-json", "opencode-sse", "pi-rpc", "hermes-acp"].includes(protocol ?? "");
}

export function agentRuntimeCapabilities(value: unknown): AgentRuntimeCapabilities | undefined {
  if (!value || typeof value !== "object") return undefined;
  const capabilities = value as Record<string, unknown>;
  if (!["cancel", "interact", "resume", "attachedTerminal"].every((key) => typeof capabilities[key] === "boolean")) {
    return undefined;
  }
  if (capabilities.imageInput !== undefined && typeof capabilities.imageInput !== "boolean") return undefined;
  return capabilities as unknown as AgentRuntimeCapabilities;
}

export function mergeAgentMessages(existing: AgentMessage[], incoming: AgentMessage[]): AgentMessage[] {
  const merged = [...existing];
  for (const message of incoming) {
    const index = merged.findIndex((candidate) => candidate.id === message.id);
    if (index >= 0) {
      merged[index] = {
        ...message,
        interactionState: message.interactionState ?? merged[index].interactionState,
      };
    } else {
      merged.push(message);
    }
  }
  return merged;
}

export function reconcileParsedAgentMessages(
  existing: AgentMessage[],
  parsed: AgentMessage[],
  nodeId: string,
): AgentMessage[] {
  const parsedIds = new Set(parsed.map((message) => message.id));
  return mergeAgentMessages(
    existing.filter((message) => !message.id.startsWith(`${nodeId}-agent-`) || parsedIds.has(message.id)),
    parsed,
  );
}

export function setAgentInteractionState(
  messages: AgentMessage[],
  id: string,
  interactionState: NonNullable<AgentMessage["interactionState"]>,
): AgentMessage[] {
  return messages.map((message) => message.id === id ? { ...message, interactionState } : message);
}

export function agentStatusAfterInteraction(currentStatus: string, messages: AgentMessage[]): string {
  if (["failed", "completed", "canceled"].includes(currentStatus)) return currentStatus;
  return pendingAgentInteraction(messages) ? "needs_input" : "running";
}
