---
title: Contributing
description: Set up the wheeljack repository, make focused changes, update public documentation, and run the required verification.
editUrl: https://github.com/bildhaus/wheeljack/edit/main/docs/contributing.md
---

wheeljack welcomes focused bug fixes, documentation improvements, and scoped
features. Large behavior or architecture changes should begin with a GitHub
issue that defines the user problem and intended proof.

## Development setup

Prerequisites are Windows or macOS, Bun matching `.bun-version`, Rust matching
`rust-toolchain.toml`, Git, and the native Tauri prerequisites for your platform.

```powershell
git clone https://github.com/bildhaus/wheeljack.git
Set-Location wheeljack
Push-Location apps\desktop
bun install --frozen-lockfile
bun tauri dev
Pop-Location
```

Agent integrations are optional for shell development. Structured-adapter tests
require the relevant CLI to be installed and authenticated outside wheeljack.

## Preserve the architecture boundary

React owns presentation and transient interaction. Durable state, PTYs,
structured agent sessions, Git operations, routing, and updates belong in
`wheeljack-core`. Read [Architecture](/reference/architecture/) before changing
the core/WebView boundary and [Agent adapters](/reference/agent-adapters/)
before changing an integration protocol.

## Update documentation

Canonical public content lives under `docs/`; `apps/docs` owns its Starlight
rendering and validation. Update docs when behavior, prerequisites, permissions,
adapter support, or release artifacts change.

```powershell
Push-Location apps\docs
bun install --frozen-lockfile
bun run build
Pop-Location
```

Every public page needs unique title and description frontmatter, a meaningful
heading hierarchy, valid internal links, and instructions that match the latest
public release.

## Verify a change

Run the checks relevant to the changed boundaries. Desktop work normally needs
frontend tests/build plus focused Rust tests. Site and docs changes need their
own frozen install and production build. Native behavior must be exercised in
Tauri or a packaged application; a browser-only run is not desktop proof.

See the repository's complete
[`CONTRIBUTING.md`](https://github.com/bildhaus/wheeljack/blob/main/CONTRIBUTING.md)
for commands and pull-request expectations.

## Open a pull request

External pull requests target `main`. Explain the user-visible change, list the
exact checks run, disclose platform proof that was not run, and keep unrelated
cleanup out of the change.

Never include credentials, provider tokens, private transcripts, project
contents, generated build output, or local app databases in an issue or pull
request.
