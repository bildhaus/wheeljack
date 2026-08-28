---
title: Workspaces and panes
description: Organize projects, canvases, shells, agents, notes, and browser previews in wheeljack Work.
editUrl: https://github.com/bildhaus/wheeljack/edit/main/docs/guides/workspaces-and-panes.md
---

Work is the execution surface for a selected project. Each canvas stores a
recursive split tree, so you can arrange related shells and agents without
flattening them into a fixed tab grid.

## Projects and canvases

A project is anchored to one local folder. Its saved canvases, Plan state,
settings, and sessions use a stable project identity even when the folder must
be relinked after a move.

Use canvases for durable workspace arrangements such as implementation,
testing, or release work. Switching canvases does not terminate live sessions.
The last active canvas is remembered per project.

## Pane types

- **Shell:** the platform shell in the project or assigned task-lane directory.
- **Agent:** structured chat backed by a verified coding-agent adapter.
- **Markdown note:** editable project-adjacent notes stored in wheeljack state.
- **Checklist:** a lightweight list for temporary workspace tracking.
- **Browser preview:** a URL preview alongside the work that produced it.

Browser panes can also run a trusted repo-local lifecycle manifest for setup and
preview commands. See [Repo lifecycle manifests](/reference/repo-lifecycle/).

## Arrange panes

Use the pane toolbar, context menu, or shortcuts to:

- split the focused pane right or down;
- focus or resize the pane in any direction;
- zoom one pane and restore the prior layout;
- smart-arrange pane sizes; or
- close only the focused pane.

The command palette lists current bindings. Defaults include
`Alt+Shift+=` for split right, `Alt+Shift+-` for split down, arrow shortcuts for
focus and resize, and `Ctrl/Cmd+Shift+Enter` for pane zoom. All bindings are
customizable in **Settings → Shortcuts**.

## Session recovery

The Rust core owns PTYs, transcripts, and durable canvas state. A WebView reload
reconnects to the existing core and live sessions. A full app restart restores
the saved workspace and session history; processes that no longer exist are
shown as ended rather than recreated as if uninterrupted.

Do not use the UI layout as the only record of important shell output. Export or
commit durable project artifacts when the result must survive beyond session
history.

## Project removal

Removing a project from wheeljack removes its workspace registration, not the
project folder itself. Read the confirmation carefully before removing local
wheeljack state associated with a project.

For where that state lives and how backups work, see
[Local data and permissions](/reference/local-data-and-permissions/).
