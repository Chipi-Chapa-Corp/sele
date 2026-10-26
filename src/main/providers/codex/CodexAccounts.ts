import { bufferedCommands } from '../../BufferedCommandWorker'
import { randomUUID } from 'node:crypto'
import type { AppContainerTarget } from '../../../shared/app'
import type { ProviderAccountConfiguration } from '../../../shared/provider'
import { getHostCommand } from '../../hostProcess'
import {
  codexDefaultAccountId,
  isCodexAccountId,
  parseCodexAccountsOutput
} from './CodexAccountConfig'
import { codexAccountViewSetupScript, getCodexAccountViewSetupArgs } from './CodexAccountViewHelper'
import { codexAccountDisplayName } from '../AccountDisplayName'

const accountCommandTimeoutMs = 15_000
const accountSetupTimeoutMs = 5 * 60_000
const accountCommandMaxBuffer = 1024 * 1024

const inspectAccountsScript = String.raw`
set -eu
umask 077
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
# Migrate old label files to lifecycle markers; their contents are no longer used.
if [ -d "$accounts_home" ]; then
  for legacy_home in "$accounts_home"/*; do
    [ -d "$legacy_home" ] || continue
    if [ -f "$legacy_home/name" ]; then
      : > "$legacy_home/ready"
      rm -f -- "$legacy_home/name"
    fi
    if [ -f "$legacy_home/pending-name" ]; then
      : > "$legacy_home/pending"
      rm -f -- "$legacy_home/pending-name"
    fi
  done
fi
if [ -d "$accounts_home" ]; then
  for pending_home in "$accounts_home"/*; do
    [ -d "$pending_home" ] && [ -f "$pending_home/pending" ] || continue
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
          if [ ! -f "$accounts_home/$previous/ready" ] || [ ! -f "$accounts_home/$previous/auth.json" ]; then
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
  [ -r "$account_home/ready" ] || continue
  printf '%s\0' "$account_id"
done
`.trim()

const createAccountScript = String.raw`
set -eu
account_id=$1
codex_home=${'${'}CODEX_HOME:-"$HOME/.codex"}
sele_home="$codex_home/sele"
account_home="$sele_home/accounts/$account_id"
umask 077
mkdir -p "$account_home"
: > "$account_home/pending"
printf '{}\n' > "$account_home/auth.json"
previous=default
current=''
if [ -r "$sele_home/active-account" ]; then
  IFS= read -r current < "$sele_home/active-account" || true
  if [ -f "$sele_home/accounts/$current/ready" ] && [ -f "$sele_home/accounts/$current/auth.json" ]; then
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
if [ -f "$account_home/ready" ]; then
  exit 0
fi
[ -f "$account_home/pending" ] && [ -f "$account_home/auth.json" ] || {
  printf 'Pending Codex account was not found.\n' >&2
  exit 1
}
mv "$account_home/pending" "$account_home/ready"
rm -f -- "$account_home/previous-account"
`.trim()

const cancelAccountCreationScript = String.raw`
set -eu
account_id=$1
codex_home=${'${'}CODEX_HOME:-"$HOME/.codex"}
sele_home="$codex_home/sele"
account_home="$sele_home/accounts/$account_id"
[ -f "$account_home/pending" ] || exit 0
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
  if [ "$previous" != 'default' ] && [ -f "$sele_home/accounts/$previous/ready" ] && [ -f "$sele_home/accounts/$previous/auth.json" ]; then
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

  const { error, stdout, stderr } = await bufferedCommands.run(hostCommand, {
    timeout,
    maxBuffer: accountCommandMaxBuffer
  })
  if (error) throw new Error(stderr.trim() || error.message)
  return stdout
}

export const ensureCodexAccountView = async (
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

export const getCodexAccountsWithDisplayNames = async (
  container?: AppContainerTarget | null
): Promise<ProviderAccountConfiguration> => {
  const configuration = await getCodexAccounts(container)
  // Inspect each account in its own runtime without changing the active account.
  const accounts = configuration.accounts.length
    ? configuration.accounts
    : [{ id: 'default', active: true }]
  const output = await runAccountCommand(
    String.raw`
codex_home=${'${'}CODEX_HOME:-"$HOME/.codex"}
for id do
  printf '%s\0' "$id"
  if [ "$id" = default ]; then path="$codex_home/auth.json"; else path="$codex_home/sele/accounts/$id/auth.json"; fi
  if [ -r "$path" ]; then cat "$path"; fi
  printf '\0'
done
`,
    accounts.map((account) => account.id),
    container
  ).catch(() => '')
  const fields = output.split('\0')
  const names = new Map<string, string | null>()
  for (let index = 0; index + 1 < fields.length; index += 2)
    names.set(fields[index]!, codexAccountDisplayName(fields[index + 1]!))
  return {
    ...configuration,
    accounts: accounts.map((account) => ({
      ...account,
      displayName: names.get(account.id) ?? null
    }))
  }
}

export const createCodexAccount = async (
  container?: AppContainerTarget | null
): Promise<{ accountId: string }> => {
  const configuration = await getCodexAccounts(container)
  if (!configuration.available) throw new Error(configuration.unavailableMessage ?? 'Unavailable')

  await ensureCodexAccountView(container)
  const accountId = randomUUID()
  await runAccountCommand(createAccountScript, [accountId], container)
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
