#!/bin/sh
set -eu

unset BASH_ENV ENV NODE_OPTIONS NODE_PATH
script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
root="$(cd "$script_dir/../.." && pwd -P)"
echo "Refreshing a content-identical committed Git basis without rerunning verifiers."
node "$root/scripts/verify/adaptive.mjs" --mode repo --basis-only </dev/null
exec node "$root/scripts/verify/verification-session-lock.mjs" \
  --hold sh "$root/scripts/verify/pre-push-steps.sh" "$@"
