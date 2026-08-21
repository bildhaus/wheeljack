import type { SplitAxis } from "./types";

export function paneDropPosition(
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  clientX: number,
  clientY: number,
): { edge: "left" | "right" | "top" | "bottom" | "center"; axis?: SplitAxis; before?: boolean } {
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (x < 0.24) return { edge: "left", axis: "columns", before: true };
  if (x > 0.76) return { edge: "right", axis: "columns", before: false };
  if (y < 0.24) return { edge: "top", axis: "rows", before: true };
  if (y > 0.76) return { edge: "bottom", axis: "rows", before: false };
  return { edge: "center" };
}
