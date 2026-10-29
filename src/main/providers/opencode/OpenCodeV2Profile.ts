import { access, chmod, copyFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import type { AppContainerTarget } from '../../../shared/app'
import { getContainerTargetKey } from '../../containerTarget'
import { managedOpenCodeV2Directory } from './OpenCodeInstallations'

const preparations = new Map<string, Promise<string>>()
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false
  )

/** Preserve migrated profiles; seed new profiles from a backup without changing the source. */
export const ensureOpenCodeV2Profile = (container?: AppContainerTarget | null): Promise<string> => {
  const explicit = process.env.OPENCODE_DB
  if (explicit && isAbsolute(explicit)) return Promise.resolve(explicit)
  const source = getContainerTargetKey(container)
  const target = join(
    managedOpenCodeV2Directory(),
    'profiles',
    `${createHash('sha256').update(source).digest('hex').slice(0, 16)}.db`
  )
  const pending = preparations.get(target)
  if (pending) return pending
  const prepare = (async () => {
    await mkdir(join(managedOpenCodeV2Directory(), 'profiles'), { recursive: true, mode: 0o700 })
    if (await exists(target)) return target
    const dataHome =
      process.env.XDG_DATA_HOME && isAbsolute(process.env.XDG_DATA_HOME)
        ? process.env.XDG_DATA_HOME
        : join(homedir(), '.local', 'share')
    const configHome =
      process.env.XDG_CONFIG_HOME && isAbsolute(process.env.XDG_CONFIG_HOME)
        ? process.env.XDG_CONFIG_HOME
        : join(homedir(), '.config')
    const backup = join(
      managedOpenCodeV2Directory(),
      'backups',
      `${Date.now()}-${createHash('sha256').update(source).digest('hex').slice(0, 8)}`
    )
    await mkdir(backup, { recursive: true, mode: 0o700 })
    for (const [name, file] of [
      ['auth.json', join(dataHome, 'opencode', 'auth.json')],
      ['mcp-auth.json', join(dataHome, 'opencode', 'mcp-auth.json')],
      ['opencode.json', join(configHome, 'opencode', 'opencode.json')],
      ['opencode.jsonc', join(configHome, 'opencode', 'opencode.jsonc')]
    ]) {
      if (await exists(file)) {
        await copyFile(file, join(backup, name))
        await chmod(join(backup, name), 0o600)
      }
    }
    const legacy = join(dataHome, 'opencode', 'opencode.db')
    if (await exists(legacy)) {
      const { default: Database } = await import('better-sqlite3')
      const db = new Database(legacy, { readonly: true, fileMustExist: true })
      try {
        await db.backup(target)
        await chmod(target, 0o600)
      } finally {
        db.close()
      }
    }
    return target
  })().catch((error) => {
    preparations.delete(target)
    throw error
  })
  preparations.set(target, prepare)
  return prepare
}
