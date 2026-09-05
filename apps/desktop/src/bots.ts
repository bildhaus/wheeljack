import type {
  AgentProfile,
  AgentSpecialistSuggestion,
  BotProfile,
  BotProfileInput,
  BotSnapshot,
  JsonObject,
} from "./types";

export function botInput(profile: BotProfile): BotProfileInput {
  return {
    id: profile.id,
    scope: profile.scope,
    projectId: profile.projectId,
    name: profile.name,
    roleDescription: profile.roleDescription,
    avatarSeed: profile.avatarSeed,
    launch: { ...profile.launch },
  };
}

export function botSnapshot(profile: BotProfile): BotSnapshot {
  return {
    profileId: profile.id,
    scope: profile.scope,
    source: "saved",
    name: profile.name,
    roleDescription: profile.roleDescription,
    avatarSeed: profile.avatarSeed,
    launch: { ...profile.launch },
  };
}

export function matchingSavedBot(
  profiles: BotProfile[],
  snapshot: BotSnapshot,
): BotProfile | undefined {
  return profiles.find((profile) => profile.avatarSeed === snapshot.avatarSeed);
}

export function botSnapshotFromDraft(
  draft: BotProfileInput,
  source: BotSnapshot["source"],
): BotSnapshot {
  return {
    profileId: source === "saved" ? draft.id : undefined,
    scope: source === "saved" ? draft.scope : undefined,
    source,
    name: draft.name.trim(),
    roleDescription: draft.roleDescription.trim(),
    avatarSeed: draft.avatarSeed || draft.id || `bot_${crypto.randomUUID().replaceAll("-", "")}`,
    launch: { ...draft.launch },
  };
}

export function specialistSnapshot(
  suggestion: AgentSpecialistSuggestion,
  profile: AgentProfile,
  stableKey: string,
): BotSnapshot {
  return {
    source: "one-off",
    name: suggestion.name,
    roleDescription: suggestion.roleDescription,
    avatarSeed: stableAvatarSeed(stableKey, suggestion),
    launch: {
      adapterId: suggestion.adapterId || profile.adapterId,
      provider: profile.provider || undefined,
      model: profile.model || undefined,
      thinking: profile.thinking,
    },
  };
}

export function botProfileForLaunch(
  base: AgentProfile | undefined,
  snapshot: BotSnapshot | undefined,
): AgentProfile | undefined {
  if (!snapshot) return base;
  return {
    adapterId: snapshot.launch.adapterId,
    provider: snapshot.launch.provider ?? base?.provider ?? "",
    model: snapshot.launch.model ?? base?.model ?? "",
    thinking: snapshot.launch.thinking ?? base?.thinking ?? "medium",
    approvalPolicy: base?.approvalPolicy ?? "default",
  };
}

export function botSnapshotFromNode(data: JsonObject): BotSnapshot | undefined {
  const value = data.botSnapshot;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as unknown as Partial<BotSnapshot>;
  if (![candidate.name, candidate.roleDescription, candidate.avatarSeed, candidate.launch?.adapterId]
    .every((field) => typeof field === "string")) return undefined;
  return candidate as BotSnapshot;
}

export function botStandingPrompt(prompt: string, snapshot?: BotSnapshot): string {
  if (!snapshot) return prompt;
  return `Standing specialist role: ${snapshot.name}\n\n${snapshot.roleDescription}\n\nApply this standing role throughout the task. Follow wheeljack's current project permissions and do not assume any additional authority.\n\nCurrent task:\n${prompt.trim()}`;
}

export function specialistSuggestion(value: unknown): AgentSpecialistSuggestion | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const name = boundedText(source.name, 80);
  const roleDescription = boundedText(source.roleDescription, 4_000);
  const rationale = boundedText(source.rationale, 240);
  if (!name || !roleDescription || !rationale
    || (source.adapterId !== undefined && typeof source.adapterId !== "string")) return undefined;
  return {
    name,
    roleDescription,
    rationale,
    adapterId: typeof source.adapterId === "string" && source.adapterId.trim()
      ? source.adapterId.trim()
      : undefined,
  };
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= max ? text : undefined;
}

function stableAvatarSeed(stableKey: string, suggestion: AgentSpecialistSuggestion): string {
  let hash = 2166136261;
  const input = `${stableKey}:${suggestion.name}:${suggestion.roleDescription}`;
  for (const character of input) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `bot_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** Resolve the exact configuration used by this pane's next turn and resume. */
export function effectivePaneAgentProfile(base: AgentProfile | undefined, data: JsonObject): AgentProfile | undefined {
  const profile = botProfileForLaunch(base, botSnapshotFromNode(data));
  if (!profile) return undefined;
  const override = data.agentProfile;
  if (!override || typeof override !== "object" || Array.isArray(override)) return profile;
  const saved = override as Partial<AgentProfile>;
  return {
    ...profile,
    provider: typeof saved.provider === "string" ? saved.provider : profile.provider,
    model: typeof saved.model === "string" ? saved.model : profile.model,
    thinking: typeof saved.thinking === "string" ? saved.thinking : profile.thinking,
  };
}
