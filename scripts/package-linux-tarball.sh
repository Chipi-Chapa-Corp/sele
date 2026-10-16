#!/usr/bin/env bash

set -euo pipefail

readonly app_dir="${1:-dist/linux-unpacked}"
readonly archive_path="${2:-dist/sele-linux-x64.tar.gz}"

if [[ ! -x "$app_dir/sele" || ! -f "$app_dir/resources/app.asar" ]]; then
  echo "Unpacked Sele executable or resources missing: $app_dir" >&2
  exit 1
fi

# Preserve the original release layout expected by downstream installers.
tar -czf "$archive_path" -C "$app_dir" .
