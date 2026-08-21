# Contributing to wheeljack

wheeljack is a Windows and macOS Tauri desktop app with a React WebView and a
Rust core. Contributions should preserve the local-first boundary: React owns
presentation and transient interaction, while durable state, PTYs, agent
sessions, Git operations, and updates remain authoritative in `wheeljack-core`.

## Before starting

- Search existing issues before opening a bug or proposing a feature.
- Keep changes focused. Large behavior or architecture changes should begin
  with an issue describing the user problem and intended proof.
- Never include credentials, provider tokens, private transcripts, project
  contents, generated build output, or local app databases in an issue or pull
  request.
- Follow the repository [Code of Conduct](CODE_OF_CONDUCT.md).

The architecture and adapter contracts are described in
[`docs/architecture.md`](docs/architecture.md) and
[`docs/agent-adapters.md`](docs/agent-adapters.md).

## Development setup

Prerequisites:

- Windows or macOS
- [Bun](https://bun.sh/) matching `.bun-version`
- Rust matching `rust-toolchain.toml`
- Git
- The native prerequisites required by Tauri 2 on your platform

From the repository root:

```powershell
Push-Location apps\desktop
bun install --frozen-lockfile
bun tauri dev
Pop-Location
```

Agent integrations are optional for shell development. Testing a structured
adapter requires its CLI to be installed and authenticated outside wheeljack.

## Verification

Run the checks relevant to your change before opening a pull request:

```powershell
bun scripts\verify-desktop-version.mjs

Push-Location apps\desktop
bun install --frozen-lockfile
bun run lint
bun run test
bun run build
Pop-Location

cargo fmt --all -- --check
cargo test --locked -p wheeljack-core -p wheeljack-desktop
cargo clippy --locked -p wheeljack-core -p wheeljack-desktop --all-targets -- -D warnings
bun test scripts\release-contract.test.mjs
```

If the website changed:

```powershell
Push-Location apps\site
bun install --frozen-lockfile
bun run build
Pop-Location
```

UI changes should include focused render tests and before/after screenshots.
Native behavior should be exercised in the Tauri runtime; a browser-only run
does not prove desktop behavior. GitHub CI remains authoritative for packaged
Windows and macOS smoke tests.

## Pull requests

- Open external pull requests against `main`.
- Explain the user-visible change and the failure or workflow it addresses.
- List the exact verification run and any platform proof that was not run.
- Update public documentation when behavior, prerequisites, permissions,
  adapter support, or release artifacts change.
- Keep unrelated cleanup out of the pull request.

By contributing, you agree that your contribution is licensed under the MIT
License in this repository.
