import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import {
  applyTerminalFrame,
  bufferText,
  color,
  keyData,
  pasteData,
  selectedText,
  type Cell,
  type TerminalBuffer,
} from "./terminalFrame";
import type { TerminalFrame, TerminalRun } from "./types";

interface Props {
  active: boolean;
  frame?: TerminalFrame;
  frameReceivedAt?: number;
  fallbackText: string;
  onWrite: (data: string | Uint8Array) => void;
  onResize: (rows: number, cols: number) => void;
  onViewport: (displayOffset: number) => void;
  onPaint: (milliseconds: number) => void;
  onResizePaint: (milliseconds: number) => void;
  onContextMenuSelection?: (text: string) => void;
}

const padding = 10;
const defaultLineHeight = 18;

export function shouldAnimateTerminalCursor(
  active: boolean,
  blinking: boolean,
  reducedMotion: boolean,
  visible: boolean,
): boolean {
  return active && blinking && !reducedMotion && visible;
}

export function TerminalSurface({
  active,
  frame,
  frameReceivedAt,
  fallbackText,
  onWrite,
  onResize,
  onViewport,
  onPaint,
  onResizePaint,
  onContextMenuSelection,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bufferRef = useRef<TerminalBuffer | undefined>(undefined);
  const metricsRef = useRef({ cellWidth: 8, lineHeight: defaultLineHeight, rows: 24, cols: 80 });
  const selectionRef = useRef<{ anchor: Cell; end: Cell } | undefined>(undefined);
  const mouseButtonRef = useRef(-1);
  const composingRef = useRef(false);
  const resizeTimerRef = useRef<number | undefined>(undefined);
  const resizeFrameRef = useRef<number | undefined>(undefined);
  const recordedFrameRef = useRef<number | undefined>(undefined);
  const paintStyleRef = useRef<{
    key: string;
    fontSize: number;
    lineHeight: number;
    fontFamily: string;
    cellWidth: number;
    terminal: string;
    muted: string;
    cursor: string;
    reducedMotion: boolean;
  } | undefined>(undefined);
  if (frame && bufferRef.current?.frame !== frame) {
    bufferRef.current = applyTerminalFrame(bufferRef.current, frame);
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    const styleKey = document.documentElement.style.cssText;
    let paintStyle = paintStyleRef.current;
    if (!paintStyle || paintStyle.key !== styleKey) {
      const style = getComputedStyle(host);
      const fontSize = Number.parseFloat(style.getPropertyValue("--wj-terminal-size")) || 13;
      const fontFamily = style.getPropertyValue("--wj-code-font").trim() || "monospace";
      context.font = `${fontSize}px ${fontFamily}`;
      paintStyle = {
        key: styleKey,
        fontSize,
        lineHeight: Math.ceil(fontSize * 1.38),
        fontFamily,
        cellWidth: Math.max(7, context.measureText("M").width),
        terminal: cssColor("--terminal", "#0b0d11"),
        muted: cssColor("--muted-foreground", "#858b98"),
        cursor: cssColor("--terminal-cursor", "#ff7a45"),
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      };
      paintStyleRef.current = paintStyle;
    }
    const { fontSize, lineHeight, fontFamily, cellWidth } = paintStyle;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = paintStyle.terminal;
    context.fillRect(0, 0, width, height);
    context.font = `${fontSize}px ${fontFamily}`;
    context.textBaseline = "top";
    metricsRef.current.cellWidth = cellWidth;
    metricsRef.current.lineHeight = lineHeight;

    const buffer = bufferRef.current;
    if (!buffer) {
      context.fillStyle = paintStyle.muted;
      fallbackText.split(/\r?\n/).slice(-Math.floor((height - padding * 2) / lineHeight)).forEach((line, index) => {
        context.fillText(line, padding, padding + index * lineHeight);
      });
      return;
    }

    for (const row of buffer.rows.values()) {
      if (!terminalRowVisible(row.index, height, lineHeight)) continue;
      for (const run of row.runs) {
        const paint = runPaint(run);
        if (paint.background) {
          context.fillStyle = paint.background;
          context.fillRect(
            padding + run.column * cellWidth,
            padding + row.index * lineHeight,
            Math.max(1, run.cellWidth) * cellWidth,
            lineHeight,
          );
        }
      }
    }
    drawSelection(context, selectionRef.current, cellWidth, lineHeight);
    for (const row of buffer.rows.values()) {
      if (!terminalRowVisible(row.index, height, lineHeight)) continue;
      for (const run of row.runs) drawRun(context, row.index, run, cellWidth, lineHeight, `${fontSize}px ${fontFamily}`);
    }
    const cursor = buffer.frame.cursor;
    const cursorVisible = cursor.visible && (
      !shouldAnimateTerminalCursor(active, cursor.blinking, paintStyle.reducedMotion, document.visibilityState !== "hidden") ||
      Math.floor(performance.now() / 500) % 2 === 0
    );
    if (cursorVisible && cursor.row >= 0) {
      context.fillStyle = paintStyle.cursor;
      const x = padding + cursor.col * cellWidth;
      const y = padding + cursor.row * lineHeight;
      const shape = cursor.shape.toLowerCase();
      if (shape.includes("underline")) context.fillRect(x, y + lineHeight - 2, cellWidth, 2);
      else if (shape.includes("beam") || shape.includes("bar")) context.fillRect(x, y, 2, lineHeight);
      else {
        context.globalAlpha = 0.68;
        context.fillRect(x, y, cellWidth, lineHeight);
        context.globalAlpha = 1;
      }
    }
    if (frameReceivedAt !== undefined && recordedFrameRef.current !== frameReceivedAt) {
      recordedFrameRef.current = frameReceivedAt;
      onPaint(performance.now() - frameReceivedAt);
    }
  }, [active, fallbackText, frameReceivedAt, onPaint]);
  const drawRef = useRef(draw);
  const onResizeRef = useRef(onResize);
  const onResizePaintRef = useRef(onResizePaint);
  drawRef.current = draw;
  onResizeRef.current = onResize;
  onResizePaintRef.current = onResizePaint;

  useLayoutEffect(() => {
    draw();
  }, [draw, frame]);

  useEffect(() => {
    const blinking = Boolean(frame?.cursor.blinking);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer: number | undefined;
    const sync = () => {
      window.clearInterval(timer);
      timer = undefined;
      if (!shouldAnimateTerminalCursor(active, blinking, reducedMotion, document.visibilityState !== "hidden")) return;
      timer = window.setInterval(() => requestAnimationFrame(draw), 500);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.clearInterval(timer);
    };
  }, [active, draw, frame?.cursor.blinking]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      if (resizeFrameRef.current !== undefined) return;
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = undefined;
        const started = performance.now();
        onResizePaintRef.current(performance.now() - started);
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = window.setTimeout(() => {
          const { cellWidth, lineHeight } = metricsRef.current;
          const rows = Math.max(1, Math.floor((host.clientHeight - padding * 2) / lineHeight));
          const cols = Math.max(1, Math.floor((host.clientWidth - padding * 2) / cellWidth));
          if (rows !== metricsRef.current.rows || cols !== metricsRef.current.cols) {
            metricsRef.current = { cellWidth, lineHeight, rows, cols };
            onResizeRef.current(rows, cols);
          }
          drawRef.current();
        }, 90);
      });
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      if (resizeFrameRef.current !== undefined) cancelAnimationFrame(resizeFrameRef.current);
      window.clearTimeout(resizeTimerRef.current);
    };
  }, []);

  const writeMouse = (
    cell: Cell,
    button: number,
    release: boolean,
    event: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean },
    motion = false,
  ) => {
    const activeFrame = bufferRef.current?.frame;
    if (!activeFrame) return;
    let code = button;
    if (event.shiftKey) code += 4;
    if (event.altKey) code += 8;
    if (event.ctrlKey) code += 16;
    if (motion) code += 32;
    const col = cell.col + 1;
    const row = cell.row + 1;
    onWrite(
      activeFrame.sgrMouse
        ? `\u001b[<${code};${col};${row}${release ? "m" : "M"}`
        : new Uint8Array([0x1b, 0x5b, 0x4d, legacy(code), legacy(col), legacy(row)]),
    );
  };

  const pointerCell = (event: PointerEvent<HTMLDivElement>): Cell => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      row: Math.max(0, Math.floor((event.clientY - rect.top - padding) / metricsRef.current.lineHeight)),
      col: Math.max(0, Math.floor((event.clientX - rect.left - padding) / metricsRef.current.cellWidth)),
    };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    inputRef.current?.focus({ preventScroll: true });
    const activeFrame = bufferRef.current?.frame;
    const cell = pointerCell(event);
    if (activeFrame?.mouseReporting && !event.shiftKey) {
      mouseButtonRef.current = event.button;
      event.currentTarget.setPointerCapture(event.pointerId);
      writeMouse(cell, event.button, false, event);
      return;
    }
    if (event.button === 0) {
      selectionRef.current = { anchor: cell, end: cell };
      if (hostRef.current) hostRef.current.dataset.selectionActive = "true";
      event.currentTarget.setPointerCapture(event.pointerId);
      requestAnimationFrame(draw);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const activeFrame = bufferRef.current?.frame;
    const cell = pointerCell(event);
    if (activeFrame?.mouseReporting && !event.shiftKey) {
      const button = mouseButtonRef.current >= 0 ? mouseButtonRef.current : 3;
      const report =
        mouseButtonRef.current >= 0
          ? activeFrame.mouseDrag || activeFrame.mouseMotion
          : activeFrame.mouseMotion;
      if (report) writeMouse(cell, button, false, event, true);
      return;
    }
    if (selectionRef.current && event.buttons === 1) {
      selectionRef.current.end = cell;
      requestAnimationFrame(draw);
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const activeFrame = bufferRef.current?.frame;
    if (activeFrame?.mouseReporting && !event.shiftKey && mouseButtonRef.current >= 0) {
      writeMouse(pointerCell(event), activeFrame.sgrMouse ? mouseButtonRef.current : 3, true, event);
    }
    mouseButtonRef.current = -1;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const activeFrame = bufferRef.current?.frame;
    if (isTerminalPasteShortcut(event.key, event.ctrlKey, event.metaKey, event.altKey)) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && selectionRef.current && bufferRef.current) {
      const text = selectedText(bufferRef.current, selectionRef.current.anchor, selectionRef.current.end);
      if (text) void navigator.clipboard.writeText(text);
      event.preventDefault();
      return;
    }
    const encoded = keyData(
      event.key,
      { shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey },
      activeFrame?.applicationCursor ?? false,
      activeFrame?.applicationKeypad ?? false,
      event.code,
    );
    if (encoded) {
      onWrite(encoded);
      event.preventDefault();
    } else if (event.altKey && !event.ctrlKey && event.key.length === 1) {
      onWrite(`\u001b${event.key}`);
      event.preventDefault();
    }
  };

  const onInput = (event: FormEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) return;
    const value = event.currentTarget.value;
    if (value) onWrite(value);
    event.currentTarget.value = "";
  };

  const onCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    if (event.data) onWrite(event.data);
    event.currentTarget.value = "";
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    onWrite(pasteData(event.clipboardData.getData("text"), bufferRef.current?.frame.bracketedPaste ?? false));
  };

  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const activeFrame = bufferRef.current?.frame;
    if (!terminalContextMenuAllowed(activeFrame?.mouseReporting ?? false, event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const selection = selectionRef.current;
    const buffer = bufferRef.current;
    onContextMenuSelection?.(selection && buffer ? selectedText(buffer, selection.anchor, selection.end) : "");
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const activeFrame = bufferRef.current?.frame;
    if (!activeFrame) return;
    const ticks = Math.max(1, Math.round(Math.abs(event.deltaY) / 100));
    if (activeFrame.mouseReporting && !event.shiftKey) {
      const button = event.deltaY < 0 ? 64 : 65;
      for (let index = 0; index < ticks; index++) writeMouse(pointerCell(event as unknown as PointerEvent<HTMLDivElement>), button, false, event);
    } else if (activeFrame.alternateScroll && !event.shiftKey) {
      onWrite((event.deltaY < 0 ? "\u001b[A" : "\u001b[B").repeat(ticks));
    } else {
      const next = Math.max(
        0,
        Math.min(activeFrame.scrollbackLineCount, activeFrame.viewportOffset + (event.deltaY < 0 ? ticks * 3 : -ticks * 3)),
      );
      onViewport(next);
    }
    event.preventDefault();
  };

  const accessibleText = bufferText(bufferRef.current) || fallbackText;
  const styledRunCount = [...(bufferRef.current?.rows.values() ?? [])]
    .flatMap((row) => row.runs)
    .filter((run) => run.fg || run.bg || run.bold || run.dim || run.italic || run.underline || run.inverse)
    .length;

  return (
    <div
      ref={hostRef}
      className="terminal"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={onContextMenu}
      onWheel={onWheel}
      role="application"
      aria-label="Terminal session"
      data-alternate-screen={bufferRef.current?.frame.altScreen ? "true" : "false"}
      data-mouse-reporting={bufferRef.current?.frame.mouseReporting ? "true" : "false"}
      data-scrollback-lines={bufferRef.current?.frame.scrollbackLineCount ?? 0}
      data-terminal-rows={bufferRef.current?.frame.rows ?? 0}
      data-terminal-cols={bufferRef.current?.frame.cols ?? 0}
      data-styled-runs={styledRunCount}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      <textarea
        ref={inputRef}
        className="terminal-input"
        aria-label="Terminal input"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onKeyDown={onKeyDown}
        onInput={onInput}
        onPaste={onPaste}
        onFocus={() => {
          if (bufferRef.current?.frame.focusEvents) onWrite("\u001b[I");
        }}
        onBlur={() => {
          if (bufferRef.current?.frame.focusEvents) onWrite("\u001b[O");
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={onCompositionEnd}
      />
      <pre className="sr-only" aria-label="Terminal output">{accessibleText}</pre>
    </div>
  );
}

export function terminalContextMenuAllowed(mouseReporting: boolean, shiftKey: boolean): boolean {
  return !mouseReporting || shiftKey;
}

export function isTerminalPasteShortcut(key: string, ctrlKey: boolean, metaKey: boolean, altKey: boolean): boolean {
  return (ctrlKey || metaKey) && !altKey && key.toLowerCase() === "v";
}

export function terminalRowVisible(row: number, height: number, lineHeight: number): boolean {
  const top = padding + row * lineHeight;
  return top < height && top + lineHeight > 0;
}

function runPaint(run: TerminalRun): { foreground: string; background: string | null } {
  const foreground = color(run.inverse ? run.bg : run.fg, false, run.dim) ?? "#d9dce4";
  const background = color(run.inverse ? run.fg : run.bg, true, false);
  return { foreground, background };
}

function drawRun(
  context: CanvasRenderingContext2D,
  row: number,
  run: TerminalRun,
  cellWidth: number,
  lineHeight: number,
  font: string,
) {
  const paint = runPaint(run);
  context.fillStyle = paint.foreground;
  context.font = `${run.italic ? "italic " : ""}${run.bold ? "600 " : ""}${font}`;
  const x = padding + run.column * cellWidth;
  const y = padding + row * lineHeight;
  context.fillText(run.text, x, y + 1);
  if (run.underline) context.fillRect(x, y + lineHeight - 2, Math.max(1, run.cellWidth) * cellWidth, 1);
}

function drawSelection(
  context: CanvasRenderingContext2D,
  selection: { anchor: Cell; end: Cell } | undefined,
  cellWidth: number,
  lineHeight: number,
) {
  if (!selection) return;
  const first =
    selection.anchor.row < selection.end.row ||
    (selection.anchor.row === selection.end.row && selection.anchor.col <= selection.end.col)
      ? selection.anchor
      : selection.end;
  const second = first === selection.anchor ? selection.end : selection.anchor;
  context.fillStyle = cssColor("--terminal-selection", "rgb(91 141 239 / 35%)");
  for (let row = first.row; row <= second.row; row++) {
    const from = row === first.row ? first.col : 0;
    const to = row === second.row ? second.col : metricsColumns(context, cellWidth);
    context.fillRect(
      padding + from * cellWidth,
      padding + row * lineHeight,
      Math.max(1, to - from + 1) * cellWidth,
      lineHeight,
    );
  }
}

function cssColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function metricsColumns(context: CanvasRenderingContext2D, cellWidth: number): number {
  return Math.max(0, Math.floor((context.canvas.clientWidth - padding * 2) / cellWidth) - 1);
}

function legacy(value: number): number {
  return Math.max(32, Math.min(255, value + 32));
}
