import { describe, expect, test } from "vitest";
import {
  bindingFromKeyboardEvent,
  defaultShortcutBindings,
  defaultShortcutBindingsForPlatform,
  formatShortcut,
  isBindableShortcut,
  matchesShortcut,
  normalizeShortcutBinding,
  shortcutBindingsFromSettings,
  shortcutConflict,
} from "./shortcuts";

const event = (overrides: Partial<KeyboardEvent> = {}) => ({
  altKey: false,
  code: "KeyK",
  ctrlKey: false,
  key: "k",
  metaKey: false,
  shiftKey: false,
  ...overrides,
}) as KeyboardEvent;

describe("keyboard shortcuts", () => {
  test("uses Command+K on macOS and Ctrl+Shift+P on Windows", () => {
    expect(defaultShortcutBindingsForPlatform("macos")["app.commandPalette"]).toBe("CommandOrControl+K");
    expect(defaultShortcutBindingsForPlatform("windows")["app.commandPalette"]).toBe("CommandOrControl+Shift+P");
    expect(shortcutBindingsFromSettings({}, "macos")["app.commandPalette"]).toBe("CommandOrControl+K");
    expect(shortcutBindingsFromSettings({}, "windows")["app.commandPalette"]).toBe("CommandOrControl+Shift+P");
  });

  test("normalizes cross-platform bindings and physical punctuation keys", () => {
    expect(normalizeShortcutBinding("ctrl + shift + k")).toBe("CommandOrControl+Shift+K");
    expect(bindingFromKeyboardEvent(event({ altKey: true, code: "Equal", key: "+", shiftKey: true }))).toBe("Alt+Shift+Equal");
    expect(matchesShortcut(event({ code: "Enter", ctrlKey: true, key: "Enter" }), "CommandOrControl+Enter")).toBe(true);
    expect(matchesShortcut(event({ code: "Enter", key: "Enter", metaKey: true }), "CommandOrControl+Enter")).toBe(true);
  });

  test("loads persisted overrides, disabled bindings, and resolves collisions in favor of overrides", () => {
    const bindings = shortcutBindingsFromSettings({
      shortcuts: {
        "app.home": "ctrl + shift + 9",
        "app.work": "",
        "app.plan": "ctrl + shift + 9",
      },
    });
    expect(bindings["app.home"]).toBe("CommandOrControl+Shift+9");
    expect(bindings["app.work"]).toBe("");
    expect(bindings["app.plan"]).toBe("");
  });

  test("rejects typing-only bindings and reports conflicts", () => {
    expect(isBindableShortcut("K")).toBe(false);
    expect(isBindableShortcut("Shift+K")).toBe(false);
    expect(isBindableShortcut("Alt+K")).toBe(true);
    expect(isBindableShortcut("F8")).toBe(true);
    expect(shortcutConflict(defaultShortcutBindings, "app.work", defaultShortcutBindings["app.home"])?.id).toBe("app.home");
  });

  test("formats Windows and macOS labels", () => {
    expect(formatShortcut("CommandOrControl+Shift+Enter", "Win32")).toBe("Ctrl+Shift+Enter");
    expect(formatShortcut("CommandOrControl+Shift+Enter", "MacIntel")).toBe("⌘⇧Enter");
    expect(formatShortcut("", "Win32")).toBe("Unassigned");
  });
});
