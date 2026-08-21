import { beforeEach, vi } from "vitest";
import { agentModelCacheKey, loadAgentModels, safeAgentToken } from "./agentModels";

const coreMocks = vi.hoisted(() => ({ callCore: vi.fn() }));
vi.mock("./core", () => coreMocks);

beforeEach(() => {
  localStorage.clear();
  coreMocks.callCore.mockReset();
});

test("caches a discovered model catalog and reuses it", async () => {
  const catalog = { models: [{ id: "model-one", label: "Model one", efforts: ["medium"] }] };
  coreMocks.callCore.mockResolvedValueOnce(catalog);

  await expect(loadAgentModels("adapter-cache", "C:\\repo")).resolves.toEqual(catalog);
  await expect(loadAgentModels("adapter-cache", "C:\\repo")).resolves.toEqual(catalog);

  expect(coreMocks.callCore).toHaveBeenCalledOnce();
  expect(JSON.parse(localStorage.getItem(agentModelCacheKey("adapter-cache", "C:\\repo")) ?? "null").catalog).toEqual(catalog);
});

test("coalesces concurrent discovery and rejects an empty catalog", async () => {
  let finish: ((catalog: { models: Array<{ id: string; label: string; efforts: string[] }> }) => void) | undefined;
  coreMocks.callCore.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const first = loadAgentModels("adapter-pending");
  const second = loadAgentModels("adapter-pending");
  expect(second).toBe(first);
  finish?.({ models: [{ id: "model-two", label: "Model two", efforts: ["high"] }] });
  await first;
  expect(coreMocks.callCore).toHaveBeenCalledOnce();

  coreMocks.callCore.mockResolvedValueOnce({ models: [] });
  await expect(loadAgentModels("adapter-empty")).rejects.toThrow("No models were discovered");
});

test("accepts only bounded CLI-safe model tokens", () => {
  expect(safeAgentToken("openai/gpt-5.6:latest", 128)).toBe(true);
  expect(safeAgentToken("model with spaces", 128)).toBe(false);
  expect(safeAgentToken("x".repeat(129), 128)).toBe(false);
});
