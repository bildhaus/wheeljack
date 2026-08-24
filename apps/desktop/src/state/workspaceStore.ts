import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Canvas, CanvasNode, LayoutMode, Project, SplitNode } from "../types";

type StateUpdate<T> = T | ((current: T) => T);

export interface WorkspaceState {
  projects: Project[];
  project?: Project;
  canvases: Canvas[];
  canvas?: Canvas;
  nodes: CanvasNode[];
  layout: SplitNode | null;
  layoutMode: LayoutMode;
  focusedPaneId: string | null;
}

const initialWorkspaceState: WorkspaceState = {
  projects: [],
  project: undefined,
  canvases: [],
  canvas: undefined,
  nodes: [],
  layout: null,
  layoutMode: "auto",
  focusedPaneId: null,
};

export const workspaceStore = createStore<WorkspaceState>(() => initialWorkspaceState);

export function currentWorkspace(): WorkspaceState {
  return workspaceStore.getState();
}

function setWorkspaceValue<K extends keyof WorkspaceState>(
  key: K,
  next: StateUpdate<WorkspaceState[K]>,
) {
  workspaceStore.setState((state) => ({
    [key]: typeof next === "function"
      ? (next as (current: WorkspaceState[K]) => WorkspaceState[K])(state[key])
      : next,
  }) as Pick<WorkspaceState, K>);
}

export const setProjects = (next: StateUpdate<Project[]>) => setWorkspaceValue("projects", next);
export const setProject = (next: StateUpdate<Project | undefined>) => setWorkspaceValue("project", next);
export const setCanvases = (next: StateUpdate<Canvas[]>) => setWorkspaceValue("canvases", next);
export const setCanvas = (next: StateUpdate<Canvas | undefined>) => setWorkspaceValue("canvas", next);
export const setNodes = (next: StateUpdate<CanvasNode[]>) => setWorkspaceValue("nodes", next);
export const setLayout = (next: StateUpdate<SplitNode | null>) => setWorkspaceValue("layout", next);
export const setLayoutMode = (next: StateUpdate<LayoutMode>) => setWorkspaceValue("layoutMode", next);
export const setFocusedPaneId = (next: StateUpdate<string | null>) => setWorkspaceValue("focusedPaneId", next);

export function useWorkspace(): WorkspaceState {
  return useStore(workspaceStore);
}

type StoreRef<K extends keyof WorkspaceState> = {
  readonly current: WorkspaceState[K];
};

function workspaceRef<K extends keyof WorkspaceState>(key: K): StoreRef<K> {
  return {
    get current() {
      return currentWorkspace()[key];
    },
  };
}

// Compatibility accessors let the existing async orchestration code read the
// latest durable workspace snapshot while ownership moves out of App.tsx.
export const projectRef = workspaceRef("project");
export const canvasesRef = workspaceRef("canvases");
export const canvasRef = workspaceRef("canvas");
export const nodesRef = workspaceRef("nodes");
export const layoutRef = workspaceRef("layout");
export const layoutModeRef = workspaceRef("layoutMode");
export const focusedPaneIdRef = workspaceRef("focusedPaneId");
