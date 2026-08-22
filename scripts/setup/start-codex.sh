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

# The launcher owns every Codex control argument. Prompt tokens are accepted only after `--`, so a
# future CLI option or subcommand cannot silently become a project-policy bypass.
codex_prompt_arguments=()
seen_no_alt_screen=false
seen_yolo=false
after_delimiter=false
for argument in "$@"; do
  if [[ "$after_delimiter" == true ]]; then
    codex_prompt_arguments+=("$argument")
    continue
  fi
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
    --)
      after_delimiter=true
      ;;
    *)
      echo "Refusing unsupported launcher control argument; pass prompt text only after --." >&2
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

(
  cd "$root"
  env -u CODEX_HOME mise exec --locked -- node scripts/deps/verify-pnpm-execution-policy.mjs
  env -u CODEX_HOME mise exec --locked -- bash scripts/setup/check-prereqs.sh --codex
  env -u CODEX_HOME mise exec --locked -- node scripts/setup/validate-codex-model-policy.mjs
  env -u CODEX_HOME mise exec --locked -- node scripts/verify/licensing.mjs
  env -u CODEX_HOME mise exec --locked -- node scripts/framework/framework-doctor.mjs
)
codex_executable="$(command -v codex)"
cd "$root"
exec env -u CODEX_HOME \
  CODEXRIG_STARTUP_CONTROL_POLICY="$startup_control_policy" \
  mise exec --locked -- node scripts/setup/startup-session-controller.mjs \
  --control-policy "$startup_control_policy" \
  --codex-executable "$codex_executable" \
  --prompt-present "$after_delimiter" \
  -- "${codex_prompt_arguments[@]}"
