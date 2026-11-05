import { Capacitor } from '@capacitor/core'
import { localNetwork, type NearbyComputer } from './nativeLocalNetwork'
export { localNetwork, type NearbyComputer } from './nativeLocalNetwork'
import { localAccessProtocolVersion } from '../../shared/localAccess'
import {
  mobileWebSocketUrl,
  parseMobileConnection,
  type MobileConnection
} from './mobileConnection'

export const nativeDiscoveryAvailable = (): boolean => Capacitor.isNativePlatform()

export const pairComputer = async (
  computer: NearbyComputer,
  signal: AbortSignal
): Promise<MobileConnection> => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  const connection: MobileConnection = {
    ...parseMobileConnection(`${computer.origin}/#token=${token}`),
    name: computer.name,
    ...(/^[a-f0-9-]{36}$/.test(computer.id) ? { hostId: computer.id } : {})
  }
  const device = nativeDiscoveryAvailable()
    ? await localNetwork.deviceInfo()
    : {
        id: crypto.randomUUID(),
        name: 'Android preview'
      }
  if (signal.aborted) throw new Error('Pairing canceled.')
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(mobileWebSocketUrl(connection))
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
    const timeout = setTimeout(
      () =>
        finish(new Error('Approval timed out. Try again and allow the request on your computer.')),
      125_000
    )
    signal.addEventListener('abort', abort, { once: true })
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          type: 'pair',
          version: localAccessProtocolVersion,
          deviceId: device.id,
          name: device.name,
          token
        })
      )
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
          'Cannot reach Sele. Check that both devices are on the same Wi-Fi and local network access is enabled.'
        )
      )
    socket.onclose = () =>
      finish(new Error('Pairing ended. Check Sele on your computer and try again.'))
  })
}

/** A saved pairing follows its computer when DHCP changes the LAN address. */
export const findSavedComputer = async (
  connection: MobileConnection
): Promise<MobileConnection> => {
  if (!connection.hostId || !nativeDiscoveryAvailable()) return connection
  try {
    await localNetwork.startDiscovery()
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      const { services } = await localNetwork.getServices()
      const found = services.find((service) => service.id === connection.hostId)
      if (found)
        return {
          ...connection,
          ...parseMobileConnection(`${found.origin}/#token=${connection.token}`),
          name: found.name
        }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  } catch (error) {
    console.warn('Unable to rediscover the saved Sele computer.', error)
  } finally {
    await localNetwork
      .stopDiscovery()
      .catch((error) => console.warn('Unable to stop saved-host discovery.', error))
  }
  return connection
}
