#!/usr/bin/env bash
# Owns validate codex bootstrap behavior for the setup, launch, and portable project boundary.
set -euo pipefail

root="${1:-}"
if [[ -z "$root" || "$root" != /* ]]; then
  echo "Codex bootstrap validation requires an absolute project root." >&2
  exit 64
fi

config_path="$root/.codex/config.toml"
hooks_path="$root/.codex/hooks.json"
gitignore_path="$root/.gitignore"
hook_launcher_path="$root/scripts/context/refresh-context-index-on-stop.sh"
hook_script_path="$root/scripts/context/refresh-context-index-on-stop.mjs"
startup_attestation_path="$root/scripts/setup/startup-attestation.mjs"
startup_hook_launcher_path="$root/scripts/setup/verify-startup-attestation-on-session-start.sh"
if [[ -L "$config_path" || ! -f "$config_path" ]]; then
  echo "Project .codex/config.toml must be a real file before Codex can start." >&2
  exit 1
fi
if [[ -L "$hooks_path" || ! -f "$hooks_path" ]]; then
  echo "Project .codex/hooks.json must be a real file before Codex can start." >&2
  exit 1
fi
# The canonical launcher pins Codex's working directory to this root before project hooks run.
expected_hooks_json='{
  "description": "Verify canonical startup, announce safe recovery metadata, and coordinate durable Stop continuation, terminal handover, and context refresh.",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "^(startup|resume)$",
        "hooks": [
          {
            "type": "command",
            "command": "bash scripts/setup/verify-startup-attestation-on-session-start.sh",
            "timeout": 30,
            "statusMessage": "Verifying CodexRig startup",
            "additionalContextLimit": 768
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash scripts/context/refresh-context-index-on-stop.sh",
            "timeout": 600,
            "statusMessage": "Finalizing CodexRig Stop lifecycle"
          }
        ]
      }
    ]
  }
}'
if [[ "$(<"$hooks_path")" != "$expected_hooks_json" ]]; then
  echo "Project .codex/hooks.json must contain exactly the supported SessionStart and Stop hooks." >&2
  exit 1
fi
if [[ -L "$gitignore_path" || ! -f "$gitignore_path" ]]; then
  echo "Root-bound Codex runtime ignore policy must be a real file before Codex can start." >&2
  exit 1
fi
if [[ -L "$hook_launcher_path" || ! -f "$hook_launcher_path" ]]; then
  echo "Project context-index Stop hook launcher must be a real file before Codex can start." >&2
  exit 1
fi
if [[ -L "$hook_script_path" || ! -f "$hook_script_path" ]]; then
  echo "Project context-index Stop hook must be a real file before Codex can start." >&2
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

gitignore_has_exact_line() {
  local expected="$1"
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" == "$expected" ]] && return 0
  done < "$gitignore_path"
  return 1
}

required_codex_ignore_patterns=(
  '/.tmp'
  '/cache'
  '/log'
  '/logs'
  '/memories'
  '/plugins'
  '/rules'
  '/sessions'
  '/shell_snapshots'
  '/skills'
  '/thread-writer-locks'
  '/tmp'
  '/.sandbox_migration'
  '/auth.json'
  '/config.toml'
  '/history.jsonl'
  '/installation_id'
  '/models_cache.json'
  '/version.json'
  '/goals_*.sqlite*'
  '/logs_*.sqlite*'
  '/memories_*.sqlite*'
  '/queue_*.sqlite*'
  '/state_*.sqlite*'
  '/thread_history_*.sqlite*'
  '.codex/*'
  '!.codex/'
  '!.codex/config.toml'
  '!.codex/hooks.json'
  '!.codex/README.md'
  '!.codex/agents/'
  '.codex/agents/*'
  '!.codex/agents/*.toml'
)
for required_pattern in "${required_codex_ignore_patterns[@]}"; do
  if ! gitignore_has_exact_line "$required_pattern"; then
    echo "Root-bound Codex runtime ignore policy is incomplete." >&2
    exit 1
  fi
done

runtime_probe_paths=(
  '.tmp'
  '.tmp/runtime-state'
  'cache'
  'cache/runtime-state'
  'log'
  'log/runtime-state'
  'logs'
  'logs/runtime-state'
  'memories'
  'memories/runtime-state'
  'plugins'
  'plugins/runtime-state'
  'rules'
  'rules/runtime-state'
  'sessions'
  'sessions/runtime-state'
  'shell_snapshots'
  'shell_snapshots/runtime-state'
  'skills'
  'skills/runtime-state'
  'thread-writer-locks'
  'thread-writer-locks/runtime-state'
  'tmp'
  'tmp/runtime-state'
  '.sandbox_migration'
  'auth.json'
  'config.toml'
  'history.jsonl'
  'installation_id'
  'models_cache.json'
  'version.json'
  'goals_1.sqlite'
  'goals_1.sqlite-shm'
  'goals_1.sqlite-wal'
  'logs_1.sqlite'
  'logs_1.sqlite-shm'
  'logs_1.sqlite-wal'
  'memories_1.sqlite'
  'memories_1.sqlite-shm'
  'memories_1.sqlite-wal'
  'queue_1.sqlite'
  'queue_1.sqlite-shm'
  'queue_1.sqlite-wal'
  'state_1.sqlite'
  'state_1.sqlite-shm'
  'state_1.sqlite-wal'
  'thread_history_1.sqlite'
  'thread_history_1.sqlite-shm'
  'thread_history_1.sqlite-wal'
  'rules/default.rules'
  '.codex/auth.json'
  '.codex/cache/runtime-state'
  '.codex/sessions/runtime-state'
  '.codex/skills/runtime-state'
  '.codex/agents/extra.json'
  '.codex/agents/nested/extra.toml'
)
portable_probe_paths=(
  '.codex/README.md'
  '.codex/config.toml'
  '.codex/hooks.json'
  '.codex/agents/default.toml'
)

temporary_git_root=""
cleanup_ignore_probe() {
  if [[ -n "$temporary_git_root" && -d "$temporary_git_root" && ! -L "$temporary_git_root" ]]; then
    rm -rf -- "$temporary_git_root"
  fi
}
trap cleanup_ignore_probe EXIT
if ! command -v git >/dev/null 2>&1; then
  echo "Root-bound Codex runtime ignore policy requires Git." >&2
  exit 1
fi
temporary_git_root="$(mktemp -d "${TMPDIR:-/tmp}/codex-ignore-contract.XXXXXX")" || {
  echo "Root-bound Codex runtime ignore policy could not create an isolated probe." >&2
  exit 1
}
if ! GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
  git init --bare --quiet "$temporary_git_root/git" >/dev/null 2>&1; then
  echo "Root-bound Codex runtime ignore policy could not initialize its isolated probe." >&2
  exit 1
fi
is_effectively_ignored() {
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    git --git-dir="$temporary_git_root/git" --work-tree="$root" \
      -c core.excludesFile= check-ignore --no-index --quiet -- "$1" >/dev/null 2>&1
}
for runtime_probe in "${runtime_probe_paths[@]}"; do
  if ! is_effectively_ignored "$runtime_probe"; then
    echo "Root-bound Codex runtime ignore policy is ineffective." >&2
    exit 1
  fi
done
for portable_probe in "${portable_probe_paths[@]}"; do
  if is_effectively_ignored "$portable_probe"; then
    echo "Portable project Codex configuration is unexpectedly ignored." >&2
    exit 1
  fi
done

allowed=(
  developer_instructions
  project_doc_max_bytes
  project_doc_fallback_filenames
  model_reasoning_effort
  model_verbosity
  web_search
  model
  service_tier
  approvals_reviewer
  approval_policy
  sandbox_mode
  sandbox_workspace_write.network_access
  agents.enabled
  agents.default_subagent_model
  agents.default_subagent_reasoning_effort
  agents.max_concurrent_threads_per_session
  agents.interrupt_message
  features.hooks
  features.memories
  features.network_proxy
  features.prevent_idle_sleep
  tui.status_line
  tui.status_line_use_colors
  tui.terminal_title
  tui.theme
)
required=()
seen=()
seen_tables=()

contains_value() {
  local expected="$1"
  shift
  local candidate
  for candidate in "$@"; do
    [[ "$candidate" == "$expected" ]] && return 0
  done
  return 1
}

for key in "${allowed[@]}"; do
  if [[ "$key" != "service_tier" ]]; then
    required[${#required[@]}]="$key"
  fi
done

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

table=""
multiline_key=""
line_number=0
while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
  line_number=$((line_number + 1))
  if [[ -n "$multiline_key" ]]; then
    if [[ "$(trim "$raw_line")" == '"""' ]]; then
      multiline_key=""
    fi
    continue
  fi
  line="$(trim "${raw_line%%#*}")"
  [[ -n "$line" ]] || continue

  if [[ "$line" =~ ^\[([A-Za-z_][A-Za-z0-9_-]*)\]$ ]]; then
    table="${BASH_REMATCH[1]}"
    case "$table" in
      agents | features | sandbox_workspace_write | tui) ;;
      *)
        echo "Project Codex config line $line_number defines an unsupported table." >&2
        exit 1
        ;;
    esac
    if contains_value "$table" "${seen_tables[@]}"; then
      echo "Project Codex config line $line_number duplicates table $table." >&2
      exit 1
    fi
    seen_tables[${#seen_tables[@]}]="$table"
    continue
  fi
  if [[ "$line" == \[* ]]; then
    echo "Project Codex config line $line_number defines an unsupported table." >&2
    exit 1
  fi

  if [[ ! "$line" =~ ^([A-Za-z_][A-Za-z0-9_-]*)[[:space:]]*=(.*)$ ]]; then
    echo "Project Codex config line $line_number is not a supported assignment." >&2
    exit 1
  fi
  local_key="${BASH_REMATCH[1]}"
  value="$(trim "${BASH_REMATCH[2]}")"
  if [[ -z "$value" ]]; then
    echo "Project Codex config line $line_number has no value." >&2
    exit 1
  fi
  full_key="${table:+$table.}$local_key"
  if ! contains_value "$full_key" "${allowed[@]}"; then
    echo "Project Codex config line $line_number uses unsupported key $full_key." >&2
    exit 1
  fi
  if contains_value "$full_key" "${seen[@]}"; then
    echo "Project Codex config line $line_number duplicates key $full_key." >&2
    exit 1
  fi
  if [[ "$value" == '"""' ]]; then
    if [[ "$full_key" != "developer_instructions" ]]; then
      echo "Project Codex config line $line_number uses an unsupported multiline value." >&2
      exit 1
    fi
    seen[${#seen[@]}]="$full_key"
    multiline_key="$full_key"
    continue
  fi
  if [[ "$full_key" == "developer_instructions" ]]; then
    echo "Project Codex config developer_instructions must use a multiline basic string." >&2
    exit 1
  fi
  if [[ "$full_key" == "features.hooks" && "$value" != "true" ]]; then
    echo "Project Codex config must enable lifecycle hooks." >&2
    exit 1
  fi
  seen[${#seen[@]}]="$full_key"
done < "$config_path"

if [[ -n "$multiline_key" ]]; then
  echo "Project Codex config has unterminated developer_instructions." >&2
  exit 1
fi

for key in "${required[@]}"; do
  if ! contains_value "$key" "${seen[@]}"; then
    echo "Project Codex config is missing required key $key." >&2
    exit 1
  fi
done
