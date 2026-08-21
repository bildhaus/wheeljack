import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { PaneRuntime } from "../types";

export type RuntimeMap = Record<string, PaneRuntime>;

interface RuntimesState {
  runtimes: RuntimeMap;
}

// Pane runtimes are the hottest state in the shell: structured agent turns write
// here on every protocol tick. The store exists so that a synchronous read and a
// render read are the same value. App.tsx previously mirrored this state into
// `runtimesRef` to get synchronous reads, which meant every mutation had to update
// two places and the ref was one render behind whenever it was synced in an effect.
export const runtimesStore = createStore<RuntimesState>(() => ({ runtimes: {} }));

/** Synchronous read. Replaces `runtimesRef.current`. */
export function currentRuntimes(): RuntimeMap {
  return runtimesStore.getState().runtimes;
}

/** Same call signature as the `useState` setter it replaces. */
export function setRuntimes(next: RuntimeMap | ((current: RuntimeMap) => RuntimeMap)) {
  runtimesStore.setState((state) => ({
    runtimes: typeof next === "function" ? next(state.runtimes) : next,
  }));
}

/** Subscribe to the whole map. Panes should prefer `useRuntime`. */
export function useRuntimes(): RuntimeMap {
  return useStore(runtimesStore, (state) => state.runtimes);
}

/** Subscribe to one pane's runtime, so a turn on pane A does not re-render pane B. */
export function useRuntime(nodeId: string): PaneRuntime | undefined {
  return useStore(runtimesStore, (state) => state.runtimes[nodeId]);
}
