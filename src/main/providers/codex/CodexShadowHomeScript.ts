import { codexPrivateEntries, codexSharedDirectories, codexSharedFiles } from './CodexShadowHome.ts'

// POSIX hosts need no Node installation: the same layout is prepared beside the CLI.
// Inputs: canonical codex_home and validated account ID in active.
export const codexShadowHomeScript = String.raw`
shadow="$codex_home/sele/accounts/$active"
for directory in "$codex_home/sele" "$codex_home/sele/accounts" "$shadow"; do
  [ -d "$directory" ] && [ ! -L "$directory" ] || {
    printf 'Codex account directory must be a real directory.\n' >&2
    exit 1
  }
done
[ -f "$shadow/auth.json" ] && [ ! -L "$shadow/auth.json" ] || {
  printf 'This chat account is no longer available. Select another account for this chat.\n' >&2
  exit 1
}
for name in auth.lock models_cache.json; do
  [ ! -L "$shadow/$name" ] || {
    printf 'Codex account %s must be private.\n' "$name" >&2
    exit 1
  }
done
umask 077
for name in ${codexSharedDirectories.join(' ')}; do
  mkdir -p "$codex_home/$name"
done
for name in ${codexSharedFiles.join(' ')}; do
  [ -e "$codex_home/$name" ] || (set -C; : > "$codex_home/$name") || [ -e "$codex_home/$name" ]
done
for target in "$codex_home"/* "$codex_home"/.[!.]* "$codex_home"/..?*; do
  [ -e "$target" ] || [ -L "$target" ] || continue
  name=${'${'}target##*/}
  case "$name" in ${[...codexPrivateEntries].join('|')}|*.sqlite|*.sqlite-wal|*.sqlite-shm|*.sqlite-journal) continue;; esac
  link="$shadow/$name"
  if [ -L "$link" ]; then
    [ "$(readlink "$link")" = "$target" ] || {
      printf 'Codex shadow home contains an unexpected link: %s\n' "$name" >&2
      exit 1
    }
  elif [ -e "$link" ]; then
    printf 'Codex shadow home contains a conflicting entry: %s\n' "$name" >&2
    exit 1
  else
    ln -s -n "$target" "$link" || {
      [ -L "$link" ] && [ "$(readlink "$link")" = "$target" ] || exit 1
    }
  fi
done
CODEX_HOME=$shadow
# New SQLite/WAL files must be created in the shared home, even on the very first launch.
CODEX_SQLITE_HOME=${'${'}CODEX_SQLITE_HOME:-$codex_home}
export CODEX_HOME CODEX_SQLITE_HOME
`.trim()
