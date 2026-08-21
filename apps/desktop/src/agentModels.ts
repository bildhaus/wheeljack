import { callCore } from "./core";
import type { AgentModelCatalog } from "./types";

const AGENT_MODEL_CACHE_PREFIX = "wheeljack.agentModels.";
const AGENT_MODEL_CACHE_TTL = 60 * 60 * 1000;
const agentModelRequests = new Map<string, Promise<AgentModelCatalog>>();

export function agentModelCacheKey(adapterId: string, cwd?: string) {
  return `${AGENT_MODEL_CACHE_PREFIX}${encodeURIComponent(`${adapterId}\0${cwd ?? ""}`)}`;
}

export function cachedAgentModels(key: string): AgentModelCatalog | undefined {
  try {
    const cached = JSON.parse(localStorage.getItem(key) ?? "null") as { updatedAt?: unknown; catalog?: unknown } | null;
    const catalog = cached?.catalog as AgentModelCatalog | undefined;
    const updatedAt = Number(cached?.updatedAt);
    const age = Date.now() - updatedAt;
    if (!Number.isFinite(updatedAt) || age < 0 || age >= AGENT_MODEL_CACHE_TTL || !catalog?.models.length) return;
    if (!catalog.models.every((item) => typeof item?.id === "string" && typeof item.label === "string" && Array.isArray(item.efforts))) return;
    return catalog;
  } catch {
    return;
  }
}

export function loadAgentModels(adapterId: string, cwd?: string): Promise<AgentModelCatalog> {
  const key = agentModelCacheKey(adapterId, cwd);
  const cached = cachedAgentModels(key);
  if (cached) return Promise.resolve(cached);
  const pending = agentModelRequests.get(key);
  if (pending) return pending;
  const request = callCore<AgentModelCatalog>("agent_models_list", { adapterId, cwd })
    .then((catalog) => {
      if (!catalog.models.length) throw new Error("No models were discovered. Retry after the adapter is ready.");
      try {
        localStorage.setItem(key, JSON.stringify({ updatedAt: Date.now(), catalog }));
      } catch {
        // Cache failure must not block model discovery.
      }
      return catalog;
    })
    .finally(() => agentModelRequests.delete(key));
  agentModelRequests.set(key, request);
  return request;
}

export function safeAgentToken(value: string, maxLength: number): boolean {
  return value.length <= maxLength && /^[A-Za-z0-9._:/~+-]+$/.test(value);
}
