---
title: Local data and permissions
description: Understand wheeljack's local SQLite authority, app-data migration, provider network boundary, backups, and project access controls.
editUrl: https://github.com/bildhaus/wheeljack/edit/main/docs/reference/local-data-and-permissions.md
---

:::note
The workflow improvements described here apply to wheeljack 0.1.14 and later.
:::

wheeljack has no hosted account or sync service. Project registration, canvases,
layouts, settings, session history, attachments, Bots, and Plan state are stored
locally under the Tauri application data directory.

## Source-of-truth boundary

| Data | Authority |
| --- | --- |
| Project source and Git history | The selected project folder and its repository |
| Workspace, settings, sessions, and Plan state | Local `wheeljack-core` SQLite storage |
| Live PTYs and structured sessions | The running Rust core |
| Provider identity, credentials, models, usage, and billing | The selected coding-agent CLI and provider |
| Release packages and update metadata | Public `bildhaus/wheeljack` GitHub Releases |

The React WebView owns presentation and transient interaction only. Anything
that must survive a restart is committed through the Rust core.

## App-data location

Production state uses the platform's local application-data location for the
identifier `com.omershatz.wheeljack`. The exact absolute directory is displayed
in **Settings → Application → Storage** so you do not need to guess a
platform-specific path.

The directory contains the SQLite database and local subdirectories for items
such as attachments, cache, updates, recovery, and crash diagnostics. Settings
shows attachment count and disk usage. The core removes image copies only when
they are no longer referenced by a saved draft, unresolved prompt delivery, or
durable transcript; cleanup runs at startup and can be requested manually.

:::caution
Do not edit or copy the live SQLite files while wheeljack is running. Use the
Application backup export so the core includes current write-ahead-log state and
verifies the resulting database.
:::

## Migration from earlier builds

On first launch, the current production profile can atomically import the former
private-build `com.oshtz.wheeljack` profile, then older `wheeljack` or preview
locations. Migration runs only while the new production database is empty.

Source databases remain untouched. The migrated destination also receives a
pre-migration backup so recovery does not depend on deleting the old profile.

The release-preparation build adds queue-recovery metadata while retaining
database compatibility version 21, which v0.1.13 can read after an updater
rollback. Startup fills missing request identities and refreshes payload
fingerprints after an older build has written to the profile.

## Coding-agent network access

wheeljack does not proxy or host agent traffic. A structured CLI communicates
with its configured provider according to that CLI's authentication, privacy,
subscription, model, rate-limit, and billing terms.

Imported attachments are stored locally first, but their content may leave the
device when you include them in a provider-backed prompt. Review the CLI's
provider boundary before sending private material.

## Project access levels

- **Agent default:** use the CLI's native sandbox and approval behavior.
- **Full access:** map the project to the CLI's permissive controls, including
  internet and local-file access without ordinary approval.

Full access does not bypass wheeljack's workspace, coordination, depth, child,
concurrency, or rate limits. It does materially expand what the launched CLI may
do, so it remains an explicit per-project decision.

## Backups and removal

Use **Settings → Application → Storage** to export a complete backup folder with
the database and referenced attachments, or a database-only SQLite file. Complete
backups support a previewed restore on the next launch, with a complete recovery
copy of the previous state retained in the app-data folder. Keep exported backups
outside the live data directory. Project files and agent CLI credentials are not
part of the backup. Removing a project from wheeljack is separate from
deleting its folder. Resetting preferences is separate from deleting durable
workspace state. Follow the specific confirmation for each action.
