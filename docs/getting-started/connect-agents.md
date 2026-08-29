---
title: Connect coding agents
description: Install, authenticate, detect, and verify supported coding-agent CLIs for structured wheeljack sessions.
editUrl: https://github.com/bildhaus/wheeljack/edit/main/docs/getting-started/connect-agents.md
---

wheeljack launches coding agents already installed on your machine. It does not
bundle subscriptions, provider credentials, model access, or provider billing.

## Supported adapters

| Adapter | Executable | Structured mode | Authentication outside wheeljack |
| --- | --- | --- | --- |
| Claude Code | `claude` | Yes | Install and authenticate Claude Code. |
| Codex CLI | `codex` | Yes | Run `codex login` or use the CLI's normal sign-in flow. |
| OpenCode | `opencode` | Yes | Run `opencode auth login` or configure its normal provider credentials. |
| Pi | `pi` | Yes | Install `@earendil-works/pi-coding-agent`, then run `pi /login`. |
| Generic shell | Platform shell | No | No provider authentication. |

Provider installation commands change independently of wheeljack. Use each
provider's official documentation, then confirm that the CLI starts successfully
in an ordinary terminal before diagnosing it inside wheeljack.

The installation method does not matter. wheeljack resolves adapter executables
from the desktop process and, on macOS, the user's login-shell `PATH`, so Homebrew,
MacPorts, Nix, npm, Bun, pnpm, nvm/fnm, Volta, mise/asdf, Cargo, and standalone
installations work when they expose the documented executable. Standard manager
locations remain available if the login shell cannot be queried; Settings → Agents
shows which search-path source was used.

## Detect and verify

1. Install and authenticate the CLI outside wheeljack.
2. Restart wheeljack if the executable was added to `PATH` while wheeljack was
   already running.
3. Open **Settings → Agents**.
4. Choose **Scan all** to detect and probe every adapter.
5. Choose **Verify all** to run one real non-mutating turn through every installed,
   signed-in adapter, or **Verify selected** for only the current adapter.
6. Choose the adapter as the default or select it when creating a new agent pane.

Verification checks executable resolution, the adapter's structured protocol,
and the launch profile wheeljack will use. A changed executable or protocol
profile invalidates stale verification instead of trusting an old result.
Verification is explicit because it may contact each CLI's configured provider and
consume one minimal turn.

## Update installed adapters

Choose **Update all** to inspect the active executable for each installed adapter.
wheeljack proves ownership through npm, pnpm, Bun, Yarn, Homebrew, WinGet, Scoop,
Chocolatey, or a documented native self-updater before offering an update. The
confirmation dialog shows every exact command; confirmed updates run sequentially,
then wheeljack scans again and verifies successfully updated adapters.

Ambiguous, custom, Nix-declared, version-manager-shim, app-bundled, and unknown
standalone installs are skipped with a reason. wheeljack never guesses an installer,
runs a composed shell command, changes declarative package configuration, or updates
an adapter while one of its sessions is active.

## Structured sessions versus shells

A generic shell displays terminal output only. A structured adapter additionally
exposes chat messages, reasoning, tool activity, approvals, questions,
cancellation, model selection, Plan routing, autonomy requests, and review
evidence.

wheeljack fails a structured launch when the required persistent-session
contract is unavailable. It does not silently downgrade a Plan task to a
one-shot or unstructured agent.

## Choose project access

- **Agent default** preserves the CLI's normal sandbox and approval policy.
- **Full access** explicitly asks the CLI to allow internet access and local
  files without its ordinary approval boundary.

:::caution
Full access is a per-project trust decision. Enable it only for repositories and
instructions you trust, and review agent permission requests and proposed file
changes before approval.
:::

Managed agents can request bounded coordination actions such as messaging a
peer, starting a child, handing off work, or requesting review. Configure each
action as **Allow automatically**, **Ask every time**, or **Deny** in agent
settings. wheeljack enforces the selected policy and records the request and
result in Autonomy history. New profiles allow agent discovery automatically;
messaging, spawning children, handoff, review, and conflict resolution default
to **Ask every time** because approved actions can create provider usage.
