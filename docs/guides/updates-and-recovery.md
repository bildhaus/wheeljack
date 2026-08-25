---
title: Updates and recovery
description: Check, verify, install, and recover wheeljack updates on Windows and macOS.
editUrl: https://github.com/bildhaus/wheeljack/edit/main/docs/guides/updates-and-recovery.md
---

wheeljack checks GitHub Releases for a newer published version when update
checks are enabled or started manually. Update state and recovery files remain
local to the application.

## Platform status

- **macOS:** release applications and DMGs are Developer ID signed and notarized.
- **Windows:** the portable executable is currently unsigned, and Windows may
  display SmartScreen or antivirus warnings.

Every public package has a SHA-256 sidecar and is covered by the aggregate
[`SHA256SUMS.txt`](https://github.com/bildhaus/wheeljack/releases/latest/download/SHA256SUMS.txt).

## Install an update

1. Open **Settings → Application**.
2. Check for updates.
3. Review the target version and release notes.
4. Download the update and wait for integrity verification.
5. Restart when wheeljack reports that the update is ready.

Missing packages, checksums, mismatched bytes, cancelled downloads, and install
failures must not replace the running application.

## Health check and rollback

After replacement, the new app must launch and acknowledge a healthy UI. If it
does not, the updater restores the previous application. Local project,
workspace, and settings state is preserved across the replacement and rollback
path.

The updater keeps enough local state to distinguish a successful restart from
an interrupted or unhealthy install. Do not manually delete the update directory
while installation or recovery is in progress.

## One-time legacy upgrade

Upgrading directly from wheeljack v0.1.0 requires a one-time manual download
from the latest GitHub Release. In-app updates work from v0.1.1 onward.

## Legacy Plan recovery

When an older project contains task branches or directories that no longer match
Git's registered worktrees, wheeljack preserves them and starts one project-level
recovery agent. The recovery pass inventories every affected task, integrates
recoverable work, and then returns the cards to normal reconciliation. It does
not require one repair agent or confirmation per card.

Do not manually delete an orphan task directory or branch while recovery is in
progress. A missing directory is accepted only when its preserved branch is
already represented in the opened project branch. If a completed recovery pass
finds a divergent orphan copy, wheeljack leaves that copy intact as an audit
artifact and completes the reconciled card instead of starting another agent.

## If an update fails

- Confirm the latest release is published and contains the package for your platform.
- Check that security software did not quarantine the downloaded Windows executable.
- Keep the previous working executable or app bundle until the new version launches.
- Download the latest release manually if automatic replacement cannot complete.
- Report reproducible wheeljack update failures with safe diagnostics; never
  attach the local database, credentials, or full environment dumps.
