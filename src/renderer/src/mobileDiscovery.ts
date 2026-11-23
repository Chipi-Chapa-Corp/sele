import { Capacitor } from '@capacitor/core'
import { localNetwork, type NearbyComputer } from './nativeLocalNetwork'
export { localNetwork, type NearbyComputer } from './nativeLocalNetwork'
import { localAccessProtocolVersion, localAccessPairingCode } from '../../shared/localAccess'
import { createLanSocket, inspectComputerCertificate } from './secureLanSocket'
import {
  mobileWebSocketUrl,
  parseMobileConnection,
  type MobileConnection
} from './mobileConnection'

export const nativeDiscoveryAvailable = (): boolean => Capacitor.isNativePlatform()

export const pairComputer = async (
  computer: NearbyComputer,
  signal: AbortSignal,
  onSecurityCode?: (code: string) => void
): Promise<MobileConnection> => {
  const device = nativeDiscoveryAvailable()
    ? await localNetwork.deviceInfo()
    : { id: crypto.randomUUID(), name: 'Android preview' }
  let failure: unknown
  for (const origin of new Set([computer.origin, ...(computer.origins ?? [])])) {
    if (signal.aborted) throw new Error('Pairing canceled.')
    let approvalRequested = false
    try {
      return await requestPairing(computer, origin, device, signal, (code) => {
        approvalRequested = true
        onSecurityCode?.(code)
      })
    } catch (error) {
      if (approvalRequested || signal.aborted) throw error
      failure ??= error
    }
  }
  throw failure ?? new Error('No address is available for this computer.')
}

async function requestPairing(
  computer: NearbyComputer,
  origin: string,
  device: { id: string; name: string },
  signal: AbortSignal,
  onSecurityCode: (code: string) => void
): Promise<MobileConnection> {
  const fingerprint = await inspectComputerCertificate(origin, signal)
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  const securityCode = await localAccessPairingCode(fingerprint, token)
  const connection: MobileConnection = {
    ...parseMobileConnection(`${origin}/#token=${token}&fingerprint=${fingerprint}`),
    name: computer.name,
    ...(/^[a-f0-9-]{36}$/.test(computer.id) ? { hostId: computer.id } : {})
  }
  if (signal.aborted) throw new Error('Pairing canceled.')
  return new Promise((resolve, reject) => {
    const socket = createLanSocket(mobileWebSocketUrl(connection), fingerprint)
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      socket.close()
      if (error) reject(error)
      else resolve(connection)
    }
    const abort = (): void => finish(new Error('Pairing canceled.'))
    let timeout = setTimeout(
      () => finish(new Error('The computer did not open an encrypted Sele connection.')),
      5000
    )
    signal.addEventListener('abort', abort, { once: true })
    socket.onopen = () => {
      if (settled) return
      clearTimeout(timeout)
      timeout = setTimeout(
        () =>
          finish(
            new Error('Approval timed out. Try again and allow the request on your computer.')
          ),
        125_000
      )
      // After requesting approval an automatic retry could prompt twice, or
      // send the approval request to a different computer.
      onSecurityCode(securityCode)
      try {
        socket.send(
          JSON.stringify({
            type: 'pair',
            version: localAccessProtocolVersion,
            deviceId: device.id,
            name: device.name,
            token
          })
        )
      } catch (error) {
        finish(error as Error)
      }
    }
    socket.onmessage = (event) => {
      try {
        const result = JSON.parse(event.data)
        if (result.type === 'pairing') {
          if (result.approved && /^[a-f0-9-]{36}$/.test(result.computer?.id ?? '')) {
            connection.hostId = result.computer.id
            if (typeof result.computer.name === 'string' && result.computer.name.length <= 80)
              connection.name = result.computer.name
          }
          finish(
            result.approved
              ? undefined
              : new Error(
                  'The request was declined or expired. Try again when your computer is ready.'
                )
          )
        }
      } catch (error) {
        console.warn('Invalid pairing response.', error)
        finish(new Error('Unable to pair with this Sele computer.'))
      }
    }
    socket.onerror = () =>
      finish(
        new Error(
          'Cannot reach Sele. Check that both devices are on your local network and local network access is enabled.'
        )
      )
    socket.onclose = () =>
      finish(
        new Error(
          socket.connectionFailure ?? 'Pairing ended. Check Sele on your computer and try again.'
        )
      )
  })
}

/** One discovery owner serves the chooser and reconnecting transport. NSD loss
 * is a discovery hint, never evidence that an established socket should close. */
const watchers = new Set<(computers: NearbyComputer[], error?: string) => void>()
let discoveryWork = Promise.resolve()
let discoveryTimer: ReturnType<typeof setTimeout> | undefined
let discovered: NearbyComputer[] = []
let discoveryGeneration = 0

export const restartNearbyDiscovery = (): void => {
  if (!watchers.size || !nativeDiscoveryAvailable()) return
  discoveryWork = discoveryWork
    .catch(() => {})
    .then(async () => {
      await localNetwork.stopDiscovery()
      if (watchers.size) await localNetwork.startDiscovery()
    })
    .catch((error) => console.warn('Unable to restart device discovery.', error))
}

export const mergeNearbyComputers = (services: NearbyComputer[]): NearbyComputer[] => {
  const computers = new Map<string, NearbyComputer>()
  for (const service of services) {
    const previous = computers.get(service.id)
    const origins = [
      ...new Set([...(previous?.origins ?? []), ...(service.origins ?? []), service.origin])
    ]
    computers.set(service.id, { ...service, origin: origins[0], origins })
  }
  return [...computers.values()]
}

export const watchNearbyComputers = (
  listener: (computers: NearbyComputer[], error?: string) => void
): (() => void) => {
  watchers.add(listener)
  listener(discovered)
  if (watchers.size === 1 && nativeDiscoveryAvailable()) {
    const generation = ++discoveryGeneration
    const poll = async (): Promise<void> => {
      if (generation !== discoveryGeneration) return
      try {
        const result = await localNetwork.getServices()
        if (generation !== discoveryGeneration) return
        discovered = mergeNearbyComputers(result.services)
        watchers.forEach((watcher) => watcher(discovered, result.error))
      } catch (error) {
        console.warn('Unable to discover Sele devices.', error)
        if (generation === discoveryGeneration)
          watchers.forEach((watcher) =>
            watcher(
              discovered,
              'Device discovery is unavailable. Check your local network and try again.'
            )
          )
      }
      if (generation === discoveryGeneration) discoveryTimer = setTimeout(() => void poll(), 1000)
    }
    discoveryWork = discoveryWork
      .catch(() => {})
      .then(async () => {
        if (generation !== discoveryGeneration) return
        await localNetwork.startDiscovery()
      })
      .catch((error) => {
        console.warn('Unable to start device discovery.', error)
        if (generation === discoveryGeneration)
          watchers.forEach((watcher) =>
            watcher(discovered, 'Could not search for devices. Check your network connection.')
          )
      })
      .finally(() => void poll())
  }
  return () => {
    watchers.delete(listener)
    if (watchers.size) return
    discoveryGeneration++
    clearTimeout(discoveryTimer)
    if (nativeDiscoveryAvailable())
      discoveryWork = discoveryWork
        .catch(() => {})
        .then(() => localNetwork.stopDiscovery())
        .catch((error) => console.warn('Unable to stop device discovery.', error))
  }
}
