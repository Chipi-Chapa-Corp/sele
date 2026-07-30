#!/usr/bin/env bash

set -euo pipefail

readonly app_id='com.chipichapa.sele'
readonly branch='stable'
readonly arch='x86_64'
readonly repo_url='https://chipi-chapa-corp.github.io/sele/flatpak'
readonly runtime_repo_url='https://dl.flathub.org/repo/flathub.flatpakrepo'
readonly bundle_path="${1:-dist/sele-linux-x64.flatpak}"
readonly pages_root="${2:-dist/flatpak-pages}"
readonly repo_dir="${pages_root}/flatpak"

if [[ ! -f "$bundle_path" ]]; then
  echo "Flatpak bundle not found: $bundle_path" >&2
  exit 1
fi

mkdir -p "$pages_root"
if [[ ! -f "$repo_dir/config" ]]; then
  ostree init --repo="$repo_dir" --mode=archive-z2
fi

flatpak build-import-bundle --update-appstream "$repo_dir" "$bundle_path"
flatpak build-update-repo \
  --title='Sele' \
  --comment='Stable releases of Sele' \
  --description='Stable Flatpak releases of the Sele desktop AI harness' \
  --homepage='https://github.com/Chipi-Chapa-Corp/sele' \
  --icon="${repo_url}/sele.png" \
  --default-branch="$branch" \
  --generate-static-deltas \
  "$repo_dir"

cp build/sele.flatpakrepo build/sele.flatpakref "$repo_dir/"
cp build/icon.png "$repo_dir/sele.png"
touch "$pages_root/.nojekyll"

temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

flatpak build-bundle \
  --arch="$arch" \
  --repo-url="$repo_url" \
  --runtime-repo="$runtime_repo_url" \
  "$repo_dir" \
  "$temp_dir/sele.flatpak" \
  "$app_id" \
  "$branch"

mv "$temp_dir/sele.flatpak" "$bundle_path"
