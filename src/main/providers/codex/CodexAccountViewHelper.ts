export const codexAccountViewHelperVersion = '4'
export const codexAccountViewHelperPath = '/usr/local/libexec/sele-codex-account-view'

export const codexAccountViewHelperScript = String.raw`#!/bin/sh
set -eu

helper_version='${codexAccountViewHelperVersion}'
helper_path='${codexAccountViewHelperPath}'
sudoers_path='/etc/sudoers.d/sele-codex-account-view'
safe_path='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
caller_path=${'${'}SELE_CODEX_CALLER_PATH:-${'${'}PATH:-$safe_path}}
PATH=$safe_path
export PATH
unset ENV BASH_ENV CDPATH GLOBIGNORE 2>/dev/null || true

fail() {
  printf 'sele-codex-account-view: %s\n' "$1" >&2
  exit 1
}

find_tool() {
  tool=$(command -v "$1" 2>/dev/null || true)
  [ -n "$tool" ] || fail "required command is unavailable: $1"
  printf '%s\n' "$tool"
}

install_helper() {
  [ "$(id -u)" = '0' ] || fail 'administrator privileges are required for installation'

  install_bin=$(find_tool install)
  mkdir_bin=$(find_tool mkdir)
  mv_bin=$(find_tool mv)
  rm_bin=$(find_tool rm)
  "$mkdir_bin" -p '/usr/local/libexec'

  helper_tmp="$helper_path.tmp.$$"
  sudoers_tmp="$sudoers_path.tmp.$$"
  trap '"$rm_bin" -f -- "$helper_tmp" "$sudoers_tmp"' EXIT HUP INT TERM
  "$install_bin" -o root -g root -m 0755 "$0" "$helper_tmp"

  if command -v sudo >/dev/null 2>&1; then
    visudo_bin=$(find_tool visudo)
    umask 077
    printf 'ALL ALL=(root) NOPASSWD:SETENV: %s\n' "$helper_path" > "$sudoers_tmp"
    chmod 0440 "$sudoers_tmp"
    chown root:root "$sudoers_tmp"
    "$visudo_bin" -cf "$sudoers_tmp" >/dev/null
  fi

  "$mv_bin" "$helper_tmp" "$helper_path"
  if [ -f "$sudoers_tmp" ]; then
    "$mv_bin" "$sudoers_tmp" "$sudoers_path"
  fi
  trap - EXIT HUP INT TERM
  printf 'Installed %s version %s.\n' "$helper_path" "$helper_version"
}

supervise_command() {
  [ "$#" -ge 3 ] || fail 'invalid supervisor arguments'
  codex_home=$1
  account_id=$2
  shift 2
  PATH=$caller_path
  export PATH
  exec 3<&0
  "$@" <&3 &
  command_pid=$!
  (
    exec 3<&-
    while kill -0 "$command_pid" 2>/dev/null; do
      sleep 1
      current=''
      if [ -r "$codex_home/sele/active-account" ]; then
        IFS= read -r current < "$codex_home/sele/active-account" || true
      fi
      [ "$current" = "$account_id" ] || {
        kill "$command_pid" 2>/dev/null || true
        exit 0
      }
    done
  ) </dev/null >/dev/null 2>&1 &
  watcher_pid=$!
  trap 'kill "$command_pid" "$watcher_pid" 2>/dev/null || true' HUP INT TERM
  if wait "$command_pid"; then
    status=0
  else
    status=$?
  fi
  kill "$watcher_pid" 2>/dev/null || true
  exit "$status"
}

case "${'${'}1:-}" in
  --version)
    printf '%s\n' "$helper_version"
    exit 0
    ;;
  --install)
    install_helper
    exit 0
    ;;
  --supervise)
    [ "$(id -u)" != '0' ] || fail 'the supervisor cannot run with administrator privileges'
    shift
    supervise_command "$@"
    ;;
esac

[ "$(id -u)" = '0' ] || fail 'this helper must be launched through sudo'
[ "$#" -ge 3 ] || fail 'invalid arguments'

mounted=false
if [ "$1" = '--mounted' ]; then
  mounted=true
  shift
fi

codex_home_input=$1
account_id=$2
shift 2

case "$account_id" in
  *[!0-9a-f-]*|'') fail 'invalid account ID' ;;
  ????????-????-????-????-????????????) ;;
  *) fail 'invalid account ID' ;;
esac
case "$codex_home_input" in
  /*) ;;
  *) fail 'Codex home must be an absolute path' ;;
esac
case "$1" in
  /*) ;;
  *) fail 'the Codex executable must be an absolute path' ;;
esac

caller_uid=${'${'}SUDO_UID:-0}
caller_gid=${'${'}SUDO_GID:-0}
case "$caller_uid:$caller_gid" in
  *[!0-9:]*|:|*:|:*:*) fail 'invalid caller identity' ;;
esac

readlink_bin=$(find_tool readlink)
stat_bin=$(find_tool stat)
codex_home=$("$readlink_bin" -f -- "$codex_home_input")
[ -d "$codex_home" ] && [ ! -L "$codex_home_input" ] || fail 'Codex home is unavailable or is a symbolic link'
[ "$("$stat_bin" -c %u -- "$codex_home")" = "$caller_uid" ] || fail 'Codex home is not owned by the invoking user'

sele_home="$codex_home/sele"
accounts_home="$sele_home/accounts"
account_home="$accounts_home/$account_id"
account_auth="$account_home/auth.json"
regular_auth="$codex_home/auth.json"
for owned_directory in "$sele_home" "$accounts_home" "$account_home"; do
  [ -d "$owned_directory" ] && [ ! -L "$owned_directory" ] || fail 'account directory is unavailable or is a symbolic link'
  [ "$("$stat_bin" -c %u -- "$owned_directory")" = "$caller_uid" ] || fail 'account directory is not owned by the invoking user'
done
for owned_file in "$account_auth" "$regular_auth"; do
  [ -f "$owned_file" ] && [ ! -L "$owned_file" ] || fail 'authentication file is unavailable or is a symbolic link'
  [ "$("$stat_bin" -c %u -- "$owned_file")" = "$caller_uid" ] || fail 'authentication file is not owned by the invoking user'
done

if [ "$mounted" = 'false' ]; then
  unshare_bin=$(find_tool unshare)
  SELE_CODEX_CALLER_PATH=$caller_path
  export SELE_CODEX_CALLER_PATH
  exec "$unshare_bin" --mount --fork --kill-child --propagation private \
    "$helper_path" --mounted "$codex_home" "$account_id" "$@"
fi

mount_bin=$(find_tool mount)
setpriv_bin=$(find_tool setpriv)
getent_bin=$(find_tool getent)
cut_bin=$(find_tool cut)
"$mount_bin" --bind "$account_auth" "$regular_auth"

caller_entry=$("$getent_bin" passwd "$caller_uid" || true)
[ -n "$caller_entry" ] || fail 'unable to resolve the invoking user'
caller_name=$(printf '%s' "$caller_entry" | "$cut_bin" -d: -f1)
caller_home=$(printf '%s' "$caller_entry" | "$cut_bin" -d: -f6)
[ -n "$caller_name" ] && [ -n "$caller_home" ] || fail 'invalid invoking user record'

HOME=$caller_home
USER=$caller_name
LOGNAME=$caller_name
CODEX_HOME=$codex_home
PATH=$caller_path
export HOME USER LOGNAME CODEX_HOME PATH
unset SELE_CODEX_CALLER_PATH SUDO_COMMAND SUDO_GID SUDO_UID SUDO_USER

if [ "$caller_uid" = '0' ]; then
  exec "$setpriv_bin" --reuid 0 --regid 0 --clear-groups --bounding-set=-all \
    --inh-caps=-all --ambient-caps=-all -- "$@"
fi
exec "$setpriv_bin" --reuid "$caller_uid" --regid "$caller_gid" --init-groups \
  --bounding-set=-all --inh-caps=-all --ambient-caps=-all -- "$helper_path" --supervise \
  "$codex_home" "$account_id" "$@"
`

export const codexAccountViewSetupScript = String.raw`
set -eu
expected_version=$1
helper_payload=$2
helper_path='${codexAccountViewHelperPath}'
codex_home=${'${'}CODEX_HOME:-"$HOME/.codex"}
sele_home="$codex_home/sele"
stage="$sele_home/sele-codex-account-view-install"

installed_version=''
if [ -x "$helper_path" ]; then
  installed_version=$("$helper_path" --version 2>/dev/null || true)
fi
[ "$installed_version" = "$expected_version" ] && exit 0

umask 077
mkdir -p "$sele_home"
stage_tmp="$stage.tmp.$$"
trap 'rm -f -- "$stage_tmp"' EXIT HUP INT TERM
printf '%s' "$helper_payload" | base64 -d > "$stage_tmp"
chmod 0700 "$stage_tmp"
mv "$stage_tmp" "$stage"
trap - EXIT HUP INT TERM

install_with_sudo() {
  command -v sudo >/dev/null 2>&1 || return 1
  sudo -n -- "$stage" --install
}

if [ "$(id -u)" = '0' ]; then
  "$stage" --install
elif install_with_sudo; then
  :
elif command -v pkexec >/dev/null 2>&1 && pkexec "$stage" --install; then
  :
else
  printf 'Codex account switching needs one-time administrator setup in this environment. Run:\n\n  sudo %s --install\n' "$stage" >&2
  exit 77
fi

installed_version=$("$helper_path" --version 2>/dev/null || true)
[ "$installed_version" = "$expected_version" ] || {
  printf 'Codex account view helper installation did not complete.\n' >&2
  exit 1
}
if [ "$(id -u)" != '0' ]; then
  sudo -n -E --preserve-env=PATH -- "$helper_path" --version >/dev/null
fi
rm -f -- "$stage"
`.trim()

export const getCodexAccountViewSetupArgs = (): string[] => [
  codexAccountViewHelperVersion,
  Buffer.from(codexAccountViewHelperScript, 'utf8').toString('base64')
]
