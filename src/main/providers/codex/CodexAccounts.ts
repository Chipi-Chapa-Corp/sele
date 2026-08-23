import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { AppContainerTarget } from '../../../shared/app'
import type { ProviderAccountConfiguration } from '../../../shared/provider'
import { getHostCommand } from '../../hostProcess'
import {
  codexDefaultAccountId,
  isCodexAccountId,
  normalizeCodexAccountName,
  parseCodexAccountsOutput
} from './CodexAccountConfig'
import { codexAccountViewSetupScript, getCodexAccountViewSetupArgs } from './CodexAccountViewHelper'

const accountCommandTimeoutMs = 15_000
const accountSetupTimeoutMs = 5 * 60_000
const accountCommandMaxBuffer = 1024 * 1024

const inspectAccountsScript = String.raw`
platform=$(uname -s 2>/dev/null || printf 'Unknown')
printf '%s\0' "$platform"
[ "$platform" = 'Linux' ] || exit 0
codex_home=${'${'}CODEX_HOME:-"$HOME/.codex"}
sele_home="$codex_home/sele"
accounts_home="$sele_home/accounts"
active=''
if [ -r "$sele_home/active-account" ]; then
  IFS= read -r active < "$sele_home/active-account" || true
fi
if [ -d "$accounts_home" ]; then
  for pending_home in "$accounts_home"/*; do
    [ -d "$pending_home" ] && [ -f "$pending_home/pending-name" ] || continue
    pending_id=${'${'}pending_home##*/}
    case "$pending_id" in
      *[!0-9a-f-]*|'')
        continue
        ;;
      ????????-????-????-????-????????????)
        ;;
      *)
        continue
        ;;
    esac
    if [ "$active" = "$pending_id" ]; then
      previous=default
      if [ -r "$pending_home/previous-account" ]; then
        IFS= read -r previous < "$pending_home/previous-account" || true
      fi
      case "$previous" in
        *[!0-9a-f-]*|'')
          previous=default
          ;;
        ????????-????-????-????-????????????)
          if [ ! -f "$accounts_home/$previous/name" ] || [ ! -f "$accounts_home/$previous/auth.json" ]; then
            previous=default
          fi
          ;;
        *)
          previous=default
          ;;
      esac
      if [ "$previous" = 'default' ]; then
        rm -f -- "$sele_home/active-account"
        active=''
      else
        umask 077
        active_tmp="$sele_home/.active-account.$$"
        printf '%s\n' "$previous" > "$active_tmp"
        mv "$active_tmp" "$sele_home/active-account"
        active=$previous
      fi
    fi
    rm -rf -- "$pending_home"
  done
fi
printf '%s\0' "$active"
[ -d "$accounts_home" ] || exit 0
for account_home in "$accounts_home"/*; do
  [ -d "$account_home" ] || continue
  account_id=${'${'}account_home##*/}
  [ -r "$account_home/name" ] || continue
  printf '%s\0' "$account_id"
  cat "$account_home/name"
  printf '\0'
done
`.trim()

const createAccountScript = String.raw`
set -eu
account_id=$1
account_name=$2
codex_home=${'${'}CODEX_HOME:-"$HOME/.codex"}
sele_home="$codex_home/sele"
account_home="$sele_home/accounts/$account_id"
umask 077
mkdir -p "$account_home"
printf '%s' "$account_name" > "$account_home/pending-name"
printf '{}\n' > "$account_home/auth.json"
previous=default
current=''
if [ -r "$sele_home/active-account" ]; then
  IFS= read -r current < "$sele_home/active-account" || true
  if [ -f "$sele_home/accounts/$current/name" ] && [ -f "$sele_home/accounts/$current/auth.json" ]; then
    previous=$current
  fi
fi
printf '%s\n' "$previous" > "$account_home/previous-account"
active_tmp="$sele_home/.active-account.$$"
printf '%s\n' "$account_id" > "$active_tmp"
mv "$active_tmp" "$sele_home/active-account"
`.trim()

const useAccountScript = String.raw`
set -eu
account_id=$1
codex_home=${'${'}CODEX_HOME:-"$HOME/.codex"}
sele_home="$codex_home/sele"
if [ "$account_id" = 'default' ]; then
  rm -f -- "$sele_home/active-account"
  exit 0
fi
account_home="$sele_home/accounts/$account_id"
[ -d "$account_home" ] && [ -f "$account_home/auth.json" ] || {
  printf 'Codex account was not found.\n' >&2
  exit 1
}
umask 077
active_tmp="$sele_home/.active-account.$$"
printf '%s\n' "$account_id" > "$active_tmp"
mv "$active_tmp" "$sele_home/active-account"
`.trim()

const finalizeAccountScript = String.raw`
set -eu
account_id=$1
codex_home=${'${'}CODEX_HOME:-"$HOME/.codex"}
sele_home="$codex_home/sele"
account_home="$sele_home/accounts/$account_id"
if [ -f "$account_home/name" ]; then
  exit 0
fi
[ -f "$account_home/pending-name" ] && [ -f "$account_home/auth.json" ] || {
  printf 'Pending Codex account was not found.\n' >&2
  exit 1
}
mv "$account_home/pending-name" "$account_home/name"
rm -f -- "$account_home/previous-account"
`.trim()

const cancelAccountCreationScript = String.raw`
set -eu
account_id=$1
codex_home=${'${'}CODEX_HOME:-"$HOME/.codex"}
sele_home="$codex_home/sele"
account_home="$sele_home/accounts/$account_id"
[ -f "$account_home/pending-name" ] || exit 0
previous=default
if [ -r "$account_home/previous-account" ]; then
  IFS= read -r previous < "$account_home/previous-account" || true
fi
rm -rf -- "$account_home"
current=''
if [ -r "$sele_home/active-account" ]; then
  IFS= read -r current < "$sele_home/active-account" || true
fi
if [ "$current" = "$account_id" ]; then
  if [ "$previous" != 'default' ] && [ -f "$sele_home/accounts/$previous/name" ] && [ -f "$sele_home/accounts/$previous/auth.json" ]; then
    active_tmp="$sele_home/.active-account.$$"
    printf '%s\n' "$previous" > "$active_tmp"
    mv "$active_tmp" "$sele_home/active-account"
  else
    rm -f -- "$sele_home/active-account"
  fi
fi
`.trim()

const deleteAccountScript = String.raw`
set -eu
account_id=$1
codex_home=${'${'}CODEX_HOME:-"$HOME/.codex"}
sele_home="$codex_home/sele"
account_home="$sele_home/accounts/$account_id"
rm -rf -- "$account_home"
active=''
if [ -r "$sele_home/active-account" ]; then
  IFS= read -r active < "$sele_home/active-account" || true
fi
if [ "$active" = "$account_id" ]; then
  rm -f -- "$sele_home/active-account"
fi
`.trim()

const getLocalUnavailableMessage = (): string | null => {
  if (process.platform === 'linux') return null
  if (process.platform === 'darwin') {
    return 'Accounts configuration is not available on MacOS'
  }
  if (process.platform === 'win32') {
    return 'Accounts configuration is not available on Windows'
  }
  return 'Accounts configuration is not available on this operating system'
}

const requireAccountId = (value: string): string => {
  if (!isCodexAccountId(value)) throw new Error('Invalid Codex account ID')
  return value
}

const requireSelectableAccountId = (value: string): string =>
  value === codexDefaultAccountId ? value : requireAccountId(value)

const runAccountCommand = async (
  script: string,
  args: string[],
  container: AppContainerTarget | null | undefined,
  timeout = accountCommandTimeoutMs
): Promise<string> => {
  const hostCommand = await getHostCommand('sh', ['-lc', script, 'sele-codex-accounts', ...args], {
    container,
    env: process.env
  })

  return new Promise((resolve, reject) => {
    const child = execFile(
      hostCommand.file,
      hostCommand.args,
      {
        cwd: hostCommand.cwd,
        encoding: 'utf8',
        env: hostCommand.env,
        maxBuffer: accountCommandMaxBuffer,
        timeout
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message))
          return
        }
        resolve(stdout)
      }
    )
    child.stdin?.end()
  })
}

const ensureCodexAccountView = async (
  container: AppContainerTarget | null | undefined
): Promise<void> => {
  await runAccountCommand(
    codexAccountViewSetupScript,
    getCodexAccountViewSetupArgs(),
    container,
    accountSetupTimeoutMs
  )
}

export const getCodexAccounts = async (
  container?: AppContainerTarget | null
): Promise<ProviderAccountConfiguration> => {
  const unavailableMessage = container?.kind === 'container' ? null : getLocalUnavailableMessage()
  if (unavailableMessage) return { available: false, unavailableMessage, accounts: [] }

  return parseCodexAccountsOutput(await runAccountCommand(inspectAccountsScript, [], container))
}

export const createCodexAccount = async (
  nameValue: string,
  container?: AppContainerTarget | null
): Promise<{ accountId: string }> => {
  const configuration = await getCodexAccounts(container)
  if (!configuration.available) throw new Error(configuration.unavailableMessage ?? 'Unavailable')

  const name = normalizeCodexAccountName(nameValue)
  if (
    configuration.accounts.some(
      (account) => account.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    )
  ) {
    throw new Error('An account with this name already exists.')
  }

  await ensureCodexAccountView(container)
  const accountId = randomUUID()
  await runAccountCommand(createAccountScript, [accountId, name], container)
  return { accountId }
}

export const useCodexAccount = async (
  accountIdValue: string,
  container?: AppContainerTarget | null
): Promise<ProviderAccountConfiguration> => {
  const accountId = requireSelectableAccountId(accountIdValue)
  const configuration = await getCodexAccounts(container)
  if (!configuration.available) throw new Error(configuration.unavailableMessage ?? 'Unavailable')
  if (
    accountId !== codexDefaultAccountId &&
    !configuration.accounts.some((account) => account.id === accountId)
  ) {
    throw new Error('Codex account was not found.')
  }

  if (accountId !== codexDefaultAccountId) await ensureCodexAccountView(container)
  await runAccountCommand(useAccountScript, [accountId], container)
  return getCodexAccounts(container)
}

export const finalizeCodexAccount = async (
  accountIdValue: string,
  container?: AppContainerTarget | null
): Promise<ProviderAccountConfiguration> => {
  await runAccountCommand(finalizeAccountScript, [requireAccountId(accountIdValue)], container)
  return getCodexAccounts(container)
}

export const cancelCodexAccountCreation = async (
  accountIdValue: string,
  container?: AppContainerTarget | null
): Promise<ProviderAccountConfiguration> => {
  await runAccountCommand(
    cancelAccountCreationScript,
    [requireAccountId(accountIdValue)],
    container
  )
  return getCodexAccounts(container)
}

export const deleteCodexAccount = async (
  accountIdValue: string,
  container?: AppContainerTarget | null
): Promise<ProviderAccountConfiguration> => {
  const accountId = requireAccountId(accountIdValue)
  const configuration = await getCodexAccounts(container)
  if (!configuration.available) throw new Error(configuration.unavailableMessage ?? 'Unavailable')
  if (!configuration.accounts.some((account) => account.id === accountId)) {
    throw new Error('Codex account was not found.')
  }

  await runAccountCommand(deleteAccountScript, [accountId], container)
  return getCodexAccounts(container)
}
