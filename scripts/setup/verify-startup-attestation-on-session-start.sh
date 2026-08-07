#!/usr/bin/env bash
set -euo pipefail

failure='{"continue":false,"stopReason":"CodexRig startup verification could not run. Start with bash scripts/setup/start-codex.sh.","systemMessage":"CodexRig startup verification could not run. Start with bash scripts/setup/start-codex.sh."}'

if [[ -z "${CODEXRIG_PROJECT_ROOT:-}" || -L "$CODEXRIG_PROJECT_ROOT" || ! -d "$CODEXRIG_PROJECT_ROOT" ]]; then
  printf '%s\n' "$failure"
  exit 0
fi
root="$(cd -- "$CODEXRIG_PROJECT_ROOT" && pwd -P)"
expected_codex_home="$root/.codex/runtime"
if [[ -z "${CODEX_HOME:-}" || -L "$CODEX_HOME" || ! -d "$CODEX_HOME" ]]; then
  printf '%s\n' "$failure"
  exit 0
fi
codex_home="$(cd -- "$CODEX_HOME" && pwd -P)"
if [[ "$codex_home" != "$expected_codex_home" ]]; then
  printf '%s\n' "$failure"
  exit 0
fi
verifier="$root/scripts/setup/startup-attestation.mjs"
if [[ -L "$verifier" || ! -f "$verifier" ]] || ! command -v mise >/dev/null 2>&1; then
  printf '%s\n' "$failure"
  exit 0
fi
cd "$root"
exec mise exec --locked -- node scripts/setup/startup-attestation.mjs verify
