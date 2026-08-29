---
title: Agent adapters
description: The manifest, structured protocol, lifecycle, and extension contract for wheeljack coding-agent adapters.
editUrl: https://github.com/bildhaus/wheeljack/edit/main/docs/reference/agent-adapters.md
---

An adapter teaches wheeljack how to launch and talk to one coding agent CLI. The contract
lives in `crates/wheeljack-core/src/adapters.rs`; the wire shape is `AdapterDto` in
`crates/wheeljack-core/src/dto.rs`.

Adapters come in two grades:

- **Shell adapters** run the CLI in a PTY and inject prompts as text. Everything the user
  sees is terminal output.
- **Structured adapters** additionally speak a machine protocol, so wheeljack can render a
  real chat transcript with reasoning, tool calls, approvals, and cancellation.

Only structured adapters can drive the Plan board, autonomy, or review routing.

## Manifest

```jsonc
{
  "id": "claude-code",                // [A-Za-z0-9._-], 1-80 chars
  "displayName": "Claude Code",
  "icon": "…",
  "executables": ["claude"],          // at least one PATH candidate
  "supportedPlatforms": ["macos", "windows"],   // only these two values
  "supportedApprovalPolicies": ["default", "full"],
  "launchCommand": "claude",          // required, non-empty
  "promptInjection": "stdin",         // stdin | paste_then_enter | manual
  "status": "installed",              // installed | missing | unknown
  "setupHint": "Install with npm i -g @anthropic-ai/claude-code",
  "enabled": true,
  "supportsStructured": true,
  "presentation": { },
  "streaming": { "preferred": { } }   // see below
}
```

`validate_adapter_manifest` in `adapters.rs` rejects anything outside those
constraints before the adapter is ever launched.

Executable resolution is `resolve_executable_path`: a bare name is searched across `PATH`;
on Windows each candidate is expanded through `PATHEXT`, and `.cmd`/`.bat` shims are
re-wrapped so they launch correctly.

## The structured profile

`streaming.preferred` is what promotes an adapter to structured. It is resolved by
`resolve_structured_adapter_launch` in `adapters.rs`, which enforces every rule below and
fails the launch rather than degrading silently:

```jsonc
{
  "launchCommand": "claude --output-format stream-json …",
  "promptDelivery": "stdin",
  "protocol": "claude-stream-json",
  "sessionMode": "persistent-session",   // must start with "persistent-"
  "supportsFollowUp": true               // must be exactly true
}
```

Rules:

1. `sessionMode` must begin with `persistent-` **and** `supportsFollowUp` must be `true`.
   A one-shot agent is not accepted, because the shell assumes a session survives a turn.
2. `protocol` must parse to a known `StructuredProtocol`.
3. `promptDelivery` must equal the protocol's own `prompt_delivery()`. A mismatch is a
   manifest bug and is rejected at launch.

## Protocols

`StructuredProtocol` in `crates/wheeljack-core/src/terminal_runtime.rs` is a closed set.
Adding an agent means either reusing one of these or implementing a new driver.

| Protocol | Prompt delivery | Driver |
| --- | --- | --- |
| `claude-stream-json` | `stdin` | `claude` |
| `codex-app-server` | `json-rpc` | `codex` |
| `opencode-sse` | `sse` | `opencode` |
| `pi-rpc` | `json-rpc` | `pi` |
| `hermes-gateway` | `json-rpc` | `hermes-gateway` |
| `hermes-acp` | `json-rpc` | `hermes-acp` |
| `plain-argv` | `argv` | `plain` |
| `plain-stdin` | `json-rpc` | `plain` |

## Capabilities

Each protocol declares `StructuredDriverCapabilities`, and the shell renders from that
rather than hard-coding per-adapter behaviour:

| Capability | Protocols |
| --- | --- |
| `cancel` | `claude-stream-json`, `codex-app-server`, `opencode-sse`, `pi-rpc` |
| `interact` (answer questions / approvals) | `claude-stream-json`, `codex-app-server`, `opencode-sse` |
| `resume` | `claude-stream-json`, `codex-app-server`, `opencode-sse`, `pi-rpc` |
| `attached_terminal` | `opencode-sse` |
| `image_input` | `claude-stream-json`, and others per `capabilities()` |

On the WebView side these arrive as `runtime.capabilities` and are consumed through
`agentRuntime.ts` (`agentRuntimeCapabilities`, `supportsAgentTurnCancel`,
`supportsAgentImageInput`). Components should read the capability, never the adapter id.

## Lifecycle

| Step | Command | Notes |
| --- | --- | --- |
| Discover | `adapter_list`, `adapter_detect` | registry plus PATH detection |
| Probe | `adapter_probe` | cheap liveness check |
| Verify | `adapter_verify` | full launch check; run twice before declaring failure |
| Update | `adapter_update_preview`, `adapter_update_execute` | preview exact provenance-owned commands, confirm once, then execute sequentially |
| Repair | — | shell surfaces `adapterRepairCommand()` from the setup hint |
| Spawn | `agent_structured_spawn` | starts a persistent session |
| Prompt | `agent_structured_prompt` | delivered per `promptDelivery` |
| Respond | `agent_structured_respond` | answers a question or approval |

Adapter updates use a short-lived, single-use confirmation token. The core stores
the previewed command plans and invokes executables directly without shell
interpolation. Active sessions, ambiguous ownership, declarative installs, and
manual installs are returned as skipped rather than guessed; the desktop rescans
and verifies successful updates afterward.
| Cancel | `agent_structured_cancel` | only when `capabilities.cancel` |
| Attach | `agent_structured_terminal_attach` | only when `capabilities.attached_terminal` |
| Kill | `agent_structured_kill` | intentional teardown, kept distinct from process failure |
| Parse | `agent_protocol_parse` | converts raw lines into messages and events |

Settings exposes **Scan all**, **Verify all**, and **Verify selected**. Batch
verification runs at most two adapters concurrently and preserves each adapter's
independent result, so one provider failure does not discard successful checks.

`agent_protocol_parse` runs in the core, not the WebView: the shell buffers output lines,
debounces, and sends them for parsing. Results carry a `protocolSequence`, and the shell
drops any result older than the runtime it already holds.

## Launch configuration

The shell composes launch arguments through `agentLaunchArgs`, `agentLaunchConfig`, and
`agentProjectAccessConfig` in `App.tsx`. Project access maps to each agent's own
permission vocabulary — `approvalPolicy` and `sandbox` — so "full access" means the same
thing to the user regardless of which agent is running. Changing a profile field marks the
adapter stale so the next launch re-verifies instead of reusing a stale probe.

## Adding an adapter

1. Add a built-in manifest in `built_in_adapters()` in
   `crates/wheeljack-core/src/adapters.rs`, or save a custom manifest through the adapter
   registry.
2. If it speaks an existing protocol, set `streaming.preferred` and stop — no Rust changes.
3. If it needs a new protocol, add a `StructuredProtocol` variant with its
   `prompt_delivery()`, `driver_id()`, and `capabilities()`, then implement the driver in
   `terminal_runtime.rs`.
4. Cover it in `crates/wheeljack-core/src/tests/adapters.rs` and, for parsing, in
   `tests/agent_protocol.rs`.
