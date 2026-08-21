import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { OpsState } from "../types";

type OpsStateUpdate = OpsState | ((current: OpsState) => OpsState);

export function defaultKanbanColumns(): OpsState["columns"] {
  return [
    { id: "queued", title: "Queued", role: "queued" },
    { id: "active", title: "In progress", role: "active" },
    { id: "review", title: "Review", role: "review" },
    { id: "done", title: "Done", role: "done" },
  ];
}

export function defaultOpsState(): OpsState {
  return {
    version: 2,
    columns: defaultKanbanColumns(),
    cards: [],
    prd: "",
    tdd: "",
    eventCursors: {},
  };
}

interface OpsStoreState {
  opsState: OpsState;
}

export const opsStore = createStore<OpsStoreState>(() => ({ opsState: defaultOpsState() }));

export function currentOps(): OpsState {
  return opsStore.getState().opsState;
}

export function setOpsState(next: OpsStateUpdate) {
  opsStore.setState((state) => ({
    opsState: typeof next === "function" ? next(state.opsState) : next,
  }));
}

export function useOpsState(): OpsState {
  return useStore(opsStore, (state) => state.opsState);
}

export const opsStateRef = {
  get current() {
    return currentOps();
  },
};
