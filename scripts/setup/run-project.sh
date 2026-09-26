#!/usr/bin/env bash
# Owns run project bootstrap before Mise or a package manager can consult host configuration.
set -euo pipefail
unset BASH_ENV ENV NODE_OPTIONS NODE_PATH
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec node "$script_dir/project-command.mjs" -- "$@"
