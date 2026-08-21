import {
  buildSmartLayout,
  equalizeLayout,
  insertPane,
  leaves,
  movePane,
  reconcileLayout,
  removePane,
  resizePane,
  setSplitRatio,
  smartLayoutColumns,
  splitPane,
} from "./splitTree";

test("reconciles stale saved panes and appends missing panes", () => {
  const root = reconcileLayout(
    {
      type: "split",
      axis: "columns",
      ratio: 0.7,
      first: { type: "leaf", paneId: "one" },
      second: { type: "leaf", paneId: "gone" },
    },
    ["one", "two"],
  );
  expect(leaves(root)).toEqual(["one", "two"]);
});

test("splits, resizes, and removes recursively", () => {
  let root = splitPane(null, null, "one", "columns");
  root = splitPane(root, "one", "two", "rows");
  root = setSplitRatio(root, "", 0.95);
  expect(root.type === "split" && root.ratio).toBe(0.85);
  expect(leaves(removePane(root, "one"))).toEqual(["two"]);
});

test("equalizes and keyboard-resizes the nearest matching split", () => {
  let root = splitPane(null, null, "one", "columns");
  root = splitPane(root, "one", "two", "rows");
  root = setSplitRatio(root, "", 0.7);
  root = equalizeLayout(root)!;
  expect(root.type === "split" && root.ratio).toBe(0.5);
  root = resizePane(root, "two", "down");
  expect(root.type === "split" && root.ratio).toBe(0.54);
});

test("moves panes by swapping or docking at an edge", () => {
  const root: import("./types").SplitNode = {
    type: "split",
    axis: "columns",
    ratio: 0.5,
    first: { type: "leaf", paneId: "one" },
    second: { type: "leaf", paneId: "two" },
  };
  expect(leaves(movePane(root, "one", "two"))).toEqual(["two", "one"]);
  expect(movePane(root, "one", "two", "rows", true)).toMatchObject({
    type: "split",
    axis: "rows",
    first: { type: "leaf", paneId: "one" },
    second: { type: "leaf", paneId: "two" },
  });
});

test("builds stable responsive bento layouts for common pane counts", () => {
  const viewport = { width: 1200, height: 720 };
  expect(smartLayoutColumns(3, viewport)).toBe(2);
  expect(smartLayoutColumns(4, viewport)).toBe(2);
  expect(smartLayoutColumns(6, viewport)).toBe(3);
  expect(smartLayoutColumns(3, { width: 700, height: 1100 })).toBe(1);

  const root = buildSmartLayout(["one", "two", "three"], viewport);
  expect(root).toMatchObject({
    type: "split",
    axis: "columns",
    ratio: 0.5,
    first: { type: "leaf", paneId: "one" },
    second: { type: "split", axis: "rows", ratio: 0.5 },
  });
  expect(leaves(root)).toEqual(["one", "two", "three"]);
});

test("keeps automatic insertion smart until a user chooses a direction", () => {
  const viewport = { width: 1200, height: 720 };
  const automatic = insertPane(
    buildSmartLayout(["one", "two"], viewport),
    "two",
    "three",
    "auto",
    "auto",
    viewport,
  );
  expect(automatic.mode).toBe("auto");
  expect(automatic.root).toMatchObject({ type: "split", axis: "columns" });

  const manual = insertPane(automatic.root, "three", "four", automatic.mode, "rows", viewport);
  expect(manual.mode).toBe("manual");
  expect(manual.root).toMatchObject({ type: "split", axis: "columns" });

  const preserved = insertPane(manual.root, "four", "five", manual.mode, "auto", viewport);
  expect(preserved.mode).toBe("manual");
  expect(leaves(preserved.root)).toEqual(["one", "two", "three", "four", "five"]);
});
