---
title: Your first project
description: Open a project folder, understand the Home, Work, and Plan surfaces, and start your first shell in wheeljack.
editUrl: https://github.com/bildhaus/wheeljack/edit/main/docs/getting-started/first-project.md
---

wheeljack groups terminals, coding agents, Plan state, and recovery around a
project folder. The folder remains the source of truth for your code; wheeljack
stores its own workspace state separately in local app data.

## Open a project

1. Launch wheeljack.
2. On **Home**, choose **Open folder**.
3. Select the project directory you want wheeljack to manage.
4. Choose **Work** for the project.

Recent projects appear on Home. If a folder moves, wheeljack marks it missing
instead of silently attaching its state to a different path. Relink it to the
same project from the project controls.

## Understand the main surfaces

- **Home** summarizes projects, live sessions, installed-agent readiness, and
  work that needs attention.
- **Work** contains canvases and panes. A pane can be a shell, structured agent,
  Markdown note, checklist, or browser preview.
- **Run** is the low-interaction operational view for autonomous execution,
  reconciliation, and the exceptions that actually need you.
- **Plan** contains the durable task list and status projection; **Spec** keeps
  project documents beside it.
- **Bots** stores reusable specialist profiles that can be launched into Work.
- **Settings** controls appearance, workspace density, shortcuts, coding-agent
  profiles, autonomy, application data, and updates.

## Start a shell

In Work, create a shell from the empty workspace action, pane menu, or command
palette. The shell starts in the project folder and uses the platform's default
shell. You can split it right or down, resize it, zoom it temporarily, and close
it independently.

wheeljack keeps the pane layout and terminal session authority in its Rust core.
Reloading the WebView reconnects to live PTYs instead of starting duplicates.

## Add another canvas

A project can contain multiple named canvases. Use a new canvas when you want a
separate layout or working context without opening a second copy of the project.
Canvases share the same project and Plan documents but keep their own panes and
layout.

## Continue with an agent

Verify at least one supported CLI in Settings, then create an agent pane from
Work. See [Connect coding agents](/getting-started/connect-agents/) for the full
setup and trust model.
