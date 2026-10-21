import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ProviderAccountConfiguration } from '../../shared/provider'

/** Presentation metadata only. Provider credentials remain in their native stores. */
export class AccountDisplayNameCache {
  private names: Promise<Record<string, Record<string, string>>> | null = null
  private writes: Promise<unknown> = Promise.resolve()

  private readonly path: () => string

  constructor(path: () => string) {
    this.path = path
  }

  private load = (): Promise<Record<string, Record<string, string>>> => {
    if (!this.names)
      this.names = readFile(this.path(), 'utf8')
        .then((content) => {
          const parsed = JSON.parse(content)
          const result: Record<string, Record<string, string>> = {}
          for (const [scope, accounts] of Object.entries(parsed)) {
            if (!accounts || typeof accounts !== 'object') continue
            result[scope] = Object.fromEntries(
              Object.entries(accounts).filter(([, name]) => typeof name === 'string' && name.trim())
            )
          }
          return result
        })
        .catch(() => ({}))
    return this.names
  }

  merge = async (
    scope: string,
    configuration: ProviderAccountConfiguration
  ): Promise<ProviderAccountConfiguration> => {
    const names = await this.load()
    const previous = names[scope] ?? {}
    const current = Object.fromEntries(
      configuration.accounts
        .map((account) => [account.id, account.displayName?.trim() || previous[account.id]])
        .filter(([, name]) => Boolean(name))
    ) as Record<string, string>
    const accounts = configuration.accounts.map((account) => ({
      ...account,
      displayName: current[account.id] ?? null
    }))
    if (JSON.stringify(previous) !== JSON.stringify(current)) {
      names[scope] = current
      const content = JSON.stringify(names)
      this.writes = this.writes
        .catch(() => {})
        .then(async () => {
          const path = this.path()
          const temporary = `${path}.${randomUUID()}.tmp`
          try {
            await mkdir(dirname(path), { recursive: true })
            await writeFile(temporary, content, { mode: 0o600 })
            await rename(temporary, path)
          } finally {
            await rm(temporary, { force: true })
          }
        })
      await this.writes.catch(() => {})
    }
    return { ...configuration, accounts }
  }
}
