import { opendir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import type { HostDirectoryListing } from '../shared/hostDirectory'

export const browseHostDirectory = async (value: unknown): Promise<HostDirectoryListing> => {
  if (typeof value !== 'string' || value.length > 4096 || value.includes('\0'))
    throw new Error('Invalid folder path.')
  const path = normalize(
    value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value
  )
  if (!isAbsolute(path)) throw new Error('Enter an absolute folder path on your computer.')
  const directory = await opendir(path)
  const entries: HostDirectoryListing['entries'] = []
  let truncated = false
  for await (const entry of directory) {
    if (entries.length >= 2000) {
      truncated = true
      break
    }
    const entryPath = join(path, entry.name)
    const linked = entry.isSymbolicLink() ? await stat(entryPath).catch(() => null) : null
    entries.push({
      name: entry.name,
      path: entryPath,
      directory: entry.isDirectory() || Boolean(linked?.isDirectory())
    })
  }
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
  return { path, parent: dirname(path), entries, truncated }
}
