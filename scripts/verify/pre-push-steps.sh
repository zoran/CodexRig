#!/bin/sh
set -eu

unset BASH_ENV ENV NODE_OPTIONS NODE_PATH
script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
root="$(cd "$script_dir/../.." && pwd -P)"
cd "$root"

while [ "${1:-}" = "--" ]; do
  shift
done

remote_name="${1:-}"
remote_url="${2:-}"

refs_file="$(mktemp)"
trap 'rm -f "$refs_file"' EXIT
if [ ! -t 0 ]; then
  cat >"$refs_file"
fi

if [ -n "$remote_url" ]; then
  echo "Validating the target push remote."
  node scripts/verify/git-remote-identity.mjs \
    --remote-name "$remote_name" \
    --remote-url "$remote_url"
else
  echo "Validating configured push remotes for direct invocation."
  node scripts/verify/git-remote-identity.mjs
fi

reset_script=".agents/skills/reset-framework/scripts/reset-framework.mjs"
source_framework_contract=".codexrig/framework.json"
generated_installation_receipt=".codexrig/installation.json"
if [ -f "$source_framework_contract" ] && [ ! -e "$generated_installation_receipt" ]; then
  if [ ! -f "$reset_script" ]; then
    echo "Source-framework pre-push requires the reset boundary." >&2
    exit 1
  fi
  echo "Confirming that the source framework contains no resettable local state."
  node "$reset_script"
fi

echo "Validating that pre-push checks read the exact pushed commit from a clean checkout."
node scripts/verify/adaptive.mjs --validate-pre-push-refs <"$refs_file"

echo "Scanning every newly introduced commit and changed blob in the pushed ref ranges."
node scripts/verify/pushed-object-scan.mjs <"$refs_file"

echo "Validating exact-current successful verification evidence."
node scripts/verify/adaptive.mjs --mode pre-push

echo "Revalidating the pushed commit and clean checkout after every helper."
node scripts/verify/adaptive.mjs --validate-pre-push-refs <"$refs_file"

echo "Pre-push verification passed."
