import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface ChromePairing {
  port: number
  token: string
}
export interface ChromePairingStore {
  load(): Promise<ChromePairing | null>
  save(value: ChromePairing): Promise<void>
  clear(): Promise<void>
}
export function validatePairing(value: unknown): ChromePairing {
  const config = value as ChromePairing
  if (
    !config ||
    !Number.isInteger(config.port) ||
    config.port < 1024 ||
    config.port > 65535 ||
    typeof config.token !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(config.token)
  )
    throw new Error('Invalid saved Chrome pairing. Generate a new pairing address in Settings.')
  return { port: config.port, token: config.token }
}
interface Encryption {
  isEncryptionAvailable(): boolean
  getSelectedStorageBackend?(): string
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}
/** Credentials are encrypted by the OS, never written as plaintext. */
export class EncryptedChromePairingStore implements ChromePairingStore {
  private path: () => string
  private encryption: () => Promise<Encryption>
  constructor(path: () => string, encryption: () => Promise<Encryption>) {
    this.path = path
    this.encryption = encryption
  }
  private async cipher(): Promise<Encryption> {
    const cipher = await this.encryption()
    if (!cipher.isEncryptionAvailable())
      throw new Error('OS encrypted storage is unavailable for Chrome pairing.')
    if (cipher.getSelectedStorageBackend?.() === 'basic_text')
      throw new Error(
        'Chrome pairing requires an OS secret store. Enable GNOME Keyring/libsecret or KWallet on Linux; basic_text is not supported.'
      )
    return cipher
  }
  async load(): Promise<ChromePairing | null> {
    let data: string
    try {
      data = await readFile(this.path(), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    const envelope = JSON.parse(data)
    if (
      envelope.version !== 1 ||
      typeof envelope.encrypted !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        envelope.encrypted
      ) ||
      !envelope.encrypted
    )
      throw new Error('Invalid encrypted Chrome pairing file.')
    return validatePairing(
      JSON.parse((await this.cipher()).decryptString(Buffer.from(envelope.encrypted, 'base64')))
    )
  }
  async save(value: ChromePairing): Promise<void> {
    const encrypted = (await this.cipher()).encryptString(JSON.stringify(validatePairing(value)))
    const path = this.path()
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(
        temporary,
        JSON.stringify({ version: 1, encrypted: encrypted.toString('base64') }),
        { mode: 0o600, flag: 'wx' }
      )
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  async clear(): Promise<void> {
    await rm(this.path(), { force: true })
  }
}
