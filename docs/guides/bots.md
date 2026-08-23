---
title: Bots
description: Create and run reusable wheeljack specialist profiles with a stable role, adapter, model, effort, and launch snapshot.
editUrl: https://github.com/bildhaus/wheeljack/edit/main/docs/guides/bots.md
---

Bots are reusable specialist profiles. They capture the standing instructions
and launch choices worth repeating without turning a previous transcript into a
template.

## What a Bot stores

A Bot can include:

- name and specialist role;
- standing instructions;
- project or global scope;
- coding-agent adapter;
- model and reasoning effort when supported; and
- launch defaults used to create a new structured session.

Each launch records an immutable snapshot. Editing the Bot later changes future
launches, not the identity or configuration of sessions already running.

## Create a Bot

1. Open **Bots** from the sidebar.
2. Choose **New Bot**.
3. Give the profile a focused role and instructions.
4. Select global scope for reuse across projects, or project scope for context
   that only belongs to the current repository.
5. Choose a verified adapter and its launch defaults.
6. Save the profile.

Keep standing instructions narrow enough that the Bot has a recognizable job.
Project-specific constraints belong in a project Bot or the Plan task contract,
not in an unrelated global profile.

## Start and manage Bots

Select a project, open the Bot, and choose **Start in Work**. wheeljack creates a
new structured agent pane using the saved profile and current snapshot.

You can edit or delete a saved Bot without terminating sessions launched from
it. Deleting a profile removes the reusable definition; existing transcripts
and task evidence keep their launch snapshot.

## Save from an agent

If a live agent configuration proves useful, open its pane menu and save it as a
Bot. Review the proposed name, scope, role, and instructions rather than storing
temporary task text as a permanent specialist.
