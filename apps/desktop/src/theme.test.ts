import { builtInThemes, compileTheme, contrastRatio, parseTheme, replaceThemeAssignments, serializeTheme, themeAssignment, themeCss } from "./theme";
import { activeVsCodeThemeName, parseImportedThemeDocument } from "./themeImport";

test("round-trips a portable theme and compiles terminal colors", () => {
  const imported = parseTheme(serializeTheme(builtInThemes[2]));
  const detected = parseImportedThemeDocument(serializeTheme(builtInThemes[2]));
  expect(imported.isBuiltIn).toBe(false);
  expect(detected.source).toBe("wheeljack");
  expect(detected.themes[0].name).toBe("WJ-Dracula");
  expect(themeCss(imported)["--terminal-ansi-15"]).toBe("#FFFFFF");
  expect(contrastRatio("#000000", "#FFFFFF")).toBe(21);
});

test("assigns themes without leaving system appearance mode", () => {
  expect(themeAssignment("fixed", false, { id: "paper", variant: "light" })).toEqual({ fixedThemeId: "paper", theme: "paper" });
  expect(themeAssignment("system", true, { id: "paper", variant: "light" })).toEqual({ systemLightThemeId: "paper", theme: "paper" });
  expect(themeAssignment("system", true, { id: "graphite", variant: "dark" })).toEqual({ systemDarkThemeId: "graphite" });
});

test("replaces every assignment when deleting a custom theme", () => {
  expect(replaceThemeAssignments({
    fixedThemeId: "imported",
    systemLightThemeId: "paper",
    systemDarkThemeId: "imported",
  }, "imported", "graphite")).toEqual({
    fixedThemeId: "graphite",
    systemLightThemeId: "paper",
    systemDarkThemeId: "graphite",
  });
});

test("keeps Graphite and Paper readable and exposes semantic surface tokens", () => {
  for (const id of ["mono-dark", "mono-light"]) {
    const theme = builtInThemes.find((candidate) => candidate.id === id)!;
    expect(contrastRatio(theme.seed.text, theme.seed.canvas)).toBeGreaterThanOrEqual(7);
    expect(themeCss(theme)).toMatchObject({
      "--wj-surface": expect.any(String),
      "--wj-raised": expect.any(String),
      "--wj-divider": expect.any(String),
      "--wj-pane-header": expect.any(String),
    });
  }
});

test("keeps Graphite structural colors monochrome", () => {
  const graphite = builtInThemes.find((theme) => theme.id === "mono-dark")!;
  const { canvas, surface, text, muted, accent } = graphite.seed;
  expect({ canvas, surface, text, muted, accent }).toEqual({
    canvas: "#0C0C0C",
    surface: "#161616",
    text: "#F4F4F4",
    muted: "#9B9B9B",
    accent: "#F4F4F4",
  });
  expect(themeCss(graphite)["--wj-sticker-accent"]).toBe("#9B9B9B");
  expect(themeCss(graphite)["--ring"]).toBe("#7E7E7E");
  expect(themeCss(builtInThemes.find((theme) => theme.id === "dracula")!)["--wj-sticker-accent"]).toBe("#D69CFF");
});

test("keeps every built-in readable and pins its app surfaces", () => {
  const expected = {
    "mono-dark": ["#0C0C0C", "#161616"],
    "mono-light": ["#E7E7E3", "#FBFAF7"],
    dracula: ["#100C17", "#24192F"],
    nord: ["#0A1220", "#17253A"],
    "solarized-dark": ["#00171D", "#05343D"],
    "tokyo-night": ["#0B0E1A", "#1A2140"],
  } as const;
  for (const theme of builtInThemes) {
    const palette = compileTheme(theme);
    expect(contrastRatio(theme.seed.text, theme.seed.canvas)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(theme.seed.muted, theme.seed.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.accentForeground, theme.seed.accent)).toBeGreaterThanOrEqual(4.5);
    expect([palette.chrome, palette.sidebar]).toEqual(expected[theme.id as keyof typeof expected]);
    expect(palette.paneHeader).toBe(expected[theme.id as keyof typeof expected][1]);
    expect(palette.composer).toBe(expected[theme.id as keyof typeof expected][1]);
    expect(theme.terminal.ansi).toHaveLength(16);
  }
});

test("imports VS Code JSONC and reports faithful fallbacks", () => {
  const result = parseImportedThemeDocument(`{
    // VS Code themes commonly use comments and trailing commas.
    "name": "Ocean Test",
    "type": "dark",
    "colors": {
      "editor.background": "#123",
      "editor.foreground": "#F0F0F0",
      "descriptionForeground": "#FFFFFF80",
      "button.background": "#369",
      "terminal.ansiRed": "#F00",
    },
    "tokenColors": []
  }`);
  const theme = result.themes[0];
  expect(result.source).toBe("vscode");
  expect(theme.name).toBe("Ocean Test");
  expect(theme.seed.canvas).toBe("#112233");
  expect(theme.seed.accent).toBe("#336699");
  expect(theme.terminal.ansi[1]).toBe("#FF0000");
  expect(result.warnings).toEqual([
    "Some colors were missing and were filled from Graphite.",
    "Syntax highlighting colors were skipped.",
  ]);
});

test("rejects inherited VS Code themes", () => {
  expect(() => parseImportedThemeDocument(`{
    "name": "Child",
    "include": "./base.json",
    "colors": {}
  }`)).toThrow("self-contained theme");
});

test("reads the active theme from VS Code JSONC settings", () => {
  expect(activeVsCodeThemeName(`{
    // Settings allow comments and trailing commas.
    "workbench.colorTheme": "GitHub Dark Default",
  }`)).toBe("GitHub Dark Default");
  expect(activeVsCodeThemeName("{}")).toBeUndefined();
});

test("imports standalone and bundled Windows Terminal schemes", () => {
  const scheme = {
    name: "Campbell Test",
    background: "#0C0C0C",
    foreground: "#CCCCCC",
    black: "#0C0C0C",
    red: "#C50F1F",
    green: "#13A10E",
    yellow: "#C19C00",
    blue: "#0037DA",
    purple: "#881798",
    cyan: "#3A96DD",
    white: "#CCCCCC",
    brightBlack: "#767676",
    brightRed: "#E74856",
    brightGreen: "#16C60C",
    brightYellow: "#F9F1A5",
    brightBlue: "#3B78FF",
    brightPurple: "#B4009E",
    brightCyan: "#61D6D6",
    brightWhite: "#F2F2F2",
  };
  const standalone = parseImportedThemeDocument(JSON.stringify(scheme));
  expect(standalone.source).toBe("windows-terminal");
  expect(standalone.themes[0].seed.accent).toBe("#0037DA");
  expect(standalone.themes[0].terminal.ansi).toEqual([
    "#0C0C0C", "#C50F1F", "#13A10E", "#C19C00", "#0037DA", "#881798", "#3A96DD", "#CCCCCC",
    "#767676", "#E74856", "#16C60C", "#F9F1A5", "#3B78FF", "#B4009E", "#61D6D6", "#F2F2F2",
  ]);

  const bundled = parseImportedThemeDocument(JSON.stringify({ schemes: [scheme, { ...scheme, name: "Second" }] }));
  expect(bundled.themes.map((theme) => theme.name)).toEqual(["Campbell Test", "Second"]);
});

test("rejects oversized and unrecognized imported documents", () => {
  expect(() => parseImportedThemeDocument(`{"value":"${"x".repeat(256 * 1024)}"}`)).toThrow("256 KiB");
  expect(() => parseImportedThemeDocument("{}")).toThrow("Unsupported theme document");
});
