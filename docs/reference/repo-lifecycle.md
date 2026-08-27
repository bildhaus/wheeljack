---
title: Repo lifecycle manifests
description: Define reviewable setup and local-preview commands for a wheeljack project.
editUrl: https://github.com/bildhaus/wheeljack/edit/main/docs/reference/repo-lifecycle.md
---

A project may define `.wheeljack/lifecycle.json` to make its setup and local
preview workflow available in Browser Preview panes. Commands run directly as
argument arrays; wheeljack does not pass them through a shell.

```json
{
  "version": 1,
  "setup": {
    "command": ["pnpm", "install"],
    "windows": ["pnpm.cmd", "install"],
    "timeoutSeconds": 900
  },
  "preview": {
    "command": ["pnpm", "dev", "--", "--host", "127.0.0.1", "--port", "{port}"],
    "windows": ["pnpm.cmd", "dev", "--", "--host", "127.0.0.1", "--port", "{port}"],
    "url": "http://127.0.0.1:{port}"
  }
}
```

Each task accepts a cross-platform `command` plus optional `windows`, `macos`,
and `linux` overrides. It may also define a project-relative `cwd`, explicit
environment variables, a timeout from 1 to 3600 seconds, and a preview `url`.
The `{port}` token asks wheeljack to reserve a localhost port and substitute it
in command arguments and the URL.

## Trust and process ownership

The Browser pane displays the parsed commands and the manifest hash before the
first run. Trust applies only to that exact hash; editing the file requires a
new review. Working directories cannot escape the project root.

The Rust core owns the child process tree, streams stdout and stderr into a
bounded local log, records run state in SQLite, and terminates active lifecycle
processes during shutdown. Runs that were active during an unclean stop are
marked interrupted on the next launch rather than presented as live.

Setup and preview are deliberately the only lifecycle kinds. This contract is
not a general automation runner, remote execution service, or package-manager
replacement.
