import { isCodexAccountId } from './CodexAccountConfig.ts'
import { codexShadowHomeScript } from './CodexShadowHomeScript.ts'
import { codexHome, prepareCodexShadowHome, resolveCodexAccount } from './CodexShadowHome.ts'

const accountViewScript = String.raw`
set -eu
pinned=$1
shift
codex_home=${'${'}CODEX_HOME:-"$HOME/.codex"}
mkdir -p "$codex_home"
codex_home=$(cd "$codex_home" && pwd -P)
sele_home="$codex_home/sele"
active=$pinned
if [ "$active" = '' ] && [ -r "$sele_home/active-account" ]; then
  IFS= read -r active < "$sele_home/active-account" || true
fi
if [ "$active" = 'default' ]; then active=''; fi
case "$active" in *[!0-9a-f-]*) printf 'Invalid Codex account ID\n' >&2; exit 1;; esac
if [ "$active" != '' ] && [ ! -f "$sele_home/accounts/$active/auth.json" ]; then
  printf 'This chat account is no longer available. Select another account for this chat.\n' >&2
  exit 1
fi
selected=''
exec 3<&0
case "$active" in
  *[!0-9a-f-]*|'')
    ;;
  ????????-????-????-????-????????????)
    account_auth="$sele_home/accounts/$active/auth.json"
    if [ -f "$account_auth" ]; then
      selected=$active
      ${codexShadowHomeScript}
      "$@" -c 'cli_auth_credentials_store="file"' <&3 &
    fi
    ;;
  *)
    printf 'Invalid Codex account ID\n' >&2
    exit 1
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
    if [ "$pinned" = '' ] && [ "$current" != "$selected" ]; then
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
  env?: NodeJS.ProcessEnv
}

export const getCodexAccountViewCommand = async (
  binary: string,
  args: string[],
  usePosix = process.platform !== 'win32',
  accountId?: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<CodexAccountViewCommand> => {
  if (accountId && accountId !== 'default' && !isCodexAccountId(accountId))
    throw new Error('Invalid Codex account ID')
  if (usePosix)
    return {
      file: 'sh',
      args: ['-c', accountViewScript, 'sele-codex-view', accountId ?? '', binary, ...args],
      env
    }
  const home = codexHome(env)
  const selected = await resolveCodexAccount(home, accountId)
  if (selected === 'default') return { file: binary, args, env }
  const shadow = await prepareCodexShadowHome(home, selected)
  return {
    file: binary,
    args: [...args, '-c', 'cli_auth_credentials_store="file"'],
    env: { ...env, CODEX_HOME: shadow, CODEX_SQLITE_HOME: env.CODEX_SQLITE_HOME || home }
  }
}
