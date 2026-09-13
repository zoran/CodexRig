#!/usr/bin/env bash
# Owns check prereqs behavior for the setup, launch, and portable project boundary.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
root="$(cd "$script_dir/../.." && pwd -P)"
if ! command -v node >/dev/null 2>&1; then
  echo "Bootstrap Node.js is unavailable. Run mise install --locked and use mise exec --locked." >&2
  exit 1
fi
required_node_version="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).stable.node.version' "$root/.codex/toolchain.json")"
required_pnpm_version="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).stable.pnpm.version' "$root/.codex/toolchain.json")"
if [[ ! "$required_node_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ || ! "$required_pnpm_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "The compatibility matrix has invalid runtime versions." >&2
  exit 1
fi
missing_system=()
runtime_issues=()
optional_missing=()
check_codex=0

for argument in "$@"; do
  case "$argument" in
    --codex) check_codex=1 ;;
    --help | -h)
      echo "Usage: bash scripts/setup/check-prereqs.sh [--codex]"
      exit 0
      ;;
    *)
      echo "Unknown prerequisite option: $argument" >&2
      exit 2
      ;;
  esac
done

require_system_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    missing_system+=("$1")
  fi
}

for command_name in bash git rg shellcheck; do
  require_system_command "$command_name"
done

if ! command -v mise >/dev/null 2>&1; then
  runtime_issues+=("mise")
fi
if command -v node >/dev/null 2>&1; then
  node_version="$(node --version 2>/dev/null || true)"
  if [[ "$node_version" != "v${required_node_version}" ]]; then
    runtime_issues+=("node@${required_node_version}")
  fi
else
  runtime_issues+=("node@${required_node_version}")
fi

if command -v pnpm >/dev/null 2>&1; then
  pnpm_version="$(pnpm --version 2>/dev/null || true)"
  if [[ "$pnpm_version" != "$required_pnpm_version" ]]; then
    runtime_issues+=("pnpm@${required_pnpm_version}")
  fi
else
  runtime_issues+=("pnpm@${required_pnpm_version}")
fi

if ((check_codex)) && ! command -v codex >/dev/null 2>&1; then
  optional_missing+=("codex (system-wide host CLI)")
fi

if ((
  "${#missing_system[@]}" == 0 &&
    "${#runtime_issues[@]}" == 0 &&
    "${#optional_missing[@]}" == 0
)); then
  echo "Prerequisite check passed."
  exit 0
fi

if (("${#runtime_issues[@]}" > 0)); then
  cat >&2 <<'EOF'
Project runtimes are missing, mismatched, or inactive. This check is read-only.

Install or activate mise, then install the repository-locked runtimes:
  mise install --locked

Run project commands inside that exact runtime environment:
  mise exec --locked -- bash scripts/setup/check-prereqs.sh

Install or update the host CLI through the official Codex installation path. Prepare the locked
project runtime and compatible dependencies explicitly, then start the isolated session:
  https://developers.openai.com/codex/cli/
  mise install --locked
  mise exec --locked -- node scripts/deps/install-compatible.mjs
  bash scripts/setup/start-codex.sh

Locked runtime platforms: Linux x64/arm64 (glibc and musl), macOS arm64, and Windows x64.
Intel macOS is not supported because pnpm 11 has no Darwin x64 standalone artifact.
EOF
  printf '\nRuntime issues:\n' >&2
  printf '  - %s\n' "${runtime_issues[@]}" >&2
fi

if (("${#missing_system[@]}" > 0)); then
  cat >&2 <<'EOF'
Missing required system tools.

Host tools:
  Codex CLI: https://developers.openai.com/codex/cli/
  mise:      https://mise.jdx.dev/installing-mise.html

System package commands:
  Debian/Ubuntu: sudo apt-get install -y git ripgrep shellcheck
  Fedora:        sudo dnf install -y git ripgrep ShellCheck
  Homebrew (macOS arm64): brew install git ripgrep shellcheck
EOF
  printf '\nMissing system tools:\n' >&2
  printf '  - %s\n' "${missing_system[@]}" >&2
fi

if (("${#optional_missing[@]}" > 0)); then
  printf '\nMissing for requested optional workflows:\n' >&2
  printf '  - %s\n' "${optional_missing[@]}" >&2
fi
exit 1
