import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { hostname } from 'node:os'
import { Bonjour } from 'bonjour-service'
import { LocalAccessPairing } from './localAccessPairing'
import { remoteBrowserRequest } from './remoteBrowser'
import { browseHostDirectory } from './hostDirectory'
import type { AppSelectedAttachment } from '../shared/app'
import {
  localAccessChannels,
  localAccessDefaultPort,
  type LocalAccessOptions,
  type LocalAccessState
} from '../shared/localAccess'
import { diagnosticLog, handleClientRequest, handleLoggedIpc } from './logging'
import { invokeClientRequest, receiveClientMessage } from './clientIpc'
import {
  createLocalAccessToken,
  getLocalAccessAddresses,
  startLocalAccessServer
} from './localAccessServer'

type Configuration = { enabled: boolean; port: number; token: string; computerId: string }
type RendererAssets = { assetsDirectory: string; devRendererUrl?: string }
let configuration: Configuration = {
  enabled: false,
  port: localAccessDefaultPort,
  token: createLocalAccessToken(),
  computerId: randomUUID()
}
let server: Awaited<ReturnType<typeof startLocalAccessServer>> | null = null
let serverError: string | null = null
let configuring: Promise<unknown> = Promise.resolve()
let shuttingDown = false
let pairing: LocalAccessPairing
let discovery: Bonjour | null = null
let discoveryError: string | null = null

const stopDiscovery = async (): Promise<void> => {
  const previous = discovery
  discovery = null
  if (!previous) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1000)
    previous.unpublishAll(() => {
      clearTimeout(timer)
      resolve()
    })
  })
  previous.destroy()
}

const validPort = (port: unknown): port is number =>
  typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535

const state = (): LocalAccessState => ({
  enabled: configuration.enabled,
  port: configuration.port,
  urls: server
    ? getLocalAccessAddresses().map(
        (address) => `http://${address}:${server!.port}/#token=${configuration.token}`
      )
    : [],
  error: serverError,
  computerName: hostname(),
  devices: pairing?.list() ?? [],
  pairingRequests: pairing?.pending() ?? [],
  discoveryError
})

const start = async (assets: RendererAssets): Promise<void> => {
  serverError = null
  if (!configuration.enabled || shuttingDown) return
  try {
    server = await startLocalAccessServer({
      port: configuration.port,
      token: configuration.token,
      authorize: (token) => pairing.authorize(token),
      pair: (request, signal) => pairing.request(request, signal),
      identity: { id: configuration.computerId, name: hostname() },
      ...assets,
      invoke: invokeClientRequest,
      receive: receiveClientMessage
    })
    discoveryError = null
    try {
      discovery = new Bonjour(undefined, (error) => {
        discoveryError = 'Nearby discovery is unavailable. Check your network multicast settings.'
        console.warn('Local-access discovery failed.', error)
      })
      const advertisement = discovery.publish({
        name: `Sele ${configuration.computerId.slice(0, 8)} on ${hostname()}`.slice(0, 63),
        type: 'sele',
        protocol: 'tcp',
        port: server.port,
        txt: { version: '1', name: hostname(), id: configuration.computerId }
      })
      advertisement.on('error', (error) => {
        discoveryError = 'Nearby discovery is unavailable. Check your network multicast settings.'
        console.warn('Unable to advertise local Sele.', error)
      })
    } catch (error) {
      discoveryError = 'Nearby discovery is unavailable. Check your network multicast settings.'
      console.warn('Unable to start local Sele discovery.', error)
    }
  } catch (error) {
    serverError = error instanceof Error ? error.message : String(error)
    console.error('Unable to start local access.', error)
  }
}

export const stopLocalAccess = async (): Promise<void> => {
  shuttingDown = true
  await configuring.catch((error) =>
    console.warn('Local-access configuration failed before shutdown.', error)
  )
  const previous = server
  server = null
  pairing?.cancel()
  await stopDiscovery()
  await previous?.stop()
}

export const registerLocalAccess = async (
  assets: RendererAssets = {
    assetsDirectory: join(__dirname, '../renderer'),
    devRendererUrl: process.env.ELECTRON_RENDERER_URL
  }
): Promise<void> => {
  const directory = app.getPath('userData')
  const path = join(directory, 'local-access.json')
  await mkdir(directory, { recursive: true })
  pairing = new LocalAccessPairing(join(directory, 'local-access-devices.json'))
  await pairing.load()
  try {
    const stored = JSON.parse(await readFile(path, 'utf8')) as Configuration
    if (
      typeof stored.enabled !== 'boolean' ||
      !validPort(stored.port) ||
      typeof stored.token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(stored.token)
    ) {
      throw new Error(
        'Invalid local-access configuration. Configure local access again in Settings.'
      )
    }
    configuration = {
      ...stored,
      computerId: /^[a-f0-9-]{36}$/.test(stored.computerId ?? '')
        ? stored.computerId
        : configuration.computerId
    }
    if (configuration.computerId !== stored.computerId) {
      const temporary = `${path}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify(configuration), { mode: 0o600 })
      await rename(temporary, path)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      serverError = error instanceof Error ? error.message : String(error)
      console.error('Unable to read local-access configuration.', error)
    }
  }
  handleLoggedIpc(localAccessChannels.getState, () => state())
  handleLoggedIpc(
    localAccessChannels.decidePairing,
    async (_event, id: unknown, approve: unknown) => {
      if (typeof id !== 'string' || typeof approve !== 'boolean')
        throw new Error('Invalid pairing decision.')
      await pairing.decide(id, approve)
      return state()
    }
  )
  handleLoggedIpc(localAccessChannels.revokeDevice, async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid device.')
    await pairing.revoke(id)
    server?.disconnectUnauthorized()
    return state()
  })
  handleLoggedIpc(localAccessChannels.configure, (_event, value: LocalAccessOptions) => {
    const operation = async (): Promise<LocalAccessState> => {
      if (shuttingDown) throw new Error('Sele is shutting down.')
      if (
        !value ||
        typeof value.enabled !== 'boolean' ||
        !validPort(value.port) ||
        (value.resetToken !== undefined && typeof value.resetToken !== 'boolean')
      ) {
        throw new Error('Choose a port between 1024 and 65535.')
      }
      const next: Configuration = {
        enabled: value.enabled,
        port: value.port,
        token: value.resetToken ? createLocalAccessToken() : configuration.token,
        computerId: configuration.computerId
      }
      await mkdir(directory, { recursive: true })
      const temporary = `${path}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 })
      await rename(temporary, path)
      configuration = next
      const previous = server
      server = null
      pairing.cancel()
      await stopDiscovery()
      await previous?.stop()
      await start(assets)
      return state()
    }
    configuring = configuring
      .catch((error) => console.warn('Previous local-access configuration failed.', error))
      .then(operation)
    return configuring
  })

  handleClientRequest(localAccessChannels.uploadAttachments, async (_event, value: unknown) => {
    if (!Array.isArray(value) || !value.length || value.length > 10) {
      throw new Error('Choose between one and ten attachments.')
    }
    let total = 0
    for (const file of value) {
      if (
        !file ||
        typeof file.name !== 'string' ||
        file.name.length > 255 ||
        typeof file.type !== 'string' ||
        !(file.data instanceof ArrayBuffer)
      ) {
        throw new Error('Invalid attachment.')
      }
      total += file.data.byteLength
    }
    if (total > 32 * 1024 * 1024) throw new Error('Choose attachments smaller than 32 MB in total.')
    const target = join(directory, 'local-access-attachments')
    await mkdir(target, { recursive: true, mode: 0o700 })
    return Promise.all(
      value.map(async (file): Promise<AppSelectedAttachment> => {
        const name =
          Array.from(basename(file.name.replace(/\\/g, '/')), (character) =>
            character < ' ' ? '_' : character
          ).join('') || 'attachment'
        const path = join(target, `${randomUUID()}-${name.slice(0, 40)}`)
        await writeFile(path, Buffer.from(file.data), { mode: 0o600 })
        const image = /^image\/(png|jpeg|gif|webp|avif|svg\+xml)$/.test(file.type)
        return image
          ? {
              kind: 'image',
              name,
              path,
              dataUrl: `data:${file.type};base64,${Buffer.from(file.data).toString('base64')}`
            }
          : { kind: 'file', name, path }
      })
    )
  })
  handleClientRequest(localAccessChannels.readDiagnosticLog, () => diagnosticLog.snapshot())
  handleClientRequest(localAccessChannels.remoteBrowser, (event, request: unknown) =>
    remoteBrowserRequest(event.sender, request)
  )
  handleClientRequest(localAccessChannels.browseHostDirectory, (_event, path: unknown) =>
    browseHostDirectory(path)
  )
  if (!serverError) await start(assets)
}
