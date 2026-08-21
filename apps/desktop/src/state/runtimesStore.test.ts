import { beforeEach } from "vitest";
import type { PaneRuntime } from "../types";
import { currentRuntimes, runtimesStore, setRuntimes } from "./runtimesStore";

function runtime(nodeId: string, patch: Partial<PaneRuntime> = {}): PaneRuntime {
  return {
    nodeId,
    sessionId: `session-${nodeId}`,
    adapterId: "claude",
    status: "idle",
    messages: [],
    structured: true,
    ...patch,
  } as PaneRuntime;
}

beforeEach(() => {
  runtimesStore.setState({ runtimes: {} });
});

// This is the invariant `runtimesRef` existed to fake. It was a shadow copy that had
// to be written alongside every setRuntimes call, so any missed write left a reader
// looking at a stale map. The store makes the synchronous read and the render read
// the same value by construction.
test("a synchronous read sees the value written by the preceding update", () => {
  setRuntimes({ a: runtime("a") });
  expect(Object.keys(currentRuntimes())).toEqual(["a"]);

  setRuntimes((current) => ({ ...current, b: runtime("b") }));
  expect(Object.keys(currentRuntimes())).toEqual(["a", "b"]);
});

test("functional updates compose within a single tick", () => {
  setRuntimes({ a: runtime("a", { status: "idle" }) });
  setRuntimes((current) => ({ ...current, a: { ...current.a, status: "running" } }));
  setRuntimes((current) => ({ ...current, b: runtime("b") }));

  expect(currentRuntimes().a.status).toBe("running");
  expect(Object.keys(currentRuntimes())).toEqual(["a", "b"]);
});

test("removing a pane drops it from the synchronous read immediately", () => {
  setRuntimes({ a: runtime("a"), b: runtime("b") });

  const next = { ...currentRuntimes() };
  delete next.b;
  setRuntimes(next);

  expect(Object.keys(currentRuntimes())).toEqual(["a"]);
  expect(currentRuntimes().b).toBeUndefined();
});

test("notifies subscribers once per update with the new map", () => {
  const seen: number[] = [];
  const unsubscribe = runtimesStore.subscribe((state) => seen.push(Object.keys(state.runtimes).length));

  setRuntimes({ a: runtime("a") });
  setRuntimes((current) => ({ ...current, b: runtime("b") }));
  unsubscribe();
  setRuntimes((current) => ({ ...current, c: runtime("c") }));

  expect(seen).toEqual([1, 2]);
});
