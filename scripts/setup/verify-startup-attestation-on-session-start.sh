#!/usr/bin/env bash
# Owns verify startup attestation on session start behavior for the setup, launch, and portable project boundary.
set -euo pipefail

failure='{"continue":false,"stopReason":"CodexRig startup verification could not run. Start with bash scripts/setup/start-codex.sh.","systemMessage":"CodexRig startup verification could not run. Start with bash scripts/setup/start-codex.sh."}'

launcher="${BASH_SOURCE[0]}"
launcher_directory="${launcher%/*}"
if [[ "$launcher_directory" == "$launcher" ]]; then launcher_directory="."; fi
if [[ -L "$launcher" || ! -f "$launcher" ]] ||
  ! setup_directory="$(cd -- "$launcher_directory" && pwd -P)" ||
  ! root="$(cd -- "$setup_directory/../.." && pwd -P)"; then
  printf '%s\n' "$failure"
  exit 0
fi
if [[ -n "${CODEXRIG_PROJECT_ROOT:-}" ]]; then
  if [[ -L "$CODEXRIG_PROJECT_ROOT" || ! -d "$CODEXRIG_PROJECT_ROOT" ]] ||
    ! declared_root="$(cd -- "$CODEXRIG_PROJECT_ROOT" && pwd -P)" ||
    [[ "$declared_root" != "$root" ]]; then
    printf '%s\n' "$failure"
    exit 0
  fi
fi
expected_codex_home="$root/.codex/runtime"
if [[ -z "${CODEX_HOME:-}" || -L "$CODEX_HOME" || ! -d "$CODEX_HOME" ]]; then
  printf '%s\n' "$failure"
  exit 0
fi
if ! codex_home="$(cd -- "$CODEX_HOME" && pwd -P)"; then
  printf '%s\n' "$failure"
  exit 0
fi
if [[ "$codex_home" != "$expected_codex_home" ]]; then
  printf '%s\n' "$failure"
  exit 0
fi
dispatcher="$codex_home/cache/codexrig/startup-hook-dispatcher.mjs"
if [[ -L "$dispatcher" || ! -f "$dispatcher" ]] || ! command -v mise >/dev/null 2>&1; then
  printf '%s\n' "$failure"
  exit 0
fi
cd "$root"
exec env \
  CODEX_HOME="$codex_home" \
  CODEXRIG_PROJECT_ROOT="$root" \
  NPM_CONFIG_IGNORE_PNPMFILE=true \
  PNPM_CONFIG_IGNORE_PNPMFILE=true \
  npm_config_ignore_pnpmfile=true \
  pnpm_config_ignore_pnpmfile=true \
  mise exec --locked -- node "$dispatcher" session-start
