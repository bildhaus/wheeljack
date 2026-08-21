export const shortcutDefinitions = [
  { id: "app.commandPalette", label: "Open command palette", group: "Navigation", defaultBinding: "CommandOrControl+Shift+P" },
  { id: "app.home", label: "Open Home", group: "Navigation", defaultBinding: "CommandOrControl+Shift+1" },
  { id: "app.work", label: "Open Work", group: "Navigation", defaultBinding: "CommandOrControl+Shift+2" },
  { id: "app.plan", label: "Open Plan", group: "Navigation", defaultBinding: "CommandOrControl+Shift+3" },
  { id: "app.settings", label: "Open Settings", group: "Navigation", defaultBinding: "CommandOrControl+Comma" },
  { id: "app.sidebar", label: "Toggle sidebar", group: "Navigation", defaultBinding: "CommandOrControl+Shift+B" },
  { id: "app.inbox", label: "Toggle Inbox", group: "Navigation", defaultBinding: "CommandOrControl+Shift+M" },
  { id: "app.git", label: "Toggle Git", group: "Navigation", defaultBinding: "CommandOrControl+Shift+G" },
  { id: "app.history", label: "Toggle History", group: "Navigation", defaultBinding: "CommandOrControl+Shift+H" },
  { id: "project.open", label: "Open project folder", group: "Workspace", defaultBinding: "CommandOrControl+Shift+O" },
  { id: "canvas.new", label: "New canvas", group: "Workspace", defaultBinding: "CommandOrControl+Shift+N" },
  { id: "canvas.previous", label: "Previous canvas", group: "Workspace", defaultBinding: "CommandOrControl+PageUp" },
  { id: "canvas.next", label: "Next canvas", group: "Workspace", defaultBinding: "CommandOrControl+PageDown" },
  { id: "pane.shell", label: "New shell", group: "Panes", defaultBinding: "Alt+Shift+D" },
  { id: "pane.agent", label: "New agent", group: "Panes", defaultBinding: "Alt+Shift+A" },
  { id: "pane.note", label: "New note", group: "Panes", defaultBinding: "Alt+Shift+N" },
  { id: "pane.checklist", label: "New checklist", group: "Panes", defaultBinding: "Alt+Shift+C" },
  { id: "pane.browser", label: "New browser preview", group: "Panes", defaultBinding: "Alt+Shift+B" },
  { id: "pane.splitRight", label: "Split right", group: "Panes", defaultBinding: "Alt+Shift+Equal" },
  { id: "pane.splitDown", label: "Split down", group: "Panes", defaultBinding: "Alt+Shift+Minus" },
  { id: "pane.focusLeft", label: "Focus pane left", group: "Panes", defaultBinding: "Alt+ArrowLeft" },
  { id: "pane.focusRight", label: "Focus pane right", group: "Panes", defaultBinding: "Alt+ArrowRight" },
  { id: "pane.focusUp", label: "Focus pane above", group: "Panes", defaultBinding: "Alt+ArrowUp" },
  { id: "pane.focusDown", label: "Focus pane below", group: "Panes", defaultBinding: "Alt+ArrowDown" },
  { id: "pane.resizeLeft", label: "Resize pane left", group: "Panes", defaultBinding: "Alt+Shift+ArrowLeft" },
  { id: "pane.resizeRight", label: "Resize pane right", group: "Panes", defaultBinding: "Alt+Shift+ArrowRight" },
  { id: "pane.resizeUp", label: "Resize pane up", group: "Panes", defaultBinding: "Alt+Shift+ArrowUp" },
  { id: "pane.resizeDown", label: "Resize pane down", group: "Panes", defaultBinding: "Alt+Shift+ArrowDown" },
  { id: "pane.zoom", label: "Zoom or restore pane", group: "Panes", defaultBinding: "CommandOrControl+Shift+Enter" },
  { id: "pane.equalize", label: "Smart arrange panes", group: "Panes", defaultBinding: "CommandOrControl+Shift+E" },
  { id: "pane.close", label: "Close pane", group: "Panes", defaultBinding: "CommandOrControl+Shift+W" },
  { id: "pane.save", label: "Save note", group: "Panes", defaultBinding: "CommandOrControl+S" },
  { id: "agent.focusComposer", label: "Focus agent composer", group: "Agents", defaultBinding: "CommandOrControl+Shift+L" },
  { id: "agent.send", label: "Send agent prompt", group: "Agents", defaultBinding: "Enter" },
  { id: "agent.stop", label: "Stop agent turn", group: "Agents", defaultBinding: "CommandOrControl+Escape" },
  { id: "view.zoomIn", label: "Zoom in", group: "Appearance", defaultBinding: "CommandOrControl+Equal" },
  { id: "view.zoomOut", label: "Zoom out", group: "Appearance", defaultBinding: "CommandOrControl+Minus" },
  { id: "view.zoomReset", label: "Reset zoom", group: "Appearance", defaultBinding: "CommandOrControl+0" },
] as const;

export type ShortcutAction = typeof shortcutDefinitions[number]["id"];
export type ShortcutGroup = typeof shortcutDefinitions[number]["group"];
export type ShortcutBindings = Record<ShortcutAction, string>;

export interface ShortcutKeyboardEvent {
  altKey: boolean;
  code: string;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

export function defaultShortcutBindingsForPlatform(
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): ShortcutBindings {
  const bindings = Object.fromEntries(
    shortcutDefinitions.map(({ id, defaultBinding }) => [id, defaultBinding]),
  ) as ShortcutBindings;
  if (/mac/i.test(platform)) bindings["app.commandPalette"] = "CommandOrControl+K";
  return bindings;
}

export const defaultShortcutBindings = defaultShortcutBindingsForPlatform();

const modifierAliases: Record<string, "CommandOrControl" | "Alt" | "Shift"> = {
  alt: "Alt",
  cmd: "CommandOrControl",
  command: "CommandOrControl",
  commandorcontrol: "CommandOrControl",
  control: "CommandOrControl",
  ctrl: "CommandOrControl",
  meta: "CommandOrControl",
  mod: "CommandOrControl",
  option: "Alt",
  shift: "Shift",
};

const keyAliases: Record<string, string> = {
  backquote: "Backquote",
  backspace: "Backspace",
  comma: "Comma",
  del: "Delete",
  delete: "Delete",
  down: "ArrowDown",
  end: "End",
  enter: "Enter",
  equal: "Equal",
  esc: "Escape",
  escape: "Escape",
  home: "Home",
  left: "ArrowLeft",
  minus: "Minus",
  pagedown: "PageDown",
  pageup: "PageUp",
  period: "Period",
  return: "Enter",
  right: "ArrowRight",
  slash: "Slash",
  space: "Space",
  tab: "Tab",
  up: "ArrowUp",
};

export function normalizeShortcutBinding(value: string): string | undefined {
  if (!value.trim()) return "";
  const modifiers = new Set<string>();
  let key: string | undefined;
  for (const rawToken of value.split("+").map((token) => token.trim()).filter(Boolean)) {
    const token = rawToken.replaceAll(/\s/g, "").toLowerCase();
    const modifier = modifierAliases[token];
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }
    if (key) return undefined;
    key = normalizeShortcutKey(rawToken);
    if (!key) return undefined;
  }
  if (!key) return undefined;
  return ["CommandOrControl", "Alt", "Shift"].filter((modifier) => modifiers.has(modifier)).concat(key).join("+");
}

function normalizeShortcutKey(rawKey: string): string | undefined {
  const compact = rawKey.replaceAll(/\s/g, "").toLowerCase();
  if (keyAliases[compact]) return keyAliases[compact];
  if (/^[a-z0-9]$/.test(compact)) return compact.toUpperCase();
  if (/^f(?:[1-9]|1\d|2[0-4])$/.test(compact)) return compact.toUpperCase();
  if (/^arrow(?:left|right|up|down)$/.test(compact)) {
    return `Arrow${compact.slice(5, 6).toUpperCase()}${compact.slice(6)}`;
  }
  return undefined;
}

export function bindingFromKeyboardEvent(event: ShortcutKeyboardEvent): string | undefined {
  if (["Alt", "AltGraph", "Control", "Meta", "Shift"].includes(event.key)) return undefined;
  const key = keyboardEventKey(event);
  if (!key) return undefined;
  return [
    event.ctrlKey || event.metaKey ? "CommandOrControl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    key,
  ].filter(Boolean).join("+");
}

function keyboardEventKey(event: ShortcutKeyboardEvent): string | undefined {
  const codeKeys: Record<string, string> = {
    Backquote: "Backquote",
    Comma: "Comma",
    Equal: "Equal",
    Minus: "Minus",
    NumpadAdd: "Equal",
    NumpadSubtract: "Minus",
    Period: "Period",
    Slash: "Slash",
  };
  if (codeKeys[event.code]) return codeKeys[event.code];
  if (event.key.length === 1 && /^[a-z0-9]$/i.test(event.key)) return event.key.toUpperCase();
  return normalizeShortcutKey(event.key);
}

export function matchesShortcut(event: ShortcutKeyboardEvent, binding: string): boolean {
  return Boolean(binding) && bindingFromKeyboardEvent(event) === normalizeShortcutBinding(binding);
}

export function shortcutActionForEvent(bindings: ShortcutBindings, event: ShortcutKeyboardEvent): ShortcutAction | undefined {
  return shortcutDefinitions.find(({ id }) => matchesShortcut(event, bindings[id]))?.id;
}

export function shortcutBindingsFromSettings(settings: Record<string, unknown>, platform?: string): ShortcutBindings {
  const stored = settings.shortcuts && typeof settings.shortcuts === "object" && !Array.isArray(settings.shortcuts)
    ? settings.shortcuts as Record<string, unknown>
    : {};
  const bindings = defaultShortcutBindingsForPlatform(platform);
  const customized = new Set<ShortcutAction>();
  for (const { id } of shortcutDefinitions) {
    if (!Object.prototype.hasOwnProperty.call(stored, id) || typeof stored[id] !== "string") continue;
    const normalized = normalizeShortcutBinding(stored[id]);
    if (normalized === undefined) continue;
    bindings[id] = normalized;
    customized.add(id);
  }
  const owners = new Map<string, ShortcutAction>();
  for (const { id } of [...shortcutDefinitions].sort((left, right) => Number(customized.has(right.id)) - Number(customized.has(left.id)))) {
    const binding = bindings[id];
    if (!binding) continue;
    if (owners.has(binding)) bindings[id] = "";
    else owners.set(binding, id);
  }
  return bindings;
}

export function shortcutConflict(bindings: ShortcutBindings, action: ShortcutAction, binding: string) {
  if (!binding) return undefined;
  const normalized = normalizeShortcutBinding(binding);
  return shortcutDefinitions.find(({ id }) => id !== action && normalizeShortcutBinding(bindings[id]) === normalized);
}

export function isBindableShortcut(binding: string): boolean {
  const parts = binding.split("+");
  const key = parts.at(-1) ?? "";
  return parts.includes("CommandOrControl") || parts.includes("Alt") || /^F(?:[1-9]|1\d|2[0-4])$/.test(key);
}

export function formatShortcut(binding: string, platform = typeof navigator === "undefined" ? "" : navigator.platform): string {
  if (!binding) return "Unassigned";
  const mac = /mac/i.test(platform);
  const labels: Record<string, string> = mac
    ? { CommandOrControl: "⌘", Alt: "⌥", Shift: "⇧" }
    : { CommandOrControl: "Ctrl", Alt: "Alt", Shift: "Shift" };
  const keyLabels: Record<string, string> = {
    ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑",
    Backquote: "`", Comma: ",", Equal: "+", Minus: "−", PageDown: "PgDn", PageUp: "PgUp", Period: ".", Slash: "/", Space: "Space",
  };
  const parts = binding.split("+").map((part) => labels[part] ?? keyLabels[part] ?? part);
  return parts.join(mac ? "" : "+");
}
