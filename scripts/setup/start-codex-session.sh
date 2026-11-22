#!/usr/bin/env bash
# Owns start codex session preflight and controller launch inside the repository-local Mise environment.
set -euo pipefail

if [[ "$#" != 1 || "${CODEX_HOME:-}" != "$PWD" ]]; then
  echo "Use the canonical start-codex.sh launcher for repository-bound session startup." >&2
  exit 64
fi
case "$1" in
  interactive-v2:safe-defaults | interactive-v2:no-alt-screen | yolo-v2:default-screen | yolo-v2:no-alt-screen) ;;
  *) exit 64 ;;
esac

printf '\n  [5/5] Checking session prerequisites and project policy.\n'
node scripts/deps/verify-pnpm-execution-policy.mjs
bash scripts/setup/check-prereqs.sh --session
node scripts/setup/validate-codex-model-policy.mjs
pnpm tooling:doctor || {
  doctor_status=$?
  if ((doctor_status >= 128)); then exit "$doctor_status"; fi
  printf '\n  [WARN] Project diagnostics failed. Continuing to the session picker for repair.\n' >&2
}
codex_executable="$(node --input-type=module -e 'import {projectManagedToolLayout} from "./scripts/repository/project-tool-executables.mjs"; console.log(projectManagedToolLayout(process.cwd()).codex.executable)')"
printf '\n  [OK] Opening Codex session picker.\n\n'
exec node scripts/framework/framework-session.mjs \
  --control-policy "$1" --codex-executable "$codex_executable"
