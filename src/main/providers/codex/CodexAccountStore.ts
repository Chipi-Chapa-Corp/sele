import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { isCodexAccountId } from './CodexAccountConfig.ts'
import { codexAccountDirectory, optionalCodexFile } from './CodexShadowHome.ts'

export type CodexAccountOperation =
  | 'inspect'
  | 'create'
  | 'use'
  | 'finalize'
  | 'cancel'
  | 'delete'
  | 'names'

/** Native account lifecycle for Windows, with the existing on-disk format and rollback markers. */
export const createCodexAccountStore = (home: string) => {
  const root = join(home, 'sele')
  const activePath = join(root, 'active-account')
  const active = async () => (await optionalCodexFile(activePath))?.trim() || 'default'
  const select = async (id: string) => {
    if (id === 'default') return rm(activePath, { force: true })
    if (!isCodexAccountId(id)) throw new Error('Invalid Codex account ID')
    await mkdir(root, { recursive: true, mode: 0o700 })
    const temporary = join(root, `.active-account-${randomUUID()}`)
    try {
      await writeFile(temporary, `${id}\n`, { mode: 0o600, flag: 'wx' })
      await rename(temporary, activePath)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  const ready = async (id: string) =>
    isCodexAccountId(id) &&
    (await optionalCodexFile(join(codexAccountDirectory(home, id), 'ready'))) !== null &&
    (await optionalCodexFile(join(codexAccountDirectory(home, id), 'auth.json'))) !== null
  const rollback = async (id: string) => {
    const directory = codexAccountDirectory(home, id)
    if ((await optionalCodexFile(join(directory, 'pending'))) === null) return
    const previous =
      (await optionalCodexFile(join(directory, 'previous-account')))?.trim() || 'default'
    if ((await active()) === id) await select((await ready(previous)) ? previous : 'default')
    await rm(directory, { recursive: true, force: true })
  }
  return async (operation: CodexAccountOperation, args: string[] = []): Promise<string> => {
    if (operation === 'inspect') {
      const directories = await readdir(join(root, 'accounts'), { withFileTypes: true }).catch(
        (error) => {
          if (error.code !== 'ENOENT') throw error
          return []
        }
      )
      const ids: string[] = []
      for (const entry of directories) {
        if (!entry.isDirectory() || !isCodexAccountId(entry.name)) continue
        const directory = codexAccountDirectory(home, entry.name)
        for (const [legacy, marker] of [
          ['name', 'ready'],
          ['pending-name', 'pending']
        ]) {
          if ((await optionalCodexFile(join(directory, legacy))) !== null) {
            await writeFile(join(directory, marker), '', { mode: 0o600 })
            await rm(join(directory, legacy))
          }
        }
        await rollback(entry.name)
        if (await ready(entry.name)) ids.push(entry.name)
      }
      return ['Windows', await active(), ...ids].join('\0')
    }
    if (operation === 'names') {
      const fields: string[] = []
      for (const id of args) {
        const directory = id === 'default' ? home : codexAccountDirectory(home, id)
        fields.push(id, (await optionalCodexFile(join(directory, 'auth.json'))) || '')
      }
      return fields.join('\0')
    }
    const id = args[0]
    if (operation === 'use' && id === 'default') {
      await select(id)
      return ''
    }
    const directory = codexAccountDirectory(home, id)
    switch (operation) {
      case 'create': {
        const previous = await active()
        await mkdir(directory, { recursive: true, mode: 0o700 })
        await writeFile(join(directory, 'pending'), '', { flag: 'wx', mode: 0o600 })
        await writeFile(join(directory, 'auth.json'), '{}\n', { flag: 'wx', mode: 0o600 })
        await writeFile(
          join(directory, 'previous-account'),
          (await ready(previous)) ? previous : 'default',
          { mode: 0o600 }
        )
        await select(id)
        break
      }
      case 'use':
        if (!(await ready(id))) throw new Error('Codex account was not found.')
        await select(id)
        break
      case 'finalize':
        if (await ready(id)) break
        if ((await optionalCodexFile(join(directory, 'auth.json'))) === null)
          throw new Error('Pending Codex account was not found.')
        await rename(join(directory, 'pending'), join(directory, 'ready'))
        await rm(join(directory, 'previous-account'), { force: true })
        break
      case 'cancel':
        await rollback(id)
        break
      case 'delete':
        await rm(directory, { recursive: true, force: true })
        if ((await active()) === id) await select('default')
        break
    }
    return ''
  }
}
