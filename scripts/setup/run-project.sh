#!/usr/bin/env bash
# Owns run project bootstrap before Mise or a package manager can consult host configuration.
# Enter with bash -p: Bash startup files/functions run before an in-script unset can protect them.
set -euo pipefail
unset BASH_ENV ENV NODE_OPTIONS NODE_PATH
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec node "$script_dir/project-command.mjs" -- "$@"
