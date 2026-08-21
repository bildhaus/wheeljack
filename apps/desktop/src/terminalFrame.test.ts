import {
  applyTerminalFrame,
  bufferText,
  keyData,
  pasteData,
  selectedText,
  textCellWidth,
} from "./terminalFrame";
import { isTerminalPasteShortcut, shouldAnimateTerminalCursor, terminalContextMenuAllowed, terminalRowVisible } from "./TerminalSurface";
import type { TerminalFrame } from "./types";

const frame = (overrides: Partial<TerminalFrame> = {}): TerminalFrame => ({
  sessionId: "session-one",
  rows: 2,
  cols: 8,
  cursor: { row: 0, col: 0, visible: true, shape: "block", blinking: false },
  altScreen: false,
  mouseReporting: false,
  sgrMouse: false,
  mouseDrag: false,
  mouseMotion: false,
  alternateScroll: false,
  applicationCursor: false,
  applicationKeypad: false,
  bracketedPaste: false,
  focusEvents: false,
  insertMode: false,
  lineWrap: true,
  originMode: false,
  kittyKeyboard: false,
  viewportOffset: 0,
  scrollbackLineCount: 0,
  scrollbackLimit: 4000,
  ...overrides,
});

test("animates a blinking cursor only in the active visible terminal", () => {
  expect(shouldAnimateTerminalCursor(true, true, false, true)).toBe(true);
  expect(shouldAnimateTerminalCursor(false, true, false, true)).toBe(false);
  expect(shouldAnimateTerminalCursor(true, true, false, false)).toBe(false);
  expect(shouldAnimateTerminalCursor(true, true, true, true)).toBe(false);
  expect(shouldAnimateTerminalCursor(true, false, false, true)).toBe(false);
});

test("applies full frames then dirty rows", () => {
  const full = applyTerminalFrame(undefined, frame({
    gridRows: [{ index: 0, runs: [{ column: 0, cellWidth: 5, text: "hello", fg: "Foreground", bg: "Background", flags: 0, bold: false, italic: false, underline: false, inverse: false, dim: false }] }],
  }));
  const delta = applyTerminalFrame(full, frame({
    dirtyRows: [{ index: 1, runs: [{ column: 0, cellWidth: 5, text: "world", fg: "Foreground", bg: "Background", flags: 0, bold: false, italic: false, underline: false, inverse: false, dim: false }] }],
  }));
  expect(bufferText(delta)).toBe("hello\nworld");
});

test("encodes application cursor, control, and bracketed paste input", () => {
  expect(keyData("ArrowUp", { shift: false, alt: false, ctrl: false }, true)).toBe("\u001bOA");
  expect(keyData("c", { shift: false, alt: false, ctrl: true }, false)).toBe("\u0003");
  expect(pasteData("one\ntwo", true)).toBe("\u001b[200~one\rtwo\u001b[201~");
});

test("leaves platform paste shortcuts to the textarea clipboard event", () => {
  expect(isTerminalPasteShortcut("v", true, false, false)).toBe(true);
  expect(isTerminalPasteShortcut("V", false, true, false)).toBe(true);
  expect(isTerminalPasteShortcut("v", true, false, true)).toBe(false);
});

test("preserves wide and combining graphemes in selection", () => {
  const buffer = applyTerminalFrame(undefined, frame({
    rows: 1,
    cols: 4,
    gridRows: [{ index: 0, runs: [
      { column: 0, cellWidth: 3, text: "界e\u0301", fg: "Foreground", bg: "Background", flags: 0, bold: false, italic: false, underline: false, inverse: false, dim: false },
      { column: 3, cellWidth: 1, text: "!", fg: "Foreground", bg: "Background", flags: 0, bold: false, italic: false, underline: false, inverse: false, dim: false },
    ] }],
  }));
  expect(selectedText(buffer, { row: 0, col: 0 }, { row: 0, col: 3 })).toBe("界e\u0301!");
  expect(textCellWidth("界")).toBe(2);
  expect(textCellWidth("e\u0301")).toBe(1);
});

test("encodes function keys, keypad, and punctuation controls", () => {
  expect(keyData("F5", { shift: false, alt: false, ctrl: false }, false)).toBe("\u001b[15~");
  expect(keyData("1", { shift: false, alt: false, ctrl: false }, false, true, "Numpad1")).toBe("\u001bOq");
  expect(keyData("[", { shift: false, alt: false, ctrl: true }, false)).toBe("\u001b");
});

test("reserves unmodified right-click for mouse-aware terminal apps", () => {
  expect(terminalContextMenuAllowed(false, false)).toBe(true);
  expect(terminalContextMenuAllowed(true, false)).toBe(false);
  expect(terminalContextMenuAllowed(true, true)).toBe(true);
});

test("skips terminal rows outside the visible canvas", () => {
  expect(terminalRowVisible(0, 100, 18)).toBe(true);
  expect(terminalRowVisible(5, 100, 18)).toBe(false);
});
