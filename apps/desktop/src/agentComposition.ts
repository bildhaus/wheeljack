import type { AgentImageAttachment, JsonObject } from "./types";

const MAX_DRAFT_LENGTH = 20_000;
const MAX_SCROLL_TOP = 10_000_000;

export interface AgentCompositionState {
  version: 1;
  draft: string;
  attachments: AgentImageAttachment[];
  scrollTop: number;
  followLatest: boolean;
}

export const emptyAgentComposition = (): AgentCompositionState => ({
  version: 1,
  draft: "",
  attachments: [],
  scrollTop: 0,
  followLatest: true,
});

export function agentCompositionFromNode(data: JsonObject): AgentCompositionState {
  const value = data.chatComposition;
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyAgentComposition();
  const record = value as Record<string, unknown>;
  const attachments = Array.isArray(record.attachments)
    ? record.attachments.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
        const attachment = candidate as Record<string, unknown>;
        if (
          typeof attachment.path !== "string" || !attachment.path.trim()
          || typeof attachment.fileName !== "string" || !attachment.fileName.trim()
          || typeof attachment.mimeType !== "string" || !attachment.mimeType.startsWith("image/")
        ) return [];
        return [{
          path: attachment.path.slice(0, 4_096),
          fileName: attachment.fileName.slice(0, 512),
          mimeType: attachment.mimeType.slice(0, 128),
        }];
      }).slice(0, 4)
    : [];
  const scrollTop = typeof record.scrollTop === "number" && Number.isFinite(record.scrollTop)
    ? Math.min(MAX_SCROLL_TOP, Math.max(0, record.scrollTop))
    : 0;
  return {
    version: 1,
    draft: typeof record.draft === "string" ? record.draft.slice(0, MAX_DRAFT_LENGTH) : "",
    attachments,
    scrollTop,
    followLatest: record.followLatest !== false,
  };
}

export function nodeDataWithAgentComposition(
  data: JsonObject,
  composition: AgentCompositionState,
): JsonObject {
  const normalized = agentCompositionFromNode({ chatComposition: composition });
  return {
    ...data,
    chatComposition: normalized as unknown as JsonObject,
  };
}
