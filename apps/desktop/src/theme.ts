export type ThemeVariant = "dark" | "light";

export interface ThemeSeed {
  canvas: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
}

export interface TerminalPalette {
  foreground: string;
  background: string;
  cursor: string;
  selection: string;
  ansi: string[];
}

export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  variant: ThemeVariant;
  isBuiltIn: boolean;
  basedOnId: string | null;
  seed: ThemeSeed;
  overrides: Record<string, string>;
  terminal: TerminalPalette;
}

export function themeAssignment(mode: "fixed" | "system", systemUsesLight: boolean, theme: Pick<ThemeDefinition, "id" | "variant">) {
  const legacyTheme: "paper" | "graphite" = theme.variant === "light" ? "paper" : "graphite";
  if (mode === "fixed") return { fixedThemeId: theme.id, theme: legacyTheme };
  return {
    [theme.variant === "light" ? "systemLightThemeId" : "systemDarkThemeId"]: theme.id,
    ...(systemUsesLight === (theme.variant === "light") ? { theme: legacyTheme } : {}),
  };
}

export function replaceThemeAssignments(
  assignments: { fixedThemeId: string; systemLightThemeId: string; systemDarkThemeId: string },
  removedThemeId: string,
  replacementThemeId: string,
) {
  return {
    fixedThemeId: assignments.fixedThemeId === removedThemeId ? replacementThemeId : assignments.fixedThemeId,
    systemLightThemeId: assignments.systemLightThemeId === removedThemeId ? replacementThemeId : assignments.systemLightThemeId,
    systemDarkThemeId: assignments.systemDarkThemeId === removedThemeId ? replacementThemeId : assignments.systemDarkThemeId,
  };
}

const darkAnsi = ["#111111", "#DC5962", "#73C991", "#D7BA7D", "#569CD6", "#C586C0", "#4EC9B0", "#D4D4D4", "#666666", "#F07178", "#9CDCFE", "#E5C07B", "#61AFEF", "#D16D9E", "#56B6C2", "#FFFFFF"];
const lightAnsi = ["#202020", "#A31515", "#008000", "#795E26", "#0451A5", "#AF00DB", "#008080", "#D4D4D4", "#666666", "#CD3131", "#14CE14", "#B5A000", "#2472C8", "#C586C0", "#00A0A0", "#FFFFFF"];

function builtIn(
  id: string,
  name: string,
  description: string,
  variant: ThemeVariant,
  seed: string[],
  ansi: string[],
  overrides: Record<string, string> = {},
): ThemeDefinition {
  const [canvas, surface, text, muted, accent, success, warning, danger] = seed;
  return {
    id, name, description, variant, isBuiltIn: true, basedOnId: null,
    seed: { canvas, surface, text, muted, accent, success, warning, danger },
    overrides,
    terminal: {
      foreground: text,
      background: canvas,
      cursor: accent,
      selection: mix(canvas, accent, variant === "light" ? 0.2 : 0.32),
      ansi,
    },
  };
}

export const builtInThemes: ThemeDefinition[] = [
  builtIn("mono-dark", "Graphite", "monochrome graphite", "dark", ["#0C0C0C", "#161616", "#F4F4F4", "#9B9B9B", "#F4F4F4", "#79B99A", "#D2B36A", "#D46C72"], darkAnsi, { chrome: "#0C0C0C", sidebar: "#161616", paneHeader: "#161616", composer: "#161616" }),
  builtIn("mono-light", "Paper", "warm neutral", "light", ["#F3F2EE", "#FBFAF7", "#1B1D20", "#6B6F75", "#1B1D20", "#34785A", "#8B691F", "#B9474F"], lightAnsi, { chrome: "#E7E7E3", sidebar: "#FBFAF7", paneHeader: "#FBFAF7", composer: "#FBFAF7" }),
  builtIn("dracula", "WJ-Dracula", "electric violet", "dark", ["#17131F", "#2A203A", "#FFF7FF", "#C8B6DB", "#D69CFF", "#50FA7B", "#FFE66D", "#FF4D6D"], ["#100C17", "#FF4D6D", "#50FA7B", "#FFE66D", "#7AA2FF", "#FF79E9", "#6EF6FF", "#F8F1FF", "#6A5A7B", "#FF758F", "#7CFF9A", "#FFF08A", "#9CB8FF", "#FF9CF0", "#9AFAFF", "#FFFFFF"], { chrome: "#100C17", sidebar: "#24192F", paneHeader: "#24192F", composer: "#24192F" }),
  builtIn("nord", "WJ-Nord", "electric arctic", "dark", ["#101A2C", "#1B2A41", "#F2FAFF", "#B3CBE0", "#5DE4FF", "#7EF29A", "#FFD166", "#FF6B7A"], ["#0A1220", "#FF6B7A", "#7EF29A", "#FFD166", "#4CB7FF", "#C792EA", "#5DE4FF", "#DCEFFF", "#58708F", "#FF8793", "#9CFFB2", "#FFE08F", "#75C8FF", "#DEA8FF", "#87EEFF", "#FFFFFF"], { chrome: "#0A1220", sidebar: "#17253A", paneHeader: "#17253A", composer: "#17253A" }),
  builtIn("solarized-dark", "WJ-Solarized Dark", "electric teal", "dark", ["#001F26", "#073E47", "#FFF3D6", "#B7C9C2", "#00D8C8", "#79E000", "#FFB800", "#FF5A4F"], ["#00171D", "#FF5A4F", "#79E000", "#FFB800", "#00A8FF", "#D85CFF", "#00D8C8", "#E8F6F3", "#3E6E70", "#FF7A66", "#9AF03A", "#FFD04A", "#4FC3FF", "#E98CFF", "#55F1E2", "#FFF8E7"], { chrome: "#00171D", sidebar: "#05343D", paneHeader: "#05343D", composer: "#05343D" }),
  builtIn("tokyo-night", "WJ-Tokyo Night", "electric indigo", "dark", ["#111424", "#20264A", "#F1F4FF", "#B5C2F4", "#8BA7FF", "#A6F07B", "#FFC15A", "#FF5C8A"], ["#0B0E1A", "#FF5C8A", "#A6F07B", "#FFC15A", "#8BA7FF", "#D28BFF", "#63E6FF", "#E8EDFF", "#58658A", "#FF7CA3", "#BEFF96", "#FFD580", "#A7BAFF", "#E4A8FF", "#8CF0FF", "#FFFFFF"], { chrome: "#0B0E1A", sidebar: "#1A2140", paneHeader: "#1A2140", composer: "#1A2140" }),
];

export function compileTheme(theme: ThemeDefinition): Record<string, string> {
  const seed = theme.seed;
  const light = theme.variant === "light";
  const colors: Record<string, string> = {
    canvas: seed.canvas,
    chrome: mix(seed.canvas, seed.surface, 0.2),
    sidebar: mix(seed.canvas, seed.surface, 0.35),
    surface: seed.surface,
    raised: mix(seed.surface, seed.text, light ? 0.025 : 0.04),
    hover: mix(seed.surface, seed.text, light ? 0.06 : 0.08),
    selected: mix(seed.surface, seed.accent, light ? 0.12 : 0.18),
    divider: mix(seed.surface, seed.text, light ? 0.1 : 0.09),
    border: mix(seed.surface, seed.text, light ? 0.16 : 0.14),
    borderStrong: mix(seed.surface, seed.text, light ? 0.28 : 0.26),
    text: seed.text,
    muted: seed.muted,
    subtle: mix(seed.muted, seed.canvas, 0.2),
    accent: seed.accent,
    accentHover: mix(seed.accent, light ? "#000000" : "#FFFFFF", 0.1),
    accentPressed: mix(seed.accent, seed.canvas, 0.14),
    accentSoft: mix(seed.surface, seed.accent, light ? 0.12 : 0.18),
    accentForeground: contrastColor(seed.accent),
    success: seed.success,
    warning: seed.warning,
    danger: seed.danger,
    paneHeader: mix(seed.canvas, seed.surface, 0.55),
    composer: mix(seed.canvas, seed.surface, 0.42),
    brandInk: seed.text,
    terminalBackground: theme.terminal.background,
    terminalForeground: theme.terminal.foreground,
    cursor: theme.terminal.cursor,
    selection: theme.terminal.selection,
  };
  return { ...colors, ...theme.overrides };
}

export function themeCss(theme: ThemeDefinition): Record<string, string> {
  const color = compileTheme(theme);
  const variables: Record<string, string> = {
    "--background": color.canvas,
    "--foreground": color.text,
    "--card": color.surface,
    "--card-foreground": color.text,
    "--popover": color.raised,
    "--popover-foreground": color.text,
    "--primary": color.accent,
    "--primary-foreground": color.accentForeground,
    "--secondary": color.raised,
    "--secondary-foreground": color.text,
    "--muted": color.hover,
    "--muted-foreground": color.muted,
    "--accent": color.selected,
    "--accent-foreground": color.text,
    "--destructive": color.danger,
    "--border": color.border,
    "--input": color.borderStrong,
    "--ring": color.subtle,
    "--sidebar": color.sidebar,
    "--sidebar-foreground": color.text,
    "--sidebar-primary": color.accent,
    "--sidebar-primary-foreground": color.accentForeground,
    "--sidebar-accent": color.selected,
    "--sidebar-accent-foreground": color.text,
    "--sidebar-border": color.border,
    "--sidebar-ring": color.subtle,
    "--terminal": color.terminalBackground,
    "--terminal-foreground": color.terminalForeground,
    "--terminal-cursor": color.cursor,
    "--terminal-selection": color.selection,
    "--success": color.success,
    "--warning": color.warning,
    "--wj-chrome": color.chrome,
    "--wj-sidebar": color.sidebar,
    "--wj-surface": color.surface,
    "--wj-raised": color.raised,
    "--wj-hover": color.hover,
    "--wj-selected": color.selected,
    "--wj-divider": color.divider,
    "--wj-border-strong": color.borderStrong,
    "--wj-subtle": color.subtle,
    "--wj-sticker-accent": color.accent.toLowerCase() === color.text.toLowerCase() ? color.muted : color.accent,
    "--wj-pane-header": color.paneHeader,
    "--wj-composer": color.composer,
  };
  theme.terminal.ansi.forEach((value, index) => { variables[`--terminal-ansi-${index}`] = value; });
  return variables;
}

export function contrastRatio(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (light + 0.05) / (dark + 0.05);
}

export function serializeTheme(theme: ThemeDefinition): string {
  return JSON.stringify({ schema: "wheeljack-theme", version: 1, theme }, null, 2);
}

export function parseTheme(json: string): ThemeDefinition {
  if (new TextEncoder().encode(json).length > 256 * 1024) throw new Error("Theme documents cannot exceed 256 KiB.");
  const document = JSON.parse(json) as { schema?: unknown; version?: unknown; theme?: unknown };
  if (document.schema !== "wheeljack-theme" || document.version !== 1) throw new Error("Unsupported wheeljack theme document.");
  return validateTheme(document.theme);
}

export function validateTheme(value: unknown): ThemeDefinition {
  if (!value || typeof value !== "object") throw new Error("Theme document is incomplete.");
  const theme = value as ThemeDefinition;
  if (!safeText(theme.id) || !safeText(theme.name) || !["dark", "light"].includes(theme.variant)) throw new Error("Theme identity is invalid.");
  const seed = theme.seed as unknown as Record<string, unknown>;
  for (const key of ["canvas", "surface", "text", "muted", "accent", "success", "warning", "danger"]) requireColor(seed?.[key]);
  if (!theme.terminal || !Array.isArray(theme.terminal.ansi) || theme.terminal.ansi.length !== 16) throw new Error("Theme terminal palette must contain 16 ANSI colors.");
  [theme.terminal.foreground, theme.terminal.background, theme.terminal.cursor, theme.terminal.selection, ...theme.terminal.ansi].forEach(requireColor);
  const overrides = theme.overrides && typeof theme.overrides === "object" ? theme.overrides : {};
  Object.values(overrides).forEach(requireColor);
  return { ...theme, isBuiltIn: false, overrides };
}

function requireColor(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(value)) throw new Error("Theme colors must use #RRGGBB.");
}

function safeText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128;
}

function mix(first: string, second: string, amount: number): string {
  const a = rgb(first);
  const b = rgb(second);
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function contrastColor(value: string): string {
  return contrastRatio(value, "#000000") >= contrastRatio(value, "#FFFFFF") ? "#000000" : "#FFFFFF";
}

function luminance(value: string): number {
  const channels = rgb(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function rgb(value: string): number[] {
  requireColor(value);
  return [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}
