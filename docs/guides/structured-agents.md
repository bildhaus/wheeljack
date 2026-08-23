---
title: Structured agents
description: Run persistent coding-agent chats with models, files, approvals, tool activity, and recovery inside wheeljack.
editUrl: https://github.com/bildhaus/wheeljack/edit/main/docs/guides/structured-agents.md
---

Structured agent panes turn a supported CLI protocol into a persistent chat
surface. The CLI remains the execution engine and provider boundary; wheeljack
normalizes presentation, lifecycle, and local persistence.

## Start a session

1. [Verify an adapter](/getting-started/connect-agents/) in Settings.
2. Open a project and enter Work.
3. Create an agent pane.
4. Choose the adapter, model, effort level when supported, and project access.
5. Send a prompt or attach supported images.

Model lists come from the adapter rather than a hard-coded cross-provider
catalog. Availability can therefore change with the installed CLI, account,
provider, and adapter version.

## Read a turn

The transcript separates assistant messages from reasoning, tool activity,
questions, approvals, failures, and status. Tool details remain inspectable
without displacing the final response.

When an agent asks a question or requests approval, wheeljack presents an action
card with explicit choices. The request remains pending until you answer, deny,
cancel, or the underlying session ends.

## Composer and attachments

Draft text, imported image attachments, scroll position, and follow state are
stored with the agent pane. They survive canvas switching and application
restarts. `@` file mentions are resolved within the current project boundary.

:::caution
Only attach project or local files that may be sent to the selected CLI and its
provider. wheeljack stores imported attachments locally, but the agent may
upload their contents according to its own provider contract.
:::

## Stop, resume, and repair

- **Stop** cancels the current turn while keeping the session and transcript.
- **Resume** reconnects a failed or disconnected persistent session when the
  adapter supports recovery.
- **Repair** reruns adapter readiness when executable, authentication, or
  structured-protocol checks fail.
- **Query status** asks the session for a fresh status when presentation and
  process state appear out of sync.

wheeljack uses monotonic protocol sequence numbers to discard stale asynchronous
parse results. An older update cannot overwrite a newer session state.

## Hand off and review

A structured session can be attached to a Plan task, handed off with context,
saved as a Bot profile, or routed to a separate reviewer. Review uses the task
contract and collected evidence; it does not treat a confident chat response as
proof by itself.

Continue with [Plan and review](/guides/plan-and-review/) or learn how reusable
profiles work in [Bots](/guides/bots/).
