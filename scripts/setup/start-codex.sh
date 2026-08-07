#!/usr/bin/env bash
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
framework_doctor_path="$root/scripts/framework/framework-doctor.mjs"
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
if [[ -e "$runtime_directory" || -L "$runtime_directory" ]]; then
  if [[ -L "$runtime_directory" || ! -d "$runtime_directory" ]]; then
    echo "Project .codex/runtime must be a real directory before Codex can start." >&2
    exit 1
  fi
else
  mkdir -m 700 "$runtime_directory"
fi
chmod 700 "$runtime_directory"
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
if [[ -L "$framework_doctor_path" || ! -f "$framework_doctor_path" ]]; then
  echo "Project framework doctor must be a real file before Codex can start." >&2
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
startup_control_policy="interactive-v1:none"
seen_no_alt_screen=false
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
      startup_control_policy="interactive-v1:no-alt-screen"
      codex_arguments+=("--no-alt-screen")
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

env -u CODEX_HOME codex update
(
  cd "$root"
  env -u CODEX_HOME mise install --locked
  env -u CODEX_HOME mise exec --locked -- bash scripts/setup/check-prereqs.sh
  env -u CODEX_HOME mise exec --locked -- node scripts/deps/install-compatible.mjs
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
