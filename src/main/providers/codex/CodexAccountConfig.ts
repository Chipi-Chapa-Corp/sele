import type { ProviderAccountConfiguration, ProviderManagedAccount } from '../../../shared/provider'

const accountIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const codexDefaultAccountId = 'default'

const getPlatformLabel = (platform: string): string => {
  if (platform === 'Darwin') return 'MacOS'
  if (/^(MINGW|MSYS|CYGWIN|Windows)/i.test(platform)) return 'Windows'
  return platform || 'this operating system'
}

export const isCodexAccountId = (value: string): boolean => accountIdPattern.test(value)

export const isRecoverableCodexLoginAccountReadError = (error: unknown): boolean =>
  error instanceof Error &&
  /plan type (?:(?:is|are) )?required for chatgpt authentication/i.test(error.message)

export const isRecoverableCodexStopError = (error: unknown): boolean =>
  error instanceof Error && /no active turn|thread (?:was )?not found/i.test(error.message)

export const normalizeCodexAccountName = (value: string): string => {
  const name = value.trim()
  if (!name) throw new Error('Account name is required.')
  if (name.length > 80) throw new Error('Account name must be 80 characters or fewer.')
  if (
    Array.from(name).some((character) => {
      const code = character.charCodeAt(0)
      return code <= 0x1f || code === 0x7f
    })
  ) {
    throw new Error('Account name cannot contain control characters.')
  }
  return name
}

export const parseCodexAccountsOutput = (stdout: string): ProviderAccountConfiguration => {
  const fields = stdout.split('\0')
  const platform = fields[0] ?? 'Unknown'
  if (platform !== 'Linux') {
    return {
      available: false,
      unavailableMessage: `Accounts configuration is not available on ${getPlatformLabel(platform)}`,
      accounts: []
    }
  }

  const activeAccountId = fields[1] ?? ''
  const accounts: ProviderManagedAccount[] = []
  for (let index = 2; index + 1 < fields.length; index += 2) {
    const id = fields[index] ?? ''
    const name = fields[index + 1] ?? ''
    if (!isCodexAccountId(id) || !name) continue
    accounts.push({ id, name, active: id === activeAccountId })
  }

  accounts.sort((first, second) => first.name.localeCompare(second.name))
  const configuredAccountIsActive = accounts.some((account) => account.active)
  accounts.unshift({
    id: codexDefaultAccountId,
    name: 'Default',
    active: !configuredAccountIsActive
  })
  return { available: true, unavailableMessage: null, accounts }
}
