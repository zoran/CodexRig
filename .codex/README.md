# CodexRig Config

Tracked configuration is portable; native runtime and account state are private.

| Owner                                      | Contract                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `config.toml`, `agents/*.toml`             | Primary/role instructions, exact model and permission defaults.             |
| `hooks.json`                               | Trusted lifecycle-hook admission; the canonical controller binds execution. |
| `tooling.json`                             | Startup and Git-provider selection.                                         |
| `toolchain.json`, `mise.toml`, `mise.lock` | Verified tool artifacts and pinned versions.                                |
| `verification.json`                        | Commands, input consumers, shared execution inputs and output contracts.    |

Exact schemas belong to their validators. Configuration validation does not prove model obedience.
Policy, runtime and hook changes take effect through the next canonical launch; reloading a chat
does not replace its controller. Use the [README commands](../README.md#essential-commands).

Repository-root `CODEX_HOME` holds ignored native authentication, history, memory, plugins and
caches. Ignored `.codex/runtime/` holds framework coordination and verification evidence; external
accounts use `.auth/project-tools/`. Installed tools and public caches may be shared through their
owner, while credentials, trust and device state remain private. None transfers to a child.
Framework memories are disabled; independent projects may enable isolated project memory.

Follow the canonical policies for [startup/recovery](../instructions.md#session-start),
[account isolation](../instructions.md#repository-local-tool-and-account-isolation),
[agent admission and permissions](../instructions.md#subagent-orchestration-and-integration-authority),
[capacity and terminal drain](../instructions.md#capacity-admission-and-monitoring),
[continuation](../instructions.md#compact-project-memory),
[verification reuse](../instructions.md#verification-selection-and-runtime), and
[isolated release](../instructions.md#delegated-release).
