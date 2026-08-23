---
title: wheeljack documentation
description: Install, configure, and use wheeljack, the local-first desktop workspace for coding agents.
editUrl: https://github.com/bildhaus/wheeljack/edit/main/docs/index.md
template: splash
hero:
  tagline: Run terminals, coding agents, plans, and review evidence in one local-first desktop workspace.
  actions:
    - text: Install wheeljack
      link: /getting-started/installation/
      icon: right-arrow
      variant: primary
    - text: Open your first project
      link: /getting-started/first-project/
      icon: open-book
      variant: minimal
---

wheeljack is a desktop terminal multiplexer for Windows and macOS. It combines
recursive terminal splits, structured coding-agent sessions, project planning,
isolated task lanes, reusable Bots, and review evidence without moving project
or session state into a hosted account.

- **Start a workspace.** Install wheeljack, open a project folder, and start a
  shell or coding agent in [a few focused steps](/getting-started/first-project/).
- **Connect your agents.** Use Claude Code, Codex CLI, OpenCode, Pi, or a plain
  shell. Existing CLI authentication stays outside wheeljack.
- **Plan and review.** Turn project intent into task contracts, isolated Git
  lanes, verification, and inspectable review evidence.
- **Stay local-first.** Projects, layouts, preferences, transcripts, and Plan
  state remain in local SQLite storage on your machine.

![wheeljack workspace with split terminals, structured agents, Plan tasks, and review evidence](./assets/wheeljack-workspace.png)

## Choose a path

- **New to wheeljack:** [install the app](/getting-started/installation/), then
  [open your first project](/getting-started/first-project/).
- **Bringing a coding-agent CLI:** [connect and verify an agent](/getting-started/connect-agents/).
- **Running coordinated work:** learn the [Plan and review workflow](/guides/plan-and-review/).
- **Evaluating the trust boundary:** read [local data and permissions](/reference/local-data-and-permissions/).
- **Extending wheeljack:** start with [architecture](/reference/architecture/) and
  the [agent adapter contract](/reference/agent-adapters/).

## Supported platforms

Release builds target Windows x64 and universal macOS. Linux is not a supported
release target yet. Download the latest packages from
[GitHub Releases](https://github.com/bildhaus/wheeljack/releases/latest).

wheeljack does not bundle model access, agent subscriptions, or provider
credentials. Each coding-agent CLI uses its own account, provider, limits, and
network connection.
