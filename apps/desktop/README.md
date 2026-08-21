# wheeljack desktop

This is the production wheeljack desktop shell. Tauri embeds `wheeljack-core`
directly; React with shadcn/ui and Sargam Icons renders Home, Work, Plan
Board/PRD/TDD, Appearance, Interface, activity, Git, history, review, routing,
and project-removal surfaces.

The terminal renders wheeljack core frames with Canvas 2D and supports
recursive splits, structured-agent panes, keyboard/IME and mouse input,
selection, scrollback, alternate-screen modes, resize, restart recovery, and
sequence/paint instrumentation.

## Run

```powershell
bun install
bun tauri dev
```

The optional `src-tauri/tauri.dev.conf.json` override exposes the actual
WebView2 runtime on port 9333 for local DevTools automation:

```powershell
bun tauri dev --config src-tauri/tauri.dev.conf.json
```

## Verify

```powershell
bun run test
bun run build
cd ../..
cargo test -p wheeljack-desktop -p wheeljack-core --locked
.\scripts\publish-desktop-windows.ps1
.\scripts\smoke-desktop-windows.ps1 -Executable .\artifacts\desktop\windows\wheeljack-windows-x64-portable.exe
```

The packaged smoke uses disposable profiles and exercises the actual Tauri
window, live terminals, structured-agent interaction, accessibility, recovery,
data panes, event ordering, updater behavior, and clean shutdown.
Release builds additionally drive the signed updater through stage, restart,
health acknowledgement, persistence, and rollback on both Windows and macOS.
Its six-session check runs three fresh profiles and prints
`SIX_SESSION_METRICS_SAMPLE` for each run plus a median
`SIX_SESSION_METRICS_BASELINE_CANDIDATE`. After that candidate is measured from
a rebuilt package and saved as `scripts\desktop-six-session-baseline.json`, the
same command fails when working set or input, resize, or frame p95 exceeds 1.2
times its baseline median. It also reports progress against the explicit
working-set, input-latency, and 60 fps targets in
`scripts\desktop-performance-targets.json`; bundle builds enforce a tighter
current ceiling and report the remaining gap to their next reduction target.

Production data uses the `com.omershatz.wheeljack` app-local directory. First
launch imports the former private-build `com.oshtz.wheeljack` profile, then the
older `wheeljack` or Tauri preview profile when needed. Sources remain intact,
and migration runs only while the new production database is empty.
