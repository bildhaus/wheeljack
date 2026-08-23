---
title: Installation
description: Install the latest wheeljack release on Windows or macOS, or run the desktop app from source.
editUrl: https://github.com/bildhaus/wheeljack/edit/main/docs/getting-started/installation.md
---

wheeljack publishes Windows x64 and universal macOS builds on GitHub. Start
with the packaged release unless you are developing wheeljack itself.

## Requirements

- Windows 11 x64 or a supported macOS version on Apple Silicon or Intel.
- Git for project and Plan worktree features.
- At least one supported coding-agent CLI on `PATH` for structured chat. A
  regular shell works without an agent CLI.
- Network access only when downloading releases, checking for updates, or when
  your selected CLI contacts its provider.

## Install a release

### Windows

1. Download `wheeljack-windows-x64-portable.exe` from the
   [latest release](https://github.com/bildhaus/wheeljack/releases/latest).
2. Optionally compare the file against
   [`SHA256SUMS.txt`](https://github.com/bildhaus/wheeljack/releases/latest/download/SHA256SUMS.txt).
3. Move the portable executable to a stable location and launch it.

:::caution[Windows signing status]
Windows builds are currently unsigned. SmartScreen or antivirus software may
warn about the portable executable. Verify that it came from the
`bildhaus/wheeljack` GitHub release and check its SHA-256 digest before
bypassing a warning.
:::

### macOS

1. Download `wheeljack-macos-universal.dmg` from the
   [latest release](https://github.com/bildhaus/wheeljack/releases/latest).
2. Open the DMG and move wheeljack into Applications.
3. Launch wheeljack from Applications.

macOS release builds are Developer ID signed and notarized.

## Run from source

Install [Bun](https://bun.sh/), Rust, Git, and the native Tauri prerequisites
for your operating system. Match the versions pinned by `.bun-version` and
`rust-toolchain.toml`.

```powershell
git clone https://github.com/bildhaus/wheeljack.git
Set-Location wheeljack\apps\desktop
bun install --frozen-lockfile
bun tauri dev
```

Source builds use development configuration and are not a substitute for
testing the packaged updater or platform trust behavior.

## Next step

[Open your first project](/getting-started/first-project/) and start a shell.
If you want structured agent chat, also [connect a coding agent](/getting-started/connect-agents/).
