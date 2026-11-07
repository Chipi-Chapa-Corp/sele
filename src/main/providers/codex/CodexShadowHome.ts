import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  symlink,
  writeFile
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { isCodexAccountId } from './CodexAccountConfig.ts'

export const codexSharedDirectories = [
  'sessions',
  'archived_sessions',
  'sqlite',
  'shell_snapshots',
  'worktrees',
  'skills',
  'plugins',
  'cache',
  'logs',
  'log',
  'memories',
  'mcp-oauth-locks',
  'thread-writer-locks'
] as const

// Never link Sele's registry into one of its own account directories.
export const codexPrivateEntries = new Set([
  'sele',
  'auth.json',
  'auth.lock',
  'auth.json.lock',
  'models_cache.json',
  'tmp',
  '.DS_Store'
])

export const codexSharedFiles = [
  'config.toml',
  'session_index.jsonl',
  'history.jsonl',
  '.sqlite-maintenance.lock'
] as const

// SQLite's own location is pinned with CODEX_SQLITE_HOME; WAL/SHM files appear and vanish live.
const isSqliteFile = (name: string): boolean => /\.sqlite(?:-(?:wal|shm|journal))?$/.test(name)

export const codexHome = (env: NodeJS.ProcessEnv = process.env): string =>
  resolve(env.CODEX_HOME?.trim() || join(homedir(), '.codex'))

export const optionalCodexFile = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export const codexAccountDirectory = (home: string, id: string): string => {
  if (!isCodexAccountId(id)) throw new Error('Invalid Codex account ID')
  return join(home, 'sele', 'accounts', id)
}

export const resolveCodexAccount = async (home: string, pinned?: string): Promise<string> => {
  if (pinned === 'default') return pinned
  const id = pinned || (await optionalCodexFile(join(home, 'sele', 'active-account')))?.trim()
  if (!id || id === 'default') return 'default'
  if (!isCodexAccountId(id)) throw new Error('Invalid Codex account ID')
  const auth = await lstat(join(codexAccountDirectory(home, id), 'auth.json')).catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (!auth?.isFile() || auth.isSymbolicLink())
    throw new Error(
      'This chat account is no longer available. Select another account for this chat.'
    )
  return id
}

/** Preserve harness-owned auth while sharing native history, configuration and writer locks. */
export const prepareCodexShadowHome = async (home: string, id: string): Promise<string> => {
  home = await realpath(home)
  const shadow = codexAccountDirectory(home, id)
  for (const directory of [join(home, 'sele'), join(home, 'sele', 'accounts'), shadow]) {
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('Codex account directory must be a real directory.')
  }
  await resolveCodexAccount(home, id)
  for (const name of ['auth.lock', 'auth.json.lock', 'models_cache.json']) {
    const info = await lstat(join(shadow, name)).catch((error) => {
      if (error.code !== 'ENOENT') throw error
      return null
    })
    if (info?.isSymbolicLink()) throw new Error(`Codex account ${name} must be private.`)
  }
  await Promise.all(
    codexSharedDirectories.map((name) => mkdir(join(home, name), { recursive: true }))
  )
  // Link these before the first account starts, even in a fresh installation.
  for (const name of codexSharedFiles) {
    await writeFile(join(home, name), '', { flag: 'wx', mode: 0o600 }).catch((error) => {
      if (error.code !== 'EEXIST') throw error
    })
  }
  for (const name of await readdir(home)) {
    if (codexPrivateEntries.has(name) || isSqliteFile(name)) continue
    const target = join(home, name)
    const link = join(shadow, name)
    const existing = await lstat(link).catch((error) => {
      if (error.code !== 'ENOENT') throw error
      return null
    })
    if (existing) {
      if (!existing.isSymbolicLink())
        throw new Error(`Codex shadow home contains a conflicting entry: ${name}`)
      const current = await readlink(link)
      if (resolve(dirname(link), current) === target) continue
      throw new Error(`Codex shadow home contains an unexpected link: ${name}`)
    }
    try {
      await symlink(target, link, (await lstat(target)).isDirectory() ? 'dir' : 'file')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        // Another launch may be preparing the same account concurrently.
        if ((await realpath(link)) === (await realpath(target))) continue
      }
      if (
        process.platform === 'win32' &&
        ['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')
      )
        throw new Error(
          'Codex accounts require symbolic links. Enable Windows Developer Mode or run with permission to create symbolic links.'
        )
      throw error
    }
  }
  return shadow
}
