#!/usr/bin/env bash
# Owns start codex behavior for the setup, launch, and portable project boundary.
set -euo pipefail

# Repository startup must not inherit executable Node/package-manager or non-interactive shell
# preload controls. The initial Bash interpreter has already started, but every child trust-boundary
# process below observes this sanitized environment.
unset BASH_ENV ENV NODE_OPTIONS NODE_PATH CODEXRIG_LAUNCHER_PID \
  CODEXRIG_SESSION_CONTROL_NODE CODEXRIG_SESSION_CONTROL_PORT \
  CODEXRIG_SESSION_CONTROL_TOKEN CODEXRIG_STARTUP_CONTROL_POLICY \
  CODEXRIG_STARTUP_NONCE CODEXRIG_STARTUP_RESUME_SESSION_ID \
  CODEXRIG_STARTUP_SESSION_SOURCE \
  NPM_CONFIG_NODE_OPTIONS npm_config_node_options \
  PNPM_CONFIG_NODE_OPTIONS pnpm_config_node_options \
  NPM_CONFIG_SCRIPT_SHELL npm_config_script_shell \
  PNPM_CONFIG_SCRIPT_SHELL pnpm_config_script_shell

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
root="$(cd "$script_dir/../.." && pwd -P)"

# The native resume picker owns session selection. Enter prompts after choosing a session; a
# positional argument here would become a session ID and suppress the picker.
seen_no_alt_screen=false
seen_yolo=false
for argument in "$@"; do
  case "$argument" in
    --no-alt-screen)
      if [[ "$seen_no_alt_screen" == true ]]; then
        echo "Refusing duplicate launcher control argument." >&2
        exit 64
      fi
      seen_no_alt_screen=true
      ;;
    --yolo)
      if [[ "$seen_yolo" == true ]]; then
        echo "Refusing duplicate launcher control argument." >&2
        exit 64
      fi
      seen_yolo=true
      ;;
    *)
      echo "Only --no-alt-screen and explicit Dev --yolo are supported; enter prompts after selecting a session." >&2
      exit 64
      ;;
  esac
done
if [[ "$seen_yolo" == true && "$seen_no_alt_screen" == true ]]; then
  startup_control_policy="dev-yolo-v1:no-alt-screen"
elif [[ "$seen_yolo" == true ]]; then
  startup_control_policy="dev-yolo-v1:default-screen"
elif [[ "$seen_no_alt_screen" == true ]]; then
  startup_control_policy="interactive-v2:no-alt-screen"
else
  startup_control_policy="interactive-v2:safe-defaults"
fi

if ! command -v mise >/dev/null 2>&1; then
  echo "mise is not available on PATH. Install it before this project can start:" >&2
  echo "  https://mise.jdx.dev/installing-mise.html" >&2
  exit 127
fi

# These values must survive deterministic validation, attestation issuance, the Codex process, and
# both lifecycle hooks. A narrower subshell would leave later pnpm version probes able to load
# mutable repository or user pnpm hooks before the attestation can reject them.
export NPM_CONFIG_IGNORE_PNPMFILE=true
export PNPM_CONFIG_IGNORE_PNPMFILE=true
export npm_config_ignore_pnpmfile=true
export pnpm_config_ignore_pnpmfile=true

# Inventory before mutation, then maintain tools, dependencies and CI together. Bootstrap Node
# must already be available; the maintenance owner installs the reviewed candidate through mise.
cd "$root"
if ! command -v node >/dev/null 2>&1; then
  echo "Bootstrap Node.js is unavailable. Run mise install --locked, then retry inside mise exec --locked." >&2
  exit 127
fi
node scripts/deps/maintain-toolchain.mjs --startup
hash -r
(
  env -u CODEX_HOME mise exec --locked -- node scripts/deps/verify-pnpm-execution-policy.mjs
  env -u CODEX_HOME mise exec --locked -- bash scripts/setup/check-prereqs.sh --codex
  CODEX_HOME="$root" mise exec --locked -- node scripts/setup/validate-codex-model-policy.mjs
  env -u CODEX_HOME mise exec --locked -- pnpm tooling:doctor
)
codex_executable="$(command -v codex)"
cd "$root"
exec env -u CODEX_HOME \
  CODEXRIG_STARTUP_CONTROL_POLICY="$startup_control_policy" \
  mise exec --locked -- node scripts/setup/startup-session-controller.mjs \
  --control-policy "$startup_control_policy" \
  --codex-executable "$codex_executable"
