const accountViewScript = String.raw`
set -eu
platform=$(uname -s 2>/dev/null || printf 'Unknown')
if [ "$platform" != 'Linux' ]; then
  exec "$@"
fi
codex_home=${'${'}CODEX_HOME:-"$HOME/.codex"}
sele_home="$codex_home/sele"
active=''
if [ -r "$sele_home/active-account" ]; then
  IFS= read -r active < "$sele_home/active-account" || true
fi
selected=''
exec 3<&0
case "$active" in
  *[!0-9a-f-]*|'')
    ;;
  ????????-????-????-????-????????????)
    account_auth="$sele_home/accounts/$active/auth.json"
    regular_auth="$codex_home/auth.json"
    if [ -f "$account_auth" ]; then
      selected=$active
      bwrap_bin=$(command -v bwrap 2>/dev/null || true)
      if [ "$bwrap_bin" = '' ]; then
        codex_bin=$(command -v "$1" 2>/dev/null || printf '%s' "$1")
        codex_bin=$(readlink -f "$codex_bin" 2>/dev/null || printf '%s' "$codex_bin")
        codex_bin_dir=${'${'}codex_bin%/*}
        bundled_bwrap="$codex_bin_dir/../codex-resources/bwrap"
        if [ -x "$bundled_bwrap" ]; then
          bwrap_bin=$bundled_bwrap
        else
          codex_package_root=${'${'}codex_bin_dir%/*}
          bwrap_bin=$(find "$codex_package_root/node_modules/@openai" -path '*/codex-resources/bwrap' -type f -perm -u+x -print -quit 2>/dev/null || true)
        fi
      fi
      if [ "$bwrap_bin" = '' ]; then
        printf 'Codex account switching requires bubblewrap in this environment.\n' >&2
        exit 127
      fi
      umask 077
      mkdir -p "$codex_home"
      if [ ! -e "$regular_auth" ]; then
        printf '{}\n' > "$regular_auth"
      fi
      "$bwrap_bin" --die-with-parent --bind / / --bind "$account_auth" "$regular_auth" -- "$@" <&3 &
    fi
    ;;
esac
if [ "$selected" = '' ]; then
  "$@" <&3 &
fi
codex_pid=$!
(
  exec 3<&-
  while kill -0 "$codex_pid" 2>/dev/null; do
    sleep 1
    current=''
    if [ -r "$sele_home/active-account" ]; then
      IFS= read -r current < "$sele_home/active-account" || true
    fi
    case "$current" in
      *[!0-9a-f-]*|'')
        current=''
        ;;
      ????????-????-????-????-????????????)
        [ -f "$sele_home/accounts/$current/auth.json" ] || current=''
        ;;
      *)
        current=''
        ;;
    esac
    if [ "$current" != "$selected" ]; then
      kill "$codex_pid" 2>/dev/null || true
      exit 0
    fi
  done
) </dev/null >/dev/null 2>&1 &
watcher_pid=$!
trap 'kill "$codex_pid" "$watcher_pid" 2>/dev/null || true' HUP INT TERM
if wait "$codex_pid"; then
  status=0
else
  status=$?
fi
kill "$watcher_pid" 2>/dev/null || true
exit "$status"
`.trim()

export type CodexAccountViewCommand = {
  file: string
  args: string[]
}

export const getCodexAccountViewCommand = (
  binary: string,
  args: string[],
  enabled = process.platform === 'linux'
): CodexAccountViewCommand =>
  enabled
    ? {
        file: 'sh',
        args: ['-c', accountViewScript, 'sele-codex-view', binary, ...args]
      }
    : { file: binary, args }
