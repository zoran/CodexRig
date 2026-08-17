#!/usr/bin/env bash
# Owns install git hooks behavior for the setup, launch, and portable project boundary.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
root="$(cd "$script_dir/../.." && pwd -P)"
exec node "$root/scripts/setup/install-git-hooks.mjs"
