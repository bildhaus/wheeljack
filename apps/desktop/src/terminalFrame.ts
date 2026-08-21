import type { TerminalFrame, TerminalRow, TerminalRun } from "./types";

export interface TerminalBuffer {
  sessionId: string;
  rows: Map<number, TerminalRow>;
  frame: TerminalFrame;
}

export function applyTerminalFrame(
  prior: TerminalBuffer | undefined,
  frame: TerminalFrame,
): TerminalBuffer {
  const rows =
    !prior || prior.sessionId !== frame.sessionId
      ? new Map<number, TerminalRow>()
      : new Map(prior.rows);
  if (frame.gridRows?.length) {
    rows.clear();
    for (const row of frame.gridRows) rows.set(row.index, row);
  } else {
    for (const row of frame.dirtyRows ?? []) rows.set(row.index, row);
  }
  for (const index of rows.keys()) {
    if (index >= frame.rows) rows.delete(index);
  }
  return { sessionId: frame.sessionId, rows, frame };
}

export function bufferText(buffer: TerminalBuffer | undefined): string {
  if (!buffer) return "";
  const lines: string[] = [];
  for (let index = 0; index < buffer.frame.rows; index++) {
    lines.push(rowText(buffer.rows.get(index), buffer.frame.cols).trimEnd());
  }
  return lines.join("\n").trimEnd();
}

export function selectedText(
  buffer: TerminalBuffer,
  start: Cell,
  end: Cell,
): string {
  const [first, second] = compareCell(start, end) <= 0 ? [start, end] : [end, start];
  const lines: string[] = [];
  for (let row = first.row; row <= second.row; row++) {
    const cells = rowCells(buffer.rows.get(row), buffer.frame.cols);
    const from = row === first.row ? first.col : 0;
    const to = row === second.row ? second.col : cells.length - 1;
    lines.push(cells.slice(from, to + 1).join("").trimEnd());
  }
  return lines.join("\n");
}

export interface Cell {
  row: number;
  col: number;
}

export function keyData(
  key: string,
  modifiers: { shift: boolean; alt: boolean; ctrl: boolean },
  applicationCursor: boolean,
  applicationKeypad = false,
  code = "",
): string | null {
  const modifier =
    1 + (modifiers.shift ? 1 : 0) + (modifiers.alt ? 2 : 0) + (modifiers.ctrl ? 4 : 0);
  const suffix = modifier === 1 ? "" : `;${modifier}`;
  const alt = modifiers.alt ? "\u001b" : "";
  const cursor = (final: string) =>
    modifier === 1
      ? `\u001b${applicationCursor ? "O" : "["}${final}`
      : `\u001b[1;${modifier}${final}`;
  const keys: Record<string, string> = {
    " ": `${alt} `,
    Enter: `${alt}\r`,
    Backspace: `${alt}\u007f`,
    Tab: modifiers.shift ? "\u001b[Z" : `${alt}\t`,
    Escape: `${alt}\u001b`,
    ArrowUp: cursor("A"),
    ArrowDown: cursor("B"),
    ArrowRight: cursor("C"),
    ArrowLeft: cursor("D"),
    Home: cursor("H"),
    End: cursor("F"),
    Insert: `\u001b[2${suffix}~`,
    Delete: `\u001b[3${suffix}~`,
    PageUp: `\u001b[5${suffix}~`,
    PageDown: `\u001b[6${suffix}~`,
    F1: modifier === 1 ? "\u001bOP" : `\u001b[1;${modifier}P`,
    F2: modifier === 1 ? "\u001bOQ" : `\u001b[1;${modifier}Q`,
    F3: modifier === 1 ? "\u001bOR" : `\u001b[1;${modifier}R`,
    F4: modifier === 1 ? "\u001bOS" : `\u001b[1;${modifier}S`,
    F5: `\u001b[15${suffix}~`,
    F6: `\u001b[17${suffix}~`,
    F7: `\u001b[18${suffix}~`,
    F8: `\u001b[19${suffix}~`,
    F9: `\u001b[20${suffix}~`,
    F10: `\u001b[21${suffix}~`,
    F11: `\u001b[23${suffix}~`,
    F12: `\u001b[24${suffix}~`,
  };
  if (applicationKeypad && modifier === 1) {
    const keypad: Record<string, string> = {
      Numpad0: "\u001bOp", Numpad1: "\u001bOq", Numpad2: "\u001bOr",
      Numpad3: "\u001bOs", Numpad4: "\u001bOt", Numpad5: "\u001bOu",
      Numpad6: "\u001bOv", Numpad7: "\u001bOw", Numpad8: "\u001bOx",
      Numpad9: "\u001bOy", NumpadDecimal: "\u001bOn", NumpadAdd: "\u001bOk",
      NumpadSubtract: "\u001bOm", NumpadMultiply: "\u001bOj", NumpadDivide: "\u001bOo",
    };
    if (keypad[code]) return keypad[code];
  }
  if (keys[key]) return keys[key];
  if (modifiers.ctrl && (/^[a-z]$/i.test(key) || [" ", "[", "\\", "]", "^", "_"].includes(key))) {
    const control = /^[a-z]$/i.test(key)
      ? String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64)
      : ({ " ": "\0", "[": "\u001b", "\\": "\u001c", "]": "\u001d", "^": "\u001e", "_": "\u001f" } as Record<string, string>)[key];
    return modifiers.alt ? `\u001b${control}` : control;
  }
  return null;
}

export function pasteData(text: string, bracketed: boolean): string {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\n/g, "\r");
  return bracketed
    ? `\u001b[200~${normalized}\u001b[201~`
    : normalized;
}

export function color(value: string, background: boolean, dim = false): string | null {
  if (value.includes("Background")) return background ? null : themeColor("--terminal", "#111318");
  if (value.includes("Foreground")) return dim ? themeColor("--muted-foreground", "#858b98") : themeColor("--terminal-foreground", "#d9dce4");
  const rgb = value.match(/r:\s*(\d+).*g:\s*(\d+).*b:\s*(\d+)/i);
  if (rgb) return `rgb(${rgb[1]} ${rgb[2]} ${rgb[3]})`;
  const indexed = value.match(/Indexed\((\d+)\)/);
  if (indexed) return indexedColor(Number(indexed[1]));
  const names = ["Black", "Red", "Green", "Yellow", "Blue", "Magenta", "Cyan", "White"];
  const index = names.findIndex((candidate) => value.includes(candidate));
  return index >= 0 ? indexedColor(index) : background ? null : themeColor("--terminal-foreground", "#d9dce4");
}

function indexedColor(index: number): string {
  const ansi = [
    "#111318", "#ff6b6b", "#78dba9", "#f5ce72", "#78a9ff", "#d792ff", "#69d8e7", "#d9dce4",
    "#666c7a", "#ff8585", "#95e6bd", "#ffe29c", "#9abfff", "#e5b0ff", "#8ce7f2", "#ffffff",
  ];
  if (index < 16) return themeColor(`--terminal-ansi-${index}`, ansi[index]);
  if (index <= 231) {
    const n = index - 16;
    const channel = (value: number) => (value === 0 ? 0 : 55 + value * 40);
    return `rgb(${channel(Math.floor(n / 36))} ${channel(Math.floor((n % 36) / 6))} ${channel(n % 6)})`;
  }
  const gray = 8 + (index - 232) * 10;
  return `rgb(${gray} ${gray} ${gray})`;
}

function themeColor(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function rowText(row: TerminalRow | undefined, cols: number): string {
  return rowCells(row, cols).join("");
}

function rowCells(row: TerminalRow | undefined, cols: number): string[] {
  const cells = Array.from({ length: cols }, () => " ");
  for (const run of row?.runs ?? []) fillRun(cells, run);
  return cells;
}

function fillRun(cells: string[], run: TerminalRun): void {
  let column = run.column;
  for (const grapheme of graphemes(run.text)) {
    if (column >= cells.length) break;
    const width = textCellWidth(grapheme);
    if (width === 0 && column > 0) {
      const prior = cells[column - 1] === "" && column > 1 ? column - 2 : column - 1;
      cells[prior] += grapheme;
      continue;
    }
    cells[column] = grapheme;
    if (width > 1 && column + 1 < cells.length) cells[column + 1] = "";
    column += Math.max(1, width);
  }
}

export function textCellWidth(text: string): number {
  const value = text.codePointAt(0);
  if (value === undefined || /^[\p{Mark}\p{Format}]/u.test(text)) return 0;
  return value >= 0x1100 && (
    value <= 0x115f ||
    value === 0x2329 || value === 0x232a ||
    (value >= 0x2e80 && value <= 0xa4cf && value !== 0x303f) ||
    (value >= 0xac00 && value <= 0xd7a3) ||
    (value >= 0xf900 && value <= 0xfaff) ||
    (value >= 0xfe10 && value <= 0xfe19) ||
    (value >= 0xfe30 && value <= 0xfe6f) ||
    (value >= 0xff00 && value <= 0xff60) ||
    (value >= 0xffe0 && value <= 0xffe6) ||
    (value >= 0x1f300 && value <= 0x1faff) ||
    (value >= 0x20000 && value <= 0x3fffd)
  ) ? 2 : 1;
}

function graphemes(text: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((part) => part.segment);
  }
  return Array.from(text);
}

function compareCell(left: Cell, right: Cell): number {
  return left.row === right.row ? left.col - right.col : left.row - right.row;
}
