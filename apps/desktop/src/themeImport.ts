import { parse, type ParseError } from "jsonc-parser";
import { builtInThemes, contrastRatio, validateTheme, type ThemeDefinition, type ThemeVariant } from "./theme";

export type ThemeImportSource = "wheeljack" | "vscode" | "windows-terminal";

export interface ThemeImportResult {
  source: ThemeImportSource;
  themes: ThemeDefinition[];
  warnings: string[];
}

type JsonObject = Record<string, unknown>;

const terminalAnsiKeys = [
  "terminal.ansiBlack",
  "terminal.ansiRed",
  "terminal.ansiGreen",
  "terminal.ansiYellow",
  "terminal.ansiBlue",
  "terminal.ansiMagenta",
  "terminal.ansiCyan",
  "terminal.ansiWhite",
  "terminal.ansiBrightBlack",
  "terminal.ansiBrightRed",
  "terminal.ansiBrightGreen",
  "terminal.ansiBrightYellow",
  "terminal.ansiBrightBlue",
  "terminal.ansiBrightMagenta",
  "terminal.ansiBrightCyan",
  "terminal.ansiBrightWhite",
] as const;

const windowsAnsiKeys = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "purple",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightPurple",
  "brightCyan",
  "brightWhite",
] as const;

export function parseImportedThemeDocument(text: string, fallbackName = "Imported theme"): ThemeImportResult {
  if (new TextEncoder().encode(text).length > 256 * 1024) throw new Error("Theme documents cannot exceed 256 KiB.");
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false }) as unknown;
  if (errors.length > 0) throw new Error("Theme document is not valid JSON or JSONC.");
  if (!isObject(value)) throw new Error("Theme document must contain an object.");

  if (value.schema === "wheeljack-theme") {
    if (value.version !== 1) throw new Error("Unsupported wheeljack theme document.");
    return { source: "wheeljack", themes: [validateTheme(value.theme)], warnings: [] };
  }

  if (isObject(value.colors)) return parseVsCodeTheme(value, fallbackName);

  const schemes = Array.isArray(value.schemes)
    ? value.schemes.filter(isObject)
    : isWindowsTerminalScheme(value) ? [value] : [];
  if (schemes.length > 0) {
    return {
      source: "windows-terminal",
      themes: schemes.map((scheme, index) => windowsTerminalTheme(scheme, `${fallbackName}${schemes.length > 1 ? ` ${index + 1}` : ""}`)),
      warnings: [],
    };
  }

  throw new Error("Unsupported theme document. Choose a wheeljack, VS Code, or Windows Terminal theme file.");
}

export function activeVsCodeThemeName(settings: string): string | undefined {
  const errors: ParseError[] = [];
  const value = parse(settings, errors, { allowTrailingComma: true, disallowComments: false }) as unknown;
  if (errors.length > 0 || !isObject(value)) return undefined;
  return typeof value["workbench.colorTheme"] === "string" ? value["workbench.colorTheme"] : undefined;
}

function parseVsCodeTheme(value: JsonObject, fallbackName: string): ThemeImportResult {
  if (typeof value.include === "string") throw new Error("VS Code themes using “include” are not supported. Choose a self-contained theme file.");
  const colors = value.colors as JsonObject;
  const preliminaryCanvas = color(colors["editor.background"], "#000000") ?? "#000000";
  const declaredType = value.type === "light" || value.type === "dark" ? value.type : undefined;
  const variant: ThemeVariant = declaredType ?? inferVariant(preliminaryCanvas);
  const base = baseTheme(variant);
  const canvas = color(colors["editor.background"], base.seed.canvas)
    ?? color(colors["panel.background"], base.seed.canvas)
    ?? color(colors["sideBar.background"], base.seed.canvas)
    ?? base.seed.canvas;
  const surface = color(colors["panel.background"], canvas)
    ?? color(colors["sideBar.background"], canvas)
    ?? color(colors["editorWidget.background"], canvas)
    ?? base.seed.surface;
  const text = color(colors["editor.foreground"], canvas)
    ?? color(colors.foreground, canvas)
    ?? base.seed.text;
  const muted = color(colors.descriptionForeground, surface)
    ?? color(colors["sideBar.foreground"], surface)
    ?? base.seed.muted;
  const accent = color(colors.focusBorder, canvas)
    ?? color(colors["button.background"], canvas)
    ?? color(colors["activityBarBadge.background"], canvas)
    ?? base.seed.accent;
  const success = color(colors["testing.iconPassed"], canvas)
    ?? color(colors["gitDecoration.addedResourceForeground"], canvas)
    ?? base.seed.success;
  const warning = color(colors["editorWarning.foreground"], canvas) ?? base.seed.warning;
  const danger = color(colors["editorError.foreground"], canvas) ?? base.seed.danger;
  const terminalBackground = color(colors["terminal.background"], canvas) ?? canvas;
  const terminalForeground = color(colors["terminal.foreground"], terminalBackground) ?? text;
  const ansi = terminalAnsiKeys.map((key, index) => color(colors[key], terminalBackground) ?? base.terminal.ansi[index]);
  const overrides = compactColors({
    chrome: color(colors["titleBar.activeBackground"], canvas),
    sidebar: color(colors["sideBar.background"], canvas),
    surface: color(colors["panel.background"], canvas),
    paneHeader: color(colors["editorGroupHeader.tabsBackground"], canvas) ?? color(colors["tab.activeBackground"], canvas),
    composer: color(colors["input.background"], canvas),
    hover: color(colors["list.hoverBackground"], canvas),
    selected: color(colors["list.activeSelectionBackground"], canvas),
    border: color(colors["panel.border"], canvas) ?? color(colors["sideBar.border"], canvas),
    borderStrong: color(colors.focusBorder, canvas),
  });
  const missing = [
    colors["editor.background"],
    colors["editor.foreground"],
    colors["terminal.background"],
    colors["terminal.foreground"],
    ...terminalAnsiKeys.map((key) => colors[key]),
  ].some((entry) => color(entry, canvas) === undefined);
  const warnings = [
    ...(missing ? [`Some colors were missing and were filled from ${base.name}.`] : []),
    ...(("tokenColors" in value || "semanticTokenColors" in value) ? ["Syntax highlighting colors were skipped."] : []),
  ];

  return {
    source: "vscode",
    themes: [{
      id: "imported-vscode-theme",
      name: safeName(value.name, fallbackName),
      description: "Imported from VS Code",
      variant,
      isBuiltIn: false,
      basedOnId: base.id,
      seed: { canvas, surface, text, muted, accent, success, warning, danger },
      overrides,
      terminal: {
        foreground: terminalForeground,
        background: terminalBackground,
        cursor: color(colors["terminalCursor.foreground"], terminalBackground) ?? accent,
        selection: color(colors["terminal.selectionBackground"], terminalBackground) ?? blend(terminalBackground, accent, variant === "light" ? 0.2 : 0.32),
        ansi,
      },
    }],
    warnings,
  };
}

function windowsTerminalTheme(scheme: JsonObject, fallbackName: string): ThemeDefinition {
  const initialBackground = color(scheme.background, "#000000") ?? "#000000";
  const variant = inferVariant(initialBackground);
  const base = baseTheme(variant);
  const background = color(scheme.background, base.seed.canvas) ?? base.seed.canvas;
  const foreground = color(scheme.foreground, background) ?? base.seed.text;
  const ansi = windowsAnsiKeys.map((key, index) => color(scheme[key], background) ?? base.terminal.ansi[index]);
  const accent = color(scheme.blue, background) ?? base.seed.accent;
  const surface = blend(background, foreground, variant === "light" ? 0.04 : 0.08);

  return {
    id: "imported-windows-terminal-theme",
    name: safeName(scheme.name, fallbackName),
    description: "Imported from Windows Terminal",
    variant,
    isBuiltIn: false,
    basedOnId: base.id,
    seed: {
      canvas: background,
      surface,
      text: foreground,
      muted: color(scheme.brightBlack, surface) ?? base.seed.muted,
      accent,
      success: color(scheme.green, background) ?? base.seed.success,
      warning: color(scheme.yellow, background) ?? base.seed.warning,
      danger: color(scheme.red, background) ?? base.seed.danger,
    },
    overrides: {},
    terminal: {
      foreground,
      background,
      cursor: color(scheme.cursorColor, background) ?? foreground,
      selection: color(scheme.selectionBackground, background) ?? blend(background, accent, variant === "light" ? 0.2 : 0.32),
      ansi,
    },
  };
}

function isWindowsTerminalScheme(value: JsonObject): boolean {
  return typeof value.name === "string"
    && ["background", "foreground", ...windowsAnsiKeys].some((key) => typeof value[key] === "string");
}

function baseTheme(variant: ThemeVariant): ThemeDefinition {
  return builtInThemes.find((theme) => theme.id === (variant === "light" ? "mono-light" : "mono-dark"))!;
}

function inferVariant(background: string): ThemeVariant {
  return contrastRatio(background, "#FFFFFF") >= contrastRatio(background, "#000000") ? "dark" : "light";
}

function color(value: unknown, background: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!match) return undefined;
  let hex = match[1];
  if (hex.length <= 4) hex = [...hex].map((character) => character.repeat(2)).join("");
  const opaque = `#${hex.slice(0, 6).toUpperCase()}`;
  if (hex.length !== 8) return opaque;
  return blend(background, opaque, Number.parseInt(hex.slice(6), 16) / 255);
}

function blend(first: string, second: string, amount: number): string {
  const a = rgb(first);
  const b = rgb(second);
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function rgb(value: string): number[] {
  return [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function compactColors(value: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => Boolean(entry[1])));
}

function safeName(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 128) : fallback.slice(0, 128);
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
