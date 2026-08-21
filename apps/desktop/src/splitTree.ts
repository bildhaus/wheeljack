import type { LayoutMode, SplitAxis, SplitNode } from "./types";

const clampRatio = (ratio: number) => Math.min(0.85, Math.max(0.15, ratio));
const SMART_TARGET_ASPECT = 1.35;
const SMART_MIN_WIDTH = 320;
const SMART_MIN_HEIGHT = 220;
const SMART_MAX_COLUMNS = 6;

export interface LayoutViewport {
  width: number;
  height: number;
}

export type PanePlacement = "auto" | SplitAxis;

export function leaves(node: SplitNode | null): string[] {
  if (!node) return [];
  return node.type === "leaf"
    ? [node.paneId]
    : [...leaves(node.first), ...leaves(node.second)];
}

export function reconcileLayout(
  saved: unknown,
  paneIds: string[],
): SplitNode | null {
  const known = new Set(paneIds);
  let root = parseNode(saved, known);
  for (const paneId of paneIds.filter((id) => !leaves(root).includes(id))) {
    root = root
      ? {
          type: "split",
          axis: root.type === "split" && root.axis === "columns" ? "rows" : "columns",
          ratio: 0.5,
          first: root,
          second: { type: "leaf", paneId },
        }
      : { type: "leaf", paneId };
  }
  return root;
}

export function splitPane(
  root: SplitNode | null,
  focusedPaneId: string | null,
  paneId: string,
  axis: SplitAxis,
): SplitNode {
  if (!root || !focusedPaneId) return { type: "leaf", paneId };
  return replace(root, focusedPaneId, (leaf) => ({
    type: "split",
    axis,
    ratio: 0.5,
    first: leaf,
    second: { type: "leaf", paneId },
  }));
}

export function smartLayoutColumns(
  paneCount: number,
  viewport: LayoutViewport,
): number {
  if (paneCount <= 1) return 1;
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  let bestColumns = 1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let columns = 1; columns <= Math.min(paneCount, SMART_MAX_COLUMNS); columns++) {
    const rows = Math.ceil(paneCount / columns);
    const paneWidth = width / columns;
    const paneHeight = height / rows;
    const aspectScore = Math.abs(Math.log((paneWidth / paneHeight) / SMART_TARGET_ASPECT));
    const widthPenalty = paneWidth < SMART_MIN_WIDTH ? ((SMART_MIN_WIDTH / paneWidth) - 1) * 2 : 0;
    const heightPenalty = paneHeight < SMART_MIN_HEIGHT ? ((SMART_MIN_HEIGHT / paneHeight) - 1) * 1.5 : 0;
    const unusedCellPenalty = ((columns * rows - paneCount) / (columns * rows)) * 0.75;
    const score = aspectScore + widthPenalty + heightPenalty + unusedCellPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestColumns = columns;
    }
  }
  return bestColumns;
}

export function buildSmartLayout(
  paneIds: string[],
  viewport: LayoutViewport,
): SplitNode | null {
  if (!paneIds.length) return null;
  const columnCount = smartLayoutColumns(paneIds.length, viewport);
  const baseColumnSize = Math.floor(paneIds.length / columnCount);
  const largerColumns = paneIds.length % columnCount;
  const columns: SplitNode[] = [];
  let offset = 0;
  for (let column = 0; column < columnCount; column++) {
    const size = baseColumnSize + (column >= columnCount - largerColumns ? 1 : 0);
    const columnLeaves = paneIds
      .slice(offset, offset + size)
      .map((paneId): SplitNode => ({ type: "leaf", paneId }));
    columns.push(combineEvenly(columnLeaves, "rows"));
    offset += size;
  }
  return combineEvenly(columns, "columns");
}

export function insertPane(
  root: SplitNode | null,
  focusedPaneId: string | null,
  paneId: string,
  mode: LayoutMode,
  placement: PanePlacement,
  viewport: LayoutViewport,
): { root: SplitNode; mode: LayoutMode } {
  if (placement === "auto" && mode === "auto") {
    return {
      root: buildSmartLayout([...leaves(root), paneId], viewport)!,
      mode,
    };
  }
  const axis = placement === "auto"
    ? suggestedSplitAxis(root, focusedPaneId, viewport)
    : placement;
  return {
    root: splitPane(root, focusedPaneId, paneId, axis),
    mode: placement === "auto" ? mode : "manual",
  };
}

export function removePane(
  root: SplitNode | null,
  paneId: string,
): SplitNode | null {
  if (!root) return null;
  if (root.type === "leaf") return root.paneId === paneId ? null : root;
  const first = removePane(root.first, paneId);
  const second = removePane(root.second, paneId);
  if (!first) return second;
  if (!second) return first;
  return { ...root, first, second };
}

export function setSplitRatio(
  root: SplitNode,
  path: string,
  ratio: number,
): SplitNode {
  if (!path) {
    return root.type === "split" ? { ...root, ratio: clampRatio(ratio) } : root;
  }
  if (root.type === "leaf") return root;
  const [head, ...tail] = path.split(".");
  return head === "first"
    ? { ...root, first: setSplitRatio(root.first, tail.join("."), ratio) }
    : { ...root, second: setSplitRatio(root.second, tail.join("."), ratio) };
}

export function equalizeLayout(node: SplitNode | null): SplitNode | null {
  if (!node || node.type === "leaf") return node;
  return {
    ...node,
    ratio: 0.5,
    first: equalizeLayout(node.first)!,
    second: equalizeLayout(node.second)!,
  };
}

export function sameLayout(left: SplitNode | null, right: SplitNode | null): boolean {
  if (!left || !right) return left === right;
  if (left.type !== right.type) return false;
  if (left.type === "leaf" && right.type === "leaf") return left.paneId === right.paneId;
  if (left.type === "leaf" || right.type === "leaf") return false;
  return left.axis === right.axis
    && left.ratio === right.ratio
    && sameLayout(left.first, right.first)
    && sameLayout(left.second, right.second);
}

export function movePane(
  node: SplitNode | null,
  sourcePaneId: string,
  targetPaneId: string,
  edgeAxis?: SplitAxis,
  before = false,
): SplitNode | null {
  if (!node || sourcePaneId === targetPaneId) return node;
  const paneIds = leaves(node);
  if (!paneIds.includes(sourcePaneId) || !paneIds.includes(targetPaneId)) return node;
  if (!edgeAxis) return swapLeaves(node, sourcePaneId, targetPaneId);
  const withoutSource = removePane(node, sourcePaneId);
  if (!withoutSource) return { type: "leaf", paneId: sourcePaneId };
  return replace(withoutSource, targetPaneId, (target) => ({
    type: "split",
    axis: edgeAxis,
    ratio: 0.5,
    first: before ? { type: "leaf", paneId: sourcePaneId } : target,
    second: before ? target : { type: "leaf", paneId: sourcePaneId },
  }));
}

export function resizePane(
  node: SplitNode,
  paneId: string,
  direction: "left" | "right" | "up" | "down",
): SplitNode {
  if (node.type === "leaf") return node;
  const axis = direction === "left" || direction === "right" ? "columns" : "rows";
  if (node.axis === axis && leaves(node).includes(paneId)) {
    const delta = direction === "right" || direction === "down" ? 0.04 : -0.04;
    return { ...node, ratio: clampRatio(node.ratio + delta) };
  }
  const firstHasPane = leaves(node.first).includes(paneId);
  return {
    ...node,
    first: firstHasPane ? resizePane(node.first, paneId, direction) : node.first,
    second: firstHasPane ? node.second : resizePane(node.second, paneId, direction),
  };
}

function parseNode(value: unknown, known: Set<string>): SplitNode | null {
  if (!value || typeof value !== "object") return null;
  const node = value as Record<string, unknown>;
  if (node.type === "leaf") {
    return typeof node.paneId === "string" && known.has(node.paneId)
      ? { type: "leaf", paneId: node.paneId }
      : null;
  }
  if (node.type !== "split") return null;
  const first = parseNode(node.first, known);
  const second = parseNode(node.second, known);
  if (!first) return second;
  if (!second) return first;
  return {
    type: "split",
    axis: node.axis === "rows" ? "rows" : "columns",
    ratio: clampRatio(typeof node.ratio === "number" ? node.ratio : 0.5),
    first,
    second,
  };
}

function replace(
  node: SplitNode,
  paneId: string,
  replacement: (leaf: SplitNode & { type: "leaf" }) => SplitNode,
): SplitNode {
  if (node.type === "leaf") {
    return node.paneId === paneId ? replacement(node) : node;
  }
  return {
    ...node,
    first: replace(node.first, paneId, replacement),
    second: replace(node.second, paneId, replacement),
  };
}

function swapLeaves(node: SplitNode, left: string, right: string): SplitNode {
  if (node.type === "leaf") {
    if (node.paneId === left) return { ...node, paneId: right };
    if (node.paneId === right) return { ...node, paneId: left };
    return node;
  }
  return {
    ...node,
    first: swapLeaves(node.first, left, right),
    second: swapLeaves(node.second, left, right),
  };
}

function combineEvenly(nodes: SplitNode[], axis: SplitAxis): SplitNode {
  if (nodes.length === 1) return nodes[0];
  const midpoint = Math.ceil(nodes.length / 2);
  return {
    type: "split",
    axis,
    ratio: midpoint / nodes.length,
    first: combineEvenly(nodes.slice(0, midpoint), axis),
    second: combineEvenly(nodes.slice(midpoint), axis),
  };
}

function suggestedSplitAxis(
  root: SplitNode | null,
  paneId: string | null,
  viewport: LayoutViewport,
): SplitAxis {
  const parentAxis = root && paneId ? deepestParentAxis(root, paneId) : undefined;
  if (parentAxis) return parentAxis === "columns" ? "rows" : "columns";
  return viewport.width >= viewport.height ? "columns" : "rows";
}

function deepestParentAxis(node: SplitNode, paneId: string): SplitAxis | undefined {
  if (node.type === "leaf") return undefined;
  const child = leaves(node.first).includes(paneId) ? node.first
    : leaves(node.second).includes(paneId) ? node.second
    : undefined;
  if (!child) return undefined;
  return deepestParentAxis(child, paneId) ?? node.axis;
}
