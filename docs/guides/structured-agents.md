---
title: Structured agents
description: Run persistent coding-agent chats with models, files, approvals, tool activity, and recovery inside wheeljack.
editUrl: https://github.com/bildhaus/wheeljack/edit/main/docs/guides/structured-agents.md
---

:::note
The workflow improvements described here apply to wheeljack 0.1.14 and later.
:::

Structured agent panes turn a supported CLI protocol into a persistent chat
surface. The CLI remains the execution engine and provider boundary; wheeljack
normalizes presentation, lifecycle, and local persistence.

## Start a session

1. [Verify an adapter](/getting-started/connect-agents/) in Settings.
2. Open a project and enter Work.
3. Create an agent pane.
4. Choose the adapter, model, effort level when supported, project access, and
   session intent.
5. Send a prompt or attach supported images.

Model lists come from the adapter rather than a hard-coded cross-provider
catalog. Availability can therefore change with the installed CLI, account,
provider, and adapter version.

The composer displays the effective model and effort for that pane, including
saved Bot overrides. Changes there apply to the pane; change adapter defaults in
Settings when you want future panes to inherit a different configuration.

**Code** sessions use the project's configured agent access. **Ask** sessions
are strictly read-only and are only available when the adapter exposes an
enforceable read-only mode. wheeljack currently maps Ask to Codex's read-only
sandbox with approvals disabled and Claude's plan permission mode. It does not
show Ask for adapters where that guarantee would only be cosmetic.

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

You can submit another prompt while a turn is running. wheeljack stores it in a
bounded SQLite queue and sends prompts to that session in order. Queued prompts
can be edited or canceled; failed prompts can be retried. If wheeljack stops
after a provider may have received a prompt but before delivery was recorded,
the prompt is marked **indeterminate** and is never replayed automatically.
Choose Retry only after checking the conversation for a duplicate.

Queued edits preserve the prompt's images and launch policy and replace the
same durable delivery record. Canceled and indeterminate prompts remain visibly
marked in the conversation so the UI does not imply confirmed delivery.

Editing a queued prompt preserves the separate new-message draft and its images.
The edit target survives navigation. Resuming an interrupted session carries its
pending queue forward in order; uncertain deliveries still require an explicit
decision. A local history-write failure after acceptance does not resend provider
work automatically.

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
