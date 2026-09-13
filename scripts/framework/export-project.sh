#!/usr/bin/env bash
# Owns export project behavior for the setup, launch, and portable project boundary.
set -euo pipefail

if ! command -v tar >/dev/null 2>&1 || [[ "$(tar --version 2>/dev/null | head -n 1)" != *"GNU tar"* ]]; then
  echo "GNU tar with deterministic archive options is required for project export" >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
root="$(cd "$script_dir/../.." && pwd -P)"
cd "$root"

if [[ "${1:-}" == "--" ]]; then shift; fi
project_name=""
project_description=""
output=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name|--description|--output)
      if [[ $# -lt 2 ]]; then echo "Missing value for $1" >&2; exit 1; fi
      case "$1" in
        --name) project_name="$2" ;;
        --description) project_description="$2" ;;
        --output) output="$2" ;;
      esac
      shift 2 ;;
    *) echo "Usage: pnpm project:export -- --name '<project-name>' [--description '<description>'] [--output dist/exports/<name>.tar.gz]" >&2; exit 1 ;;
  esac
done
if [[ -z "$project_name" ]]; then echo "Project export requires --name." >&2; exit 1; fi
archive_root="$(node --input-type=module - "$project_name" <<'NODE'
import { normalizedName, slugify } from "./scripts/framework/project-options.mjs";
process.stdout.write(slugify(normalizedName(process.argv[2]), "archive name"));
NODE
)"
output="${output:-dist/exports/$archive_root.tar.gz}"
if [[ "$output" == /* || "$output" == ~* || "$output" =~ ^[A-Za-z]:[\\/] ]]; then
  echo "Project export output path must be repository-relative." >&2
  exit 1
fi
if [[ "$output" == ".." || "$output" == ../* || "$output" == */.. || "$output" == */../* ]]; then
  echo "Project export output path must stay inside this repository." >&2
  exit 1
fi
if [[ "$output" != dist/exports/*.tar.gz || "$output" == "dist/exports/.tar.gz" ]]; then
  echo "Project exports must use a named .tar.gz file under dist/exports/." >&2
  exit 1
fi
output_dir="$(dirname -- "$output")"
existing_parent="$output_dir"
while [[ ! -e "$existing_parent" ]]; do
  next_parent="$(dirname -- "$existing_parent")"
  if [[ "$next_parent" == "$existing_parent" ]]; then
    echo "Project export output has no existing repository parent." >&2
    exit 1
  fi
  existing_parent="$next_parent"
done
if [[ -L "$existing_parent" ]]; then
  echo "Project export output parent must not be a symlink." >&2
  exit 1
fi
existing_parent_real="$(cd "$existing_parent" && pwd -P)"
case "$existing_parent_real" in
  "$root" | "$root"/*) ;;
  *)
    echo "Project export output parent must resolve inside this repository." >&2
    exit 1
    ;;
esac
mkdir -p "$output_dir"
output_dir_real="$(cd "$output_dir" && pwd -P)"
case "$output_dir_real" in
  "$root" | "$root"/*) ;;
  *)
    echo "Project export output directory must resolve inside this repository." >&2
    exit 1
    ;;
esac
if [[ -e "$output" || -L "$output" ]]; then
  echo "Project export output already exists; refusing to overwrite it." >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

stage="$tmp/$archive_root"

if [[ -L .codex || -L .codex/README.md || -L .codex/config.toml || -L .codex/hooks.json ]]; then
  echo ".codex and its portable config, hooks, and README must not be symlinks" >&2
  exit 1
fi

node scripts/framework/stage-project-export.mjs "$stage" "$project_name" "$project_description"

archive_tmp="$(mktemp "$output_dir/.project-export.XXXXXX")"
trap 'rm -rf "$tmp"; rm -f -- "$archive_tmp"' EXIT
LC_ALL=C TZ=UTC tar \
  --sort=name \
  --format=posix \
  --pax-option=delete=atime,delete=ctime \
  --mtime=@0 \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  --mode=u+rw,go-w \
  -C "$tmp" \
  -czf "$archive_tmp" \
  "$archive_root"
if ! ln -- "$archive_tmp" "$output"; then
  echo "Project export output appeared concurrently; refusing to overwrite it." >&2
  exit 1
fi
rm -f -- "$archive_tmp"

echo "Exported clean project archive: $output"
