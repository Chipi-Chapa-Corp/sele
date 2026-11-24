import { createSocket } from 'node:dgram'
import { BlockList } from 'node:net'
import { networkInterfaces } from 'node:os'
import { localAccessDefaultPort } from '../shared/localAccess.ts'

const packetSize = 512

export function startLocalAccessBroadcast(identity: { id: string; name: string; port: number }) {
  const socket = createSocket('udp4')
  let closing: Promise<void> | undefined
  const stop = (): Promise<void> => (closing ??= new Promise((resolve) => socket.close(resolve)))
  socket.on('error', (error) => {
    console.warn('Local broadcast discovery is unavailable.', error)
    void stop()
  })
  socket.on('message', (request, peer) => {
    // Reply only to this protocol on directly connected LANs. Replies are
    // smaller than queries and contain the same public data as DNS-SD.
    if (request.length !== packetSize) return
    const match = /^SELE-DISCOVER-1 ([a-f0-9]{32}) {464}$/.exec(request.toString('latin1'))
    if (!match) return
    const subnets = new BlockList()
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family !== 'IPv4' || entry.internal || !entry.cidr) continue
        const prefix = Number(entry.cidr.split('/')[1])
        if (prefix > 0) subnets.addSubnet(entry.address, prefix)
      }
    }
    if (!subnets.check(peer.address)) return
    const response = Buffer.from(
      JSON.stringify({
        nonce: match[1],
        id: identity.id,
        name: identity.name.slice(0, 80),
        port: identity.port
      })
    )
    if (response.length <= packetSize) socket.send(response, peer.port, peer.address, () => {})
  })
  socket.bind(localAccessDefaultPort, '0.0.0.0', () => socket.unref())
  return stop
}
