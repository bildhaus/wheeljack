---
title: Troubleshooting
description: Diagnose wheeljack installation, CLI detection, authentication, session, project-path, Plan, and update problems.
editUrl: https://github.com/bildhaus/wheeljack/edit/main/docs/help/troubleshooting.md
---

Start by confirming that you are using the latest wheeljack release and that the
same project or coding-agent CLI works outside wheeljack where applicable.

## A coding agent is missing

1. Open a regular terminal outside wheeljack.
2. Run the CLI executable, such as `claude`, `codex`, `opencode`, or `pi`.
3. If the command is missing, install it using the provider's official instructions.
4. If it was just added to `PATH`, restart wheeljack.
5. Open **Settings → Agents**, rerun detection, then verify the adapter.

On Windows, command shims may use `.cmd` or `.bat`; wheeljack resolves these
through `PATHEXT` and wraps them for launch. Report a detection bug if the same
command works in a newly opened terminal but remains missing after restart.

On macOS, wheeljack imports the login-shell `PATH` before adapter detection and
adds fallback locations used by Homebrew, MacPorts, Nix, npm/Bun/pnpm, common
Node version managers, mise/asdf, Cargo, and standalone user binaries. Settings →
Agents reports whether the login-shell path or safe fallbacks were used. If an
adapter remains missing, confirm that `command -v claude`, `command -v codex`,
`command -v opencode`, or `command -v pi` returns a real executable path; shell-only
aliases and functions are not executable adapters.

## An adapter cannot be updated from wheeljack

Open **Settings → Agents** and choose **Update all**. The preview reports which
installer owns every active executable and the exact update command it can safely
run. Stop active sessions before retrying an otherwise supported adapter.

If an adapter is skipped, use the reported owner. Nix and version-manager installs
remain controlled by their declaration; Codex CLIs bundled with the Codex desktop
app update with that app; custom and ambiguous standalone executables remain manual.
This is intentional: the presence of a similarly named package is not sufficient
proof that it owns the executable wheeljack launches.

## Verification reports authentication failure

Authenticate in the provider's CLI, not in wheeljack. Confirm that the CLI can
start a normal session outside wheeljack. Provider accounts, subscriptions,
rate limits, billing, and upstream outages are outside wheeljack's support
boundary.

If authentication works externally, rerun verification. A changed executable or
structured protocol intentionally invalidates the previous verified result.

## A structured session fails or disconnects

- Read the pane's failure summary and adapter readiness state.
- Use **Query status** before assuming the visible state is current.
- Use **Resume** for a persistent session that can reconnect.
- Use **Repair** when executable, authentication, or protocol checks changed.
- Start a new session only after preserving any draft or handoff context you need.

wheeljack will not silently replace a failed structured Plan session with an
unstructured one-shot process.

## A project folder is missing

If the folder was moved or a drive is unavailable, wheeljack marks the project
path missing. Restore the drive or relink the existing project to its new folder.
Do not open the moved folder as an unrelated new project if you want the saved
workspace identity and Plan state to follow it.

## Plan files changed outside wheeljack

Plan compares the current project documents with the revision it read. When a
file changes during an agent proposal or edit, wheeljack surfaces a conflict.
Review the disk version and proposed version, then deliberately keep, merge, or
overwrite the change. Do not force an overwrite before inspecting the newer file.

## The Windows app is blocked

Windows packages are currently unsigned. Download only from the official GitHub
release, compare the SHA-256 checksum, and inspect any SmartScreen or antivirus
warning before choosing to run the file. Security software may also quarantine
an update after download.

## An update does not complete

- Confirm the matching public release and platform package exist.
- Check the checksum and available disk space.
- Keep the previous executable or app bundle until the new version launches.
- Restart wheeljack and review the reported recovery state.
- Use a manual latest-release download if automatic replacement remains blocked.

See [Updates and recovery](/guides/updates-and-recovery/) for the health-check and
rollback contract.

## Report a reproducible bug

Include the wheeljack version, operating system, adapter and CLI version,
reproduction steps, expected behavior, actual behavior, and the smallest safe
diagnostic excerpt. Never attach credentials, tokens, private transcripts,
project source, app databases, or full environment dumps.
