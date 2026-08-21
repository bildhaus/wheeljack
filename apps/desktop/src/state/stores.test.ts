import { beforeEach, describe, expect, test } from "vitest";
import type { Canvas, CanvasNode, Project } from "../types";
import {
  canvasRef,
  currentWorkspace,
  nodesRef,
  projectRef,
  setCanvas,
  setNodes,
  setProject,
  workspaceStore,
} from "./workspaceStore";
import { currentOps, defaultOpsState, opsStateRef, opsStore, setOpsState } from "./opsStore";

describe("shell ownership stores", () => {
  beforeEach(() => {
    workspaceStore.setState({
      projects: [],
      project: undefined,
      canvases: [],
      canvas: undefined,
      nodes: [],
      layout: null,
      layoutMode: "auto",
      focusedPaneId: null,
    });
    opsStore.setState({ opsState: defaultOpsState() });
  });

  test("keeps workspace reads synchronous across setters and compatibility refs", () => {
    const project = { id: "project-1", name: "wheeljack", path: "C:\\repo" } as Project;
    const canvas = { id: "canvas-1", projectId: project.id, name: "Main" } as Canvas;
    const node = { id: "node-1", canvasId: canvas.id, kind: "agent_terminal" } as CanvasNode;

    setProject(project);
    setCanvas(canvas);
    setNodes([node]);

    expect(currentWorkspace()).toMatchObject({ project, canvas, nodes: [node] });
    expect(projectRef.current).toBe(project);
    expect(canvasRef.current).toBe(canvas);

    setNodes([]);
    expect(currentWorkspace().nodes).toEqual([]);
    expect(nodesRef.current).toEqual([]);
  });

  test("keeps Ops mutations synchronous for document and scheduler work", () => {
    const next = { ...defaultOpsState(), prd: "# Product" };

    setOpsState(next);
    expect(currentOps()).toBe(next);
    expect(opsStateRef.current).toBe(next);

    setOpsState((current) => ({ ...current, tdd: "# Design" }));
    expect(currentOps().tdd).toBe("# Design");
    expect(opsStateRef.current.tdd).toBe("# Design");
  });
});
