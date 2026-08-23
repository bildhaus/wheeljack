---
title: Architecture
description: How wheeljack separates durable Rust core state, the Tauri host, and transient React presentation.
editUrl: https://github.com/bildhaus/wheeljack/edit/main/docs/reference/architecture.md
---

wheeljack is a Tauri 2 desktop app split into two halves with a deliberately narrow
boundary between them.

| Half | Crate / package | Owns |
| --- | --- | --- |
| Core | `crates/wheeljack-core` | SQLite state, PTY and structured agent sessions, routing, Git, updates. The durable authority. |
| Shell | `apps/desktop/src` | Presentation and transient interaction only. |
| Host | `apps/desktop/src-tauri` | Tauri process: window lifecycle, the `core_*` commands, and a small set of direct commands. |

The rule that keeps the split honest: **anything that must survive a restart lives in
the core.** The WebView may hold a value while the user is looking at it, but the core
decides what is true.

## The core boundary

The WebView never calls core functions directly. It goes through exactly two Tauri
commands, both defined in `apps/desktop/src-tauri/src/lib.rs` and wrapped in
`apps/desktop/src/core.ts`.

### `core_connect` — open the session

```ts
const connection = await invoke<CoreConnection>("core_connect", { events });
await callCore("core_handshake", { supportedVersions: [2, 1] });
```

`events` is a Tauri `Channel<CoreEventEnvelope>`. One channel carries every push
notification for the lifetime of the WebView. `core_connect` returns:

```ts
interface CoreConnection {
  appDataDir: string;
  version: string;
  reused: boolean;   // true when reconnecting to an already-running core
}
```

`reused` matters: a WebView reload reconnects to a live core with live PTYs rather than
starting a new one, which is what makes restart recovery work.

### `core_call` — request/response

Every other core interaction is a JSON string in, JSON string out:

```ts
const responseJson = await invoke<string>("core_call", { requestJson });
```

Request shape (`crates/wheeljack-core/src/protocol.rs`, `CoreRequest`):

```jsonc
{
  "protocolVersion": 2,
  "id": "web-1699999999999-42",  // also accepted as "requestId"
  "command": "canvas_upsert_node",
  "payload": { }
}
```

Response shape (`CoreResponse`):

```jsonc
{
  "protocolVersion": 2,
  "requestId": "web-1699999999999-42",
  "sequence": 1234,
  "id": "web-1699999999999-42",
  "ok": true,
  "payload": { },
  "error": { "code": "command_failed", "message": "..." }  // only when ok is false
}
```

`callCore` throws `CoreCommandError` carrying `code` and `message` when `ok` is false, so
callers get a typed failure rather than a sentinel. Serialization failure in the core
still returns well-formed JSON with `ok: false` — the transport never emits garbage.

`Core::dispatch` in `crates/wheeljack-core/src/lib.rs` is the single entry point.
It is a flat `match` grouped by command prefix:

| Prefix | Concern |
| --- | --- |
| `adapter_*` | agent adapter registry, probe, verify, repair |
| `agent_structured_*`, `agent_protocol_parse`, `agent_models_list` | structured agent sessions |
| `agent_control_*` | autonomy requests, authorization, audit trail |
| `canvas_*` | canvases, nodes, layout |
| `coordination_*`, `ops_*` | Plan board, task lanes, scheduler leases |
| `session_*`, `terminal_*` | PTY sessions, transcripts, viewport |
| `git_*` | status, diff, worktrees |
| `settings_*`, `state_backup_export` | preferences and durable state |
| `updater_*` | check, download, recovery |

### Events — core to WebView

The core pushes over the `Channel` opened by `core_connect`:

```ts
interface CoreEventEnvelope {
  event: string;
  payload: JsonObject;
  protocolVersion: number;
  eventId: string;
  sequence: number;   // monotonic; use it to discard out-of-order work
}
```

Event names currently emitted:

| Event | Meaning |
| --- | --- |
| `core:ready` | core finished startup, including any database migration |
| `pty:data` | terminal output for a session |
| `pty:exit` | a session ended; `payload.transient` distinguishes an attached-terminal detach from a process exit |
| `agent:control` | an agent requested an autonomous action needing policy evaluation |
| `updater:progress` | download progress |

`sequence` is load-bearing. Structured agent parsing is debounced and asynchronous, so
the shell compares `protocolSequence` before applying a parse result and drops anything
that arrives after newer runtime state.

### Direct Tauri commands

A few operations bypass the core because they are host concerns, not durable state:

- Attachments — `read_image_attachment`, `import_image_attachment`, `save_image_attachment`
- Themes — `read_theme_document`, `write_theme_document`, `discover_vscode_themes`
- Fonts — `system_font_families`
- Lifecycle — `close_after_flush`, `apply_downloaded_update`, `complete_update_health`
- Migration — `legacy_windows_ui_preferences`
- Smoke harness — `ui_smoke_enabled`, `ui_smoke_auto_close`, `ui_smoke_update_mode`, `complete_ui_smoke`
- `open_devtools` (development context menus only)

## WebView state

Shell ownership is split along runtime boundaries rather than concentrated entirely in
`apps/desktop/src/App.tsx`:

| Owner | State / responsibility |
| --- | --- |
| `state/workspaceStore.ts` | projects, canvases, nodes, layout, and focused pane |
| `state/runtimesStore.ts` | live terminal and structured-agent runtimes |
| `state/opsStore.ts` | current Plan/Ops document state |
| `WorkspaceRuntimeSurface.tsx` | split layout, panes, and terminal/chat presentation; lazy-loaded by `App.tsx` |
| `opsOrchestration.ts` | pure Plan/Ops transitions, scheduling decisions, persistence projections, and conflict checks |
| `App.tsx` | cross-boundary effects, core calls, and composition of the extracted owners |

The extraction is deliberately incremental: `App.tsx` is still the shell coordinator,
but it no longer owns duplicate React state for workspace, runtime, or Ops data.

**Agent chat boundary.** Agent transcript rendering and composer-local state live in
`src/AgentChat.tsx`; model discovery and caching live in `src/agentModels.ts`. `Pane`
passes stable event callbacks into the memoized chat, so runtime updates for one pane do
not invalidate every other chat. Terminal cursor animation is likewise limited to the
focused, visible pane. Draft text, image attachments, and scroll/follow position are
normalized by `agentComposition.ts`, stored in the canvas node's `chatComposition` data,
and persisted through `canvas_upsert_node`. They therefore survive canvas switching and
application restarts instead of belonging only to a mounted `AgentChat` instance.

**Synchronous reads.** Many async flows need the current value of state they just wrote.
That used to be solved by mirroring state into a `useRef` shadow copy, which had to be
written alongside every setter. Workspace, Ops, and pane runtimes now live in zustand
stores, where synchronous getters and render subscriptions observe the same object by
construction:

```ts
setRuntimes((current) => ({ ...current, [nodeId]: runtime }));
currentRuntimes()[nodeId]; // already the value just written
```

Names such as `opsStateRef`, `nodesRef`, `canvasRef`, and `projectRef` are read-only
compatibility accessors backed by those stores. They are not independently synchronized
shadow copies and must not become writable mirrors.

**Two sync disciplines.** Refs synced in a `useEffect` update after paint and are stale
inside synchronous handlers; refs assigned during render are fresh but make the render
impure. Prefer a store over adding either.

## Pure logic modules

These are dependency-free, individually tested, and should be reused rather than
reimplemented inside a component:

| Module | Concern |
| --- | --- |
| `agentRuntime.ts` | agent status transitions, message reconciliation, capabilities |
| `agentComposition.ts` | durable per-agent drafts, attachments, and scroll state |
| `opsOrchestration.ts` | Plan/Ops scheduling, persistence, and conflict decisions |
| `opsPresence.ts`, `opsFloor.ts`, `opsRunGraph.ts`, `opsTimeline.ts` | Plan board derivation |
| `attention.ts` | inbox / pending-interaction derivation |
| `splitTree.ts` | recursive pane split tree |
| `agentFileMentions.ts` | `@`-mention parsing in the composer |
| `terminalFrame.ts` | terminal cell buffer and frame application |
| `shortcuts.ts`, `theme.ts`, `themeImport.ts` | bindings and theming |

## Terminal rendering

`TerminalSurface.tsx` is a canvas renderer, not xterm.js. The core runs
`alacritty_terminal` and pushes `TerminalFrame` snapshots; the WebView paints cells and
owns selection, IME composition, and key encoding. The canvas is `aria-hidden` with a
focusable textarea mirror alongside it, and the host element carries
`role="application"` with `aria-label="Terminal session"`.

## Testing

| Suite | What it covers |
| --- | --- |
| `src/*.test.ts` | pure logic modules |
| `src/*.test.tsx` | rendered behaviour via `@testing-library/react` under jsdom |
| `src/sourceContract.test.ts` | invariants with no runtime surface, asserted against raw source text |

`sourceContract.test.ts` is a lint, not a behaviour suite. It pins file layout as well as
behaviour, so a rename or an extraction fails it while behaviour is unchanged. Do not add
to it unless the invariant is genuinely unobservable at runtime; as surfaces move out of
`App.tsx`, its checks should become render tests and move with them.

`bun run lint` runs oxlint with `react-hooks/rules-of-hooks` as an error and
`react-hooks/exhaustive-deps` as a warning. oxlint honours `// eslint-disable-next-line`
comments. (eslint itself is not usable here: `typescript-eslint` hard-blocks on the
TypeScript 7 pinned by this package.)

## Performance targets

Performance has both a regression ceiling and a smaller explicit target in
`scripts/desktop-performance-targets.json`. `bun run build` checks the generated Vite
assets with `scripts/check-desktop-bundle.mjs`:

| Bundle metric | Current ceiling | Improvement target |
| --- | ---: | ---: |
| Initial JavaScript | 1,700,000 bytes | 1,250,000 bytes |
| Largest JavaScript chunk | 1,350,000 bytes | 900,000 bytes |
| Total JavaScript | 1,800,000 bytes | 1,550,000 bytes |

The packaged six-session smoke keeps its baseline regression check and separately reports
progress toward 540 MiB working set, 75 ms input p95, and 16.7 ms frame p95. The target
report is intentional: passing the baseline ceiling means a change did not regress; it
does not mean the improvement target has been reached.
