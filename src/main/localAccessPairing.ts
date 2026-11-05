import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, rename } from 'node:fs/promises'
import type { LocalAccessDevice, LocalAccessPairingRequest } from '../shared/localAccess'

type Device = LocalAccessDevice & { tokenHash: string }
type Request = LocalAccessPairingRequest & {
  device: Device
  finish(approved: boolean): void
  decision?: { approve: boolean; promise: Promise<void> }
}
const hash = (token: string): string => createHash('sha256').update(token).digest('hex')
export class LocalAccessPairing {
  private devices: Device[] = []
  private requests = new Map<string, Request>()
  private saving: Promise<void> = Promise.resolve()
  constructor(private path: string) {}

  async load(): Promise<void> {
    try {
      const devices: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      if (
        !Array.isArray(devices) ||
        devices.some(
          (device) =>
            !device ||
            typeof device.id !== 'string' ||
            typeof device.name !== 'string' ||
            !Number.isFinite(device.pairedAt) ||
            !/^[a-f0-9]{64}$/.test(device.tokenHash)
        )
      )
        throw new Error('Invalid saved paired devices.')
      this.devices = devices
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  list(): LocalAccessDevice[] {
    return this.devices.map(({ id, name, pairedAt }) => ({ id, name, pairedAt }))
  }
  pending(): LocalAccessPairingRequest[] {
    return [...this.requests.values()].map(({ id, name, expiresAt }) => ({ id, name, expiresAt }))
  }
  authorize(token: string): boolean {
    return (
      /^[a-f0-9]{64}$/.test(token) &&
      this.devices.some((device) => device.tokenHash === hash(token))
    )
  }
  request(value: unknown, signal: AbortSignal): Promise<boolean> {
    const data = value as Record<string, unknown> | null
    if (
      !data ||
      typeof data.deviceId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(data.deviceId) ||
      typeof data.name !== 'string' ||
      !data.name.trim() ||
      data.name.length > 80 ||
      Array.from(data.name).some(
        (character) => character < ' ' || character.charCodeAt(0) === 127
      ) ||
      typeof data.token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(data.token)
    )
      return Promise.reject(new Error('Invalid pairing request.'))
    if (
      this.requests.size >= 3 ||
      [...this.requests.values()].some((entry) => entry.device.id === data.deviceId)
    )
      return Promise.reject(new Error('A pairing request is already waiting. Try again shortly.'))
    if (this.devices.length >= 20)
      return Promise.reject(
        new Error('Remove an old device in Sele settings before pairing another.')
      )
    return new Promise((resolve) => {
      const id = randomUUID()
      const finish = (approved: boolean): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', aborted)
        this.requests.delete(id)
        resolve(approved)
      }
      const aborted = (): void => finish(false)
      const timer = setTimeout(aborted, 120_000)
      this.requests.set(id, {
        id,
        name: (data.name as string).trim(),
        expiresAt: Date.now() + 120_000,
        finish,
        device: {
          id: data.deviceId as string,
          name: (data.name as string).trim(),
          tokenHash: hash(data.token as string),
          pairedAt: Date.now()
        }
      })
      signal.addEventListener('abort', aborted, { once: true })
      if (signal.aborted) aborted()
    })
  }
  private persist(update: (devices: Device[]) => Device[]): Promise<void> {
    const operation = async (): Promise<void> => {
      const next = update(this.devices)
      const temporary = `${this.path}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 })
      await rename(temporary, this.path)
      this.devices = next
    }
    this.saving = this.saving
      .catch((error) => console.warn('Previous paired-device save failed.', error))
      .then(operation)
    return this.saving
  }
  decide(id: string, approve: boolean): Promise<void> {
    const request = this.requests.get(id)
    if (!request || request.expiresAt <= Date.now())
      return Promise.reject(new Error('This pairing request has expired.'))
    if (request.decision) {
      return request.decision.approve === approve
        ? request.decision.promise
        : Promise.reject(new Error('This pairing request is already being decided.'))
    }
    const decision = { approve, promise: Promise.resolve() }
    request.decision = decision
    decision.promise = Promise.resolve()
      .then(async () => {
        if (approve) {
          await this.persist((devices) => {
            if (this.requests.get(id) !== request || request.expiresAt <= Date.now())
              throw new Error('This pairing request has expired.')
            // Capacity belongs to the serialized commit, not the earlier request admission.
            if (devices.length >= 20 && !devices.some((device) => device.id === request.device.id))
              throw new Error('Remove an old device in Sele settings before pairing another.')
            return [...devices.filter((device) => device.id !== request.device.id), request.device]
          })
          // A canceled request must not authorize access or revoke a newer pairing for this device.
          if (this.requests.get(id) !== request) {
            await this.persist((devices) =>
              devices.filter(
                (device) =>
                  device.id !== request.device.id || device.tokenHash !== request.device.tokenHash
              )
            )
            return
          }
        }
        request.finish(approve)
      })
      .finally(() => {
        if (request.decision === decision) request.decision = undefined
      })
    return decision.promise
  }
  revoke(id: string): Promise<void> {
    return this.persist((devices) => devices.filter((device) => device.id !== id))
  }
  cancel(): void {
    for (const request of this.requests.values()) request.finish(false)
  }
}
