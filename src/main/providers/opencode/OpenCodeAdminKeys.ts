import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isExpectedFileAbsenceError } from '../../../shared/expectedAbsence.ts'

/**
 * Admin, management and organization keys only read billing data; providers reject them for
 * model requests. Sele keeps them in its own store instead of OpenCode's auth.json so OpenCode
 * never tries to run models with them.
 */
export const openCodeAdminKeyProviders: Record<
  string,
  { label: string; pattern: RegExp | null; placeholder: string }
> = {
  anthropic: {
    label: 'Admin key (usage only)',
    pattern: /^sk-ant-admin/,
    placeholder: 'sk-ant-admin…'
  },
  openai: { label: 'Admin key (usage only)', pattern: /^sk-admin-/, placeholder: 'sk-admin-…' },
  openrouter: { label: 'Management key (usage only)', pattern: null, placeholder: 'sk-or-v1-…' }
}

export const openCodeAdminKeyMethodId = 'sele-admin'
export const openCodeAdminConnectionPrefix = 'sele-admin:'

export const isOpenCodeAdminKey = (providerId: string, key: string): boolean =>
  Boolean(openCodeAdminKeyProviders[providerId]?.pattern?.test(key.trim()))

export const supportsOpenCodeAdminKey = (providerId: string): boolean =>
  Object.hasOwn(openCodeAdminKeyProviders, providerId)

export const getOpenCodeAdminConnectionId = (providerId: string): string =>
  `${openCodeAdminConnectionPrefix}${providerId}`

export const parseOpenCodeAdminConnectionId = (credentialId: string): string | null =>
  credentialId.startsWith(openCodeAdminConnectionPrefix)
    ? credentialId.slice(openCodeAdminConnectionPrefix.length) || null
    : null

export type OpenCodeAdminKeyCrypto = {
  isEncryptionAvailable: () => boolean
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
}

type StoredKey = { encoding: 'safeStorage' | 'plain'; value: string }
type StoredFile = { version: 1; keys: Record<string, StoredKey> }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export class OpenCodeAdminKeyStore {
  private writes: Promise<unknown> = Promise.resolve()
  private readonly getFilePath: () => Promise<string>
  private readonly getCrypto: () => Promise<OpenCodeAdminKeyCrypto | null>

  constructor(
    getFilePath: () => Promise<string>,
    getCrypto: () => Promise<OpenCodeAdminKeyCrypto | null>
  ) {
    this.getFilePath = getFilePath
    this.getCrypto = getCrypto
  }

  private readStored = async (): Promise<StoredFile> => {
    let content: string
    try {
      content = await readFile(await this.getFilePath(), 'utf8')
    } catch (error) {
      if (isExpectedFileAbsenceError(error)) return { version: 1, keys: {} }
      throw new Error('Unable to read saved admin keys.')
    }
    try {
      const parsed: unknown = JSON.parse(content)
      if (!isRecord(parsed) || !isRecord(parsed.keys)) return { version: 1, keys: {} }
      const keys: Record<string, StoredKey> = {}
      for (const [providerId, entry] of Object.entries(parsed.keys)) {
        if (
          isRecord(entry) &&
          (entry.encoding === 'safeStorage' || entry.encoding === 'plain') &&
          typeof entry.value === 'string'
        )
          keys[providerId] = { encoding: entry.encoding, value: entry.value }
      }
      return { version: 1, keys }
    } catch (error) {
      console.error('[caught:OpenCodeAdminKeyStore:read]', error)
      return { version: 1, keys: {} }
    }
  }

  private writeStored = async (stored: StoredFile): Promise<void> => {
    const path = await this.getFilePath()
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const temporary = join(dirname(path), `.opencode-admin-keys-${randomUUID()}.json`)
    try {
      await writeFile(temporary, JSON.stringify(stored), { mode: 0o600, flag: 'wx' })
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true })
    }
  }

  private serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const next = this.writes.then(run, run)
    this.writes = next.catch(() => undefined)
    return next
  }

  /** Saved admin keys, keyed by OpenCode provider ID. Keys that cannot be decrypted are skipped. */
  list = async (): Promise<Record<string, string>> => {
    await this.writes
    const stored = await this.readStored()
    const crypto = await this.getCrypto()
    const keys: Record<string, string> = {}
    for (const [providerId, entry] of Object.entries(stored.keys)) {
      try {
        if (entry.encoding === 'plain') keys[providerId] = entry.value
        else if (crypto?.isEncryptionAvailable())
          keys[providerId] = crypto.decryptString(Buffer.from(entry.value, 'base64'))
      } catch (error) {
        console.error('[caught:OpenCodeAdminKeyStore:decrypt]', providerId, error)
      }
    }
    return keys
  }

  set = (providerId: string, key: string): Promise<void> =>
    this.serialize(async () => {
      const stored = await this.readStored()
      const crypto = await this.getCrypto()
      stored.keys[providerId] = crypto?.isEncryptionAvailable()
        ? { encoding: 'safeStorage', value: crypto.encryptString(key).toString('base64') }
        : { encoding: 'plain', value: key }
      await this.writeStored(stored)
    })

  remove = (providerId: string): Promise<void> =>
    this.serialize(async () => {
      const stored = await this.readStored()
      if (!Object.hasOwn(stored.keys, providerId)) return
      delete stored.keys[providerId]
      await this.writeStored(stored)
    })
}

export const createOpenCodeAdminKeyStore = (): OpenCodeAdminKeyStore =>
  new OpenCodeAdminKeyStore(
    async () => {
      const { app } = await import('electron')
      return join(app.getPath('userData'), 'opencode-admin-keys.json')
    },
    async () => {
      try {
        const { safeStorage } = await import('electron')
        return safeStorage ?? null
      } catch (error) {
        console.error('[caught:OpenCodeAdminKeyStore:safeStorage]', error)
        return null
      }
    }
  )
