#!/usr/bin/env bash
# Owns start codex behavior for the setup, launch, and portable project boundary.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
root="$(cd "$script_dir/../.." && pwd -P)"
codex_directory="$root/.codex"
runtime_directory="$codex_directory/runtime"
config_path="$codex_directory/config.toml"
hooks_path="$codex_directory/hooks.json"
hook_launcher_path="$root/scripts/context/refresh-context-index-on-stop.sh"
hook_script_path="$root/scripts/context/refresh-context-index-on-stop.mjs"
prerequisite_path="$root/scripts/setup/check-prereqs.sh"
dependency_installer_path="$root/scripts/deps/install-compatible.mjs"
pnpm_policy_path="$root/scripts/deps/verify-pnpm-execution-policy.mjs"
license_verifier_path="$root/scripts/verify/licensing.mjs"
framework_doctor_path="$root/scripts/framework/framework-doctor.mjs"
codex_config_validator_path="$root/scripts/setup/validate-codex-config.mjs"
model_policy_validator_path="$root/scripts/setup/validate-codex-model-policy.mjs"
startup_attestation_path="$root/scripts/setup/startup-attestation.mjs"
startup_hook_launcher_path="$root/scripts/setup/verify-startup-attestation-on-session-start.sh"

if [[ -L "$codex_directory" || ! -d "$codex_directory" ]]; then
  echo "Project .codex must be a real directory before Codex can start." >&2
  exit 1
fi
if [[ -L "$config_path" || ! -f "$config_path" ]]; then
  echo "Project .codex/config.toml must be a real file before Codex can start." >&2
  exit 1
fi
if [[ -L "$hooks_path" || ! -f "$hooks_path" ]]; then
  echo "Project .codex/hooks.json must be a real file before Codex can start." >&2
  exit 1
fi
# The input-bound startup-attestation owner creates and validates the private runtime through an
# inode-bound directory descriptor immediately before issuing the repository session lease.
if [[ -L "$hook_launcher_path" || ! -f "$hook_launcher_path" ]]; then
  echo "Project context-index Stop hook launcher must be a real file before Codex can start." >&2
  exit 1
fi
if [[ -L "$hook_script_path" || ! -f "$hook_script_path" ]]; then
  echo "Project context-index Stop hook must be a real file before Codex can start." >&2
  exit 1
fi
if [[ -L "$prerequisite_path" || ! -f "$prerequisite_path" ]]; then
  echo "Project prerequisite check must be a real file before Codex can start." >&2
  exit 1
fi
if [[ -L "$dependency_installer_path" || ! -f "$dependency_installer_path" ]]; then
  echo "Project compatible dependency installer must be a real file before Codex can start." >&2
  exit 1
fi
if [[ -L "$pnpm_policy_path" || ! -f "$pnpm_policy_path" ]]; then
  echo "Project pnpm execution policy must be a real file before Codex can start." >&2
  exit 1
fi
if [[ -L "$license_verifier_path" || ! -f "$license_verifier_path" ]]; then
  echo "Project licensing verifier must be a real file before Codex can start." >&2
  exit 1
fi
if [[ -L "$framework_doctor_path" || ! -f "$framework_doctor_path" ]]; then
  echo "Project framework doctor must be a real file before Codex can start." >&2
  exit 1
fi
if [[ -L "$codex_config_validator_path" || ! -f "$codex_config_validator_path" ]]; then
  echo "Project Codex config validator must be a real file before Codex can start." >&2
  exit 1
fi
if [[ -L "$model_policy_validator_path" || ! -f "$model_policy_validator_path" ]]; then
  echo "Project Codex model-policy validator must be a real file before Codex can start." >&2
  exit 1
fi
if [[ -L "$startup_attestation_path" || ! -f "$startup_attestation_path" ]]; then
  echo "Project startup attestation must be a real file before Codex can start." >&2
  exit 1
fi
if [[ -L "$startup_hook_launcher_path" || ! -f "$startup_hook_launcher_path" ]]; then
  echo "Project SessionStart hook launcher must be a real file before Codex can start." >&2
  exit 1
fi

# The launcher owns every Codex control argument. Prompt tokens are accepted only after `--`, so a
# future CLI option or subcommand cannot silently become a project-policy bypass.
codex_arguments=(--cd "$root")
seen_no_alt_screen=false
seen_yolo=false
after_delimiter=false
for argument in "$@"; do
  if [[ "$after_delimiter" == true ]]; then
    codex_arguments+=("$argument")
    continue
  fi
  case "$argument" in
    --no-alt-screen)
      if [[ "$seen_no_alt_screen" == true ]]; then
        echo "Refusing duplicate launcher control argument." >&2
        exit 64
      fi
      seen_no_alt_screen=true
      codex_arguments+=("--no-alt-screen")
      ;;
    --yolo)
      if [[ "$seen_yolo" == true ]]; then
        echo "Refusing duplicate launcher control argument." >&2
        exit 64
      fi
      seen_yolo=true
      codex_arguments+=("--yolo")
      ;;
    --)
      after_delimiter=true
      codex_arguments+=("--")
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

bash "$script_dir/validate-codex-bootstrap.sh" "$root"
if ! command -v codex >/dev/null 2>&1; then
  echo "Codex CLI is not available on PATH. Install it for the current user:" >&2
  echo "  https://developers.openai.com/codex/cli/" >&2
  exit 127
fi
if ! command -v mise >/dev/null 2>&1; then
  echo "mise is not available on PATH. Install it before this project can refresh packages:" >&2
  echo "  https://mise.jdx.dev/installing-mise.html" >&2
  exit 127
fi

# These values must survive dependency hydration, attestation issuance, the Codex process, and both
# lifecycle hooks. A narrower subshell would leave later pnpm version probes able to load mutable
# repository or user pnpm hooks before the attestation can reject them.
export NPM_CONFIG_IGNORE_PNPMFILE=true
export PNPM_CONFIG_IGNORE_PNPMFILE=true
export npm_config_ignore_pnpmfile=true
export pnpm_config_ignore_pnpmfile=true

env -u CODEX_HOME codex update
(
  cd "$root"
  env -u CODEX_HOME mise install --locked
  env -u CODEX_HOME mise exec --locked -- node scripts/deps/verify-pnpm-execution-policy.mjs
  env -u CODEX_HOME mise exec --locked -- bash scripts/setup/check-prereqs.sh
  env -u CODEX_HOME mise exec --locked -- node scripts/deps/install-compatible.mjs
  env -u CODEX_HOME mise exec --locked -- node scripts/setup/validate-codex-config.mjs
  env -u CODEX_HOME mise exec --locked -- node scripts/setup/validate-codex-model-policy.mjs
  env -u CODEX_HOME mise exec --locked -- node scripts/verify/licensing.mjs
  env -u CODEX_HOME mise exec --locked -- node scripts/framework/framework-doctor.mjs --online
)
startup_nonce="$(
  cd "$root"
  env -u CODEX_HOME CODEXRIG_STARTUP_CONTROL_POLICY="$startup_control_policy" mise exec --locked -- node scripts/setup/startup-attestation.mjs issue --session-pid "$$"
)"
if [[ ! "$startup_nonce" =~ ^[A-Za-z0-9_-]{40,128}$ ]]; then
  echo "Project startup attestation did not produce a valid nonce." >&2
  exit 1
fi
exec env \
  CODEX_HOME="$runtime_directory" \
  CODEXRIG_PROJECT_ROOT="$root" \
  CODEXRIG_STARTUP_CONTROL_POLICY="$startup_control_policy" \
  CODEXRIG_STARTUP_NONCE="$startup_nonce" \
  codex "${codex_arguments[@]}"
