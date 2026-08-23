---
title: Settings and shortcuts
description: Configure wheeljack appearance, workspace behavior, keyboard shortcuts, coding agents, autonomy, storage, and updates.
editUrl: https://github.com/bildhaus/wheeljack/edit/main/docs/guides/settings-and-shortcuts.md
---

Settings are stored locally and apply across wheeljack unless a control is
explicitly project-specific.

## Settings areas

- **Appearance:** built-in or imported themes, typography, UI scale, and terminal colors.
- **Workspace:** sidebar and utility presentation, visible workspace elements,
  and layout density.
- **Shortcuts:** searchable, customizable bindings with conflict detection.
- **Agents:** adapter detection, verification, launch defaults, models, access,
  and autonomy policies.
- **Application:** local storage, backup export, update checks, and reset controls.

Imported VS Code themes are read and converted into wheeljack's theme model. A
theme import does not give wheeljack control over VS Code or its extensions.

## Essential default shortcuts

`Ctrl/Cmd` means Control on Windows and Command on macOS.

| Action | Default |
| --- | --- |
| Command palette | `Ctrl+Shift+P` on Windows; `Cmd+K` on macOS |
| Home / Work / Plan | `Ctrl/Cmd+Shift+1` / `2` / `3` |
| Settings | `Ctrl/Cmd+,` |
| Open project | `Ctrl/Cmd+Shift+O` |
| New shell / agent | `Alt+Shift+D` / `Alt+Shift+A` |
| Focus adjacent pane | `Alt+Arrow key` |
| Resize adjacent pane | `Alt+Shift+Arrow key` |
| Stop agent turn | `Ctrl/Cmd+Escape` |

The command palette always displays the active binding. Shortcut recording
rejects conflicts instead of assigning one key sequence to two actions.

## Back up local state

Use the Application storage controls to export a consistent SQLite backup. The
core captures live write-ahead-log state and checks backup integrity before
reporting success.

Store the backup outside wheeljack's live app-data directory. Existing files are
not overwritten.

## Reset settings

:::caution
Reset restores appearance, workspace behavior, shortcuts, coding-agent profiles,
and autonomy policies to defaults and removes custom themes. Export anything you
need before confirming.
:::

Resetting settings is different from removing projects or deleting the local
database. Read the confirmation shown for the specific action.
