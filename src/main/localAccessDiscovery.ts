import { randomInt } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { getResponder, type Responder } from '@homebridge/ciao'
import { decode, encode } from 'dns-packet'
import { localAccessProtocolVersion } from '../shared/localAccess.ts'

const serviceType = '_sele._tcp.local'
const multicast = '224.0.0.251'
const multicastPort = 5353

const localInterfaces = (): { name: string; address: string }[] =>
  Object.entries(networkInterfaces()).flatMap(([name, addresses]) => {
    const ipv4 = addresses?.find((entry) => entry.family === 'IPv4' && !entry.internal)
    return ipv4 ? [{ name, address: ipv4.address }] : []
  })

function verifyAdvertisement(
  address: string,
  advertisedName: () => string,
  port: number,
  signal: AbortSignal
) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const socket = createSocket('udp4')
    const id = randomInt(1, 65536)
    const query = encode({ id, type: 'query', questions: [{ name: serviceType, type: 'PTR' }] })
    let timer: ReturnType<typeof setInterval> | undefined
    let finished = false
    const finish = (error?: Error): void => {
      if (finished) return
      finished = true
      clearInterval(timer)
      signal.removeEventListener('abort', abort)
      socket.close()
      if (error) reject(error)
      else resolve()
    }
    const abort = (): void => finish(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    socket.on('error', finish)
    socket.on('message', (data, peer) => {
      if (peer.address !== address || peer.port !== multicastPort) return
      try {
        const reply = decode(data)
        if (reply.type !== 'response' || reply.id !== id) return
        const service = [...(reply.answers ?? []), ...(reply.additionals ?? [])]
        const name = advertisedName()
        if (
          service.some(
            (record) =>
              record.type === 'SRV' &&
              record.name.toLowerCase() === name &&
              record.data.port === port
          )
        )
          finish()
      } catch {
        // Other local multicast responders may send packets unrelated to Sele.
      }
    })
    // An ephemeral source port asks mDNS for a unicast response to this socket.
    socket.bind(0, address, () => {
      if (finished) return
      try {
        socket.setMulticastInterface(address)
        socket.setMulticastLoopback(true)
        socket.setMulticastTTL(255)
        const send = (): void =>
          socket.send(query, multicastPort, multicast, (error) => {
            if (error) finish(error)
          })
        timer = setInterval(send, 1000)
        send()
      } catch (error) {
        finish(error as Error)
      }
    })
  })
}

export function startLocalAccessDiscovery(
  options: { computerId: string; computerName: string; port: number },
  report: (error: string | null) => void
): () => Promise<void> {
  const lifetime = new AbortController()
  let responder: Responder | undefined
  let advertisedName = () => ''
  let networkKey = ''
  let verifiedAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let current: Promise<void>
  const unavailable = 'Multicast discovery could not be verified.'

  const stopResponder = async (): Promise<void> => {
    const previous = responder
    responder = undefined
    await previous
      ?.shutdown()
      .catch((error) => console.warn('Unable to stop nearby discovery.', error))
  }

  const refresh = async (): Promise<void> => {
    const networks = localInterfaces().sort((left, right) => left.name.localeCompare(right.name))
    const key = JSON.stringify(networks)
    if (key !== networkKey || !verifiedAt) {
      await stopResponder()
      if (lifetime.signal.aborted) return
      networkKey = key
      verifiedAt = 0
      if (!networks.length) {
        report('No local IPv4 address is available for nearby discovery.')
        return
      }
      // Explicit interface names keep discovery independent of the OS ARP cache.
      responder = getResponder({ disableIpv6: true, interface: networks.map(({ name }) => name) })
      const service = responder.createService({
        name: `Sele ${options.computerId.slice(0, 8)}`,
        hostname: `sele-${options.computerId}`,
        type: 'sele',
        port: options.port,
        txt: {
          version: String(localAccessProtocolVersion),
          tls: '1',
          name: options.computerName,
          id: options.computerId
        }
      })
      advertisedName = () => service.getFQDN().slice(0, -1).toLowerCase()
      void service
        .advertise()
        .catch((error) => console.warn('Unable to advertise Sele nearby.', error))
    }
    if (Date.now() - verifiedAt < 30_000) return

    // Ciao can announce successfully with only a loopback socket. Check for a
    // response on a real adapter, including failures while macOS awaits consent.
    const probes = new AbortController()
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(3000), probes.signal])
    try {
      await Promise.any(
        networks.map(({ address }) =>
          verifyAdvertisement(address, advertisedName, options.port, signal)
        )
      )
      verifiedAt = Date.now()
      if (!lifetime.signal.aborted) report(null)
    } finally {
      probes.abort()
    }
  }

  const check = (): void => {
    current = refresh()
      .catch(() => {
        verifiedAt = 0
        if (!lifetime.signal.aborted) report(unavailable)
      })
      .finally(() => {
        if (!lifetime.signal.aborted) timer = setTimeout(check, 5000).unref()
      })
  }
  check()
  return async () => {
    lifetime.abort()
    clearTimeout(timer)
    await current
    await stopResponder()
  }
}
