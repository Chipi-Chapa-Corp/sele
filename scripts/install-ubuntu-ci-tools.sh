#!/usr/bin/env bash
set -euo pipefail

# Use Ubuntu's signed repositories directly, rather than the hosted runner's
# Azure mirror list or unrelated third-party repositories. Keep changes local
# to these apt commands; do not rewrite the runner's system configuration.
release_file="${SELE_OS_RELEASE_FILE:-/etc/os-release}"
distribution="$(sed -n 's/^ID=//p' "$release_file" | tr -d '"')"
codename="$(sed -n 's/^VERSION_CODENAME=//p' "$release_file" | tr -d '"')"
[[ "$distribution" == ubuntu && "$codename" =~ ^[a-z][a-z0-9]*$ ]] || {
  echo 'This CI installer requires Ubuntu with a release codename.' >&2
  exit 1
}
architecture="$(dpkg --print-architecture)"
archive='https://archive.ubuntu.com/ubuntu'
security='https://security.ubuntu.com/ubuntu'
if [[ "$architecture" != amd64 ]]; then
  archive='https://ports.ubuntu.com/ubuntu-ports'
  security="$archive"
fi
sources="$(mktemp --suffix=.sources)"
trap 'rm -- "$sources"' EXIT
cat > "$sources" <<EOF
Types: deb
URIs: $archive
Suites: $codename $codename-updates
Components: main universe
Architectures: $architecture
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: $security
Suites: $codename-security
Components: main universe
Architectures: $architecture
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF
options=(
  -o "Dir::Etc::sourcelist=$sources"
  -o 'Dir::Etc::sourceparts=-'
  -o 'APT::Get::List-Cleanup=0'
  -o 'APT::Update::Error-Mode=any'
  -o 'Acquire::Retries=1'
  -o 'Acquire::http::Timeout=15'
  -o 'Acquire::https::Timeout=15'
)
packages=("$@")
if [[ ${#packages[@]} == 0 ]]; then packages=(flatpak); fi
for attempt in 1 2 3; do
  if sudo timeout --kill-after=10s 60s apt-get "${options[@]}" update &&
     sudo timeout --kill-after=10s 180s apt-get "${options[@]}" install --yes --no-install-recommends "${packages[@]}"; then
    exit 0
  fi
  if [[ "$attempt" != 3 ]]; then
    echo "Ubuntu package download failed; retrying ($attempt/3)." >&2
    sleep "$((attempt * 2))"
  fi
done
echo 'Ubuntu package installation failed after three bounded attempts.' >&2
exit 1
