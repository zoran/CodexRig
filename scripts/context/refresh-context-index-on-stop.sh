#!/usr/bin/env bash
# Owns the durable Stop continuation, terminal handover, and context refresh adapter.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
root="$(cd "$script_dir/../.." && pwd -P)"

cd "$root"

failure_message='{"systemMessage":"Automatic context index refresh failed. Run pnpm context:index before relying on semantic retrieval."}'
if [[ -n "${CODEXRIG_PROJECT_ROOT:-}" ]]; then
  expected_root="$(cd -- "$CODEXRIG_PROJECT_ROOT" 2>/dev/null && pwd -P)" || {
    printf '%s\n' "$failure_message"
    exit 0
  }
  if [[ "$expected_root" != "$root" || -z "${CODEX_HOME:-}" ]]; then
    printf '%s\n' "$failure_message"
    exit 0
  fi
  dispatcher="$CODEX_HOME/cache/codexrig/startup-hook-dispatcher.mjs"
  if [[ -L "$dispatcher" || ! -f "$dispatcher" ]]; then
    printf '%s\n' "$failure_message"
    exit 0
  fi
  exec env \
    NPM_CONFIG_IGNORE_PNPMFILE=true \
    PNPM_CONFIG_IGNORE_PNPMFILE=true \
    npm_config_ignore_pnpmfile=true \
    pnpm_config_ignore_pnpmfile=true \
    mise exec --locked -- node "$dispatcher" stop
fi

# Direct diagnostics outside a canonical Codex session retain the portable lifecycle entry point.
output=""
if ! output="$(
  env \
    -u CONTEXT_INDEX_DIRECTORY \
    -u CONTEXT_INDEX_DOCS_ONLY \
    -u CONTEXT_INDEX_EMBEDDING_BATCH_SIZE \
    -u CONTEXT_INDEX_LOCK_TIMEOUT_MS \
    -u CONTEXT_INDEX_MAX_FILE_BYTES \
    -u CONTEXT_INDEX_MAX_SOURCE_FILES \
    -u CONTEXT_INDEX_MAX_TOTAL_BYTES \
    -u CONTEXT_INDEX_MODEL_CACHE \
    -u CONTEXT_INDEX_OFFLINE \
    -u CONTEXT_INDEX_ONNX_THREADS \
    -u CONTEXT_INDEX_ROOT \
    -u CONTEXT_INDEX_SANITIZED_WORKER \
    -u CONTEXT_INDEX_STALE_LOCK_MS \
    -u CONTEXT_INDEX_TEST_MODE \
    -u CONTEXT_INDEX_TRACKED_ONLY \
    NPM_CONFIG_IGNORE_PNPMFILE=true \
    PNPM_CONFIG_IGNORE_PNPMFILE=true \
    npm_config_ignore_pnpmfile=true \
    pnpm_config_ignore_pnpmfile=true \
    mise exec --locked -- node scripts/context/refresh-context-index-on-stop.mjs 2>/dev/null
)"; then
  printf '%s\n' "$failure_message"
  exit 0
fi
if [[ -n "$output" ]]; then
  printf '%s\n' "$output"
fi
exit 0
