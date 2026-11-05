import { randomBytes, timingSafeEqual } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFile, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { hostname, networkInterfaces } from 'node:os'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import type { RendererClient } from './clientIpc'
import {
  decodeClientMessage,
  encodeClientMessage,
  localAccessAndroidOrigin,
  localAccessProtocolVersion
} from '../shared/localAccess'

type Options = {
  port: number
  token: string
  authorize?(token: string): boolean
  pair?(request: unknown, signal: AbortSignal): Promise<boolean>
  identity?: { id: string; name: string }
  assetsDirectory: string
  devRendererUrl?: string
  devProjectDirectory?: string
  host?: string
  invoke(client: RendererClient, channel: string, args: unknown[]): unknown
  receive(client: RendererClient, channel: string, args: unknown[]): void
}

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm'
}

let nextClientId = -1 // Electron WebContents IDs are positive.
export const createLocalAccessToken = (): string => randomBytes(32).toString('hex')
export const getLocalAccessAddresses = (): string[] => [
  ...new Set(
    Object.values(networkInterfaces()).flatMap((entries) =>
      (entries ?? [])
        .filter((entry) => entry.family === 'IPv4' && !entry.internal)
        .map((entry) => entry.address)
    )
  )
]

const authenticate = (candidate: unknown, token: string): boolean => {
  if (typeof candidate !== 'string' || candidate.length !== token.length) return false
  const bytes = Buffer.from(candidate)
  const expected = Buffer.from(token)
  return bytes.length === expected.length && timingSafeEqual(bytes, expected)
}

export const startLocalAccessServer = async (options: Options) => {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 48 * 1024 * 1024 })
  const hotSockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
  let port = options.port
  let stopping = false
  const authorizations = new Map<WebSocket, string>()
  const pairingAttempts = new Map<string, { count: number; reset: number }>()
  const authorized = (token: unknown): boolean =>
    authenticate(token, options.token) ||
    (typeof token === 'string' && Boolean(options.authorize?.(token)))
  const allowedHost = (request: IncomingMessage): boolean => {
    try {
      const url = new URL(`http://${request.headers.host}`)
      const hosts = new Set(
        [
          'localhost',
          '127.0.0.1',
          hostname(),
          `${hostname()}.local`,
          ...getLocalAccessAddresses()
        ].map((host) => host.toLowerCase())
      )
      return (
        !url.username && !url.password && hosts.has(url.hostname) && Number(url.port || 80) === port
      )
    } catch {
      console.warn('Rejected an invalid local-access Host header.')
      return false
    }
  }

  const serve = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Frame-Options', 'DENY')
    if (!allowedHost(request)) {
      response.writeHead(403).end('Invalid host')
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end()
      return
    }
    const rawPath = decodeURIComponent((request.url ?? '/').split('?')[0])
    if (rawPath.includes('\\') || rawPath.includes('\0') || rawPath.split('/').includes('..')) {
      response.writeHead(404).end()
      return
    }
    const url = new URL(request.url ?? '/', 'http://localhost')
    let data: Buffer
    let contentType: string
    if (options.devRendererUrl) {
      // Vite can serve filesystem modules. Only expose frontend source and its
      // dependencies, never arbitrary files from the project or host.
      const project = options.devProjectDirectory ?? resolve(options.assetsDirectory, '../..')
      const path = url.pathname.startsWith('/@fs/')
        ? relative(project, resolve('/', rawPath.slice('/@fs/'.length))).replace(/\\/g, '/')
        : null
      const allowed =
        path === null
          ? url.pathname === '/' ||
            ['/src/', '/node_modules/', '/@id/'].some((prefix) =>
              url.pathname.startsWith(prefix)
            ) ||
            ['/index.html', '/@vite/client', '/@vite/env', '/@react-refresh'].includes(url.pathname)
          : ['src/renderer/', 'src/shared/', 'node_modules/'].some((prefix) =>
              path.startsWith(prefix)
            ) || path === 'package.json'
      if (!allowed) {
        response.writeHead(404).end()
        return
      }
      // Proxy only paths to Sele's fixed Vite origin, never a client-supplied destination.
      const target = new URL(options.devRendererUrl)
      target.pathname = url.pathname
      target.search = url.search
      const upstream = await fetch(target, {
        signal: AbortSignal.timeout(15_000),
        redirect: 'error'
      })
      if (!upstream.ok) {
        response.writeHead(upstream.status).end()
        return
      }
      data = Buffer.from(await upstream.arrayBuffer())
      contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
    } else {
      const path = resolve(
        options.assetsDirectory,
        `.${url.pathname === '/' ? '/index.html' : url.pathname}`
      )
      const child = relative(options.assetsDirectory, path)
      if (child.startsWith('..') || isAbsolute(child) || !contentTypes[extname(path)]) {
        response.writeHead(404).end()
        return
      }
      const info = await stat(path)
      if (!info.isFile()) {
        response.writeHead(404).end()
        return
      }
      data = await readFile(path)
      contentType = contentTypes[extname(path)]
    }
    if (contentType.startsWith('text/html')) {
      // Replace the desktop custom-protocol policy with the LAN policy below.
      data = Buffer.from(
        data
          .toString('utf8')
          .replace(/<meta\s[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '')
      )
    }
    response.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        `script-src 'self'${options.devRendererUrl ? " 'unsafe-inline'" : ''}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob:",
        "font-src 'self' data:",
        "worker-src 'self' blob:",
        `connect-src 'self' ws://${request.headers.host}`,
        "frame-src 'none'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'"
      ].join('; ')
    )
    response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': data.length })
    response.end(request.method === 'HEAD' ? undefined : data)
  }

  const server = createServer((request, response) => {
    void serve(request, response).catch((error: NodeJS.ErrnoException) => {
      if (!['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code ?? ''))
        console.warn('Unable to serve local-access assets.', error)
      if (!response.headersSent) response.writeHead(404)
      response.end('Not found')
    })
  })
  server.on('upgrade', (request, socket, head) => {
    if (
      stopping ||
      !allowedHost(request) ||
      (request.headers.origin !== `http://${request.headers.host}` &&
        !(request.url === '/sele/ws' && request.headers.origin === localAccessAndroidOrigin)) ||
      sockets.clients.size + hotSockets.clients.size >= 64
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    if (
      options.devRendererUrl &&
      request.headers['sec-websocket-protocol'] === 'vite-hmr' &&
      /^\/\?token=[\w-]+$/.test(request.url ?? '')
    ) {
      const target = new URL(options.devRendererUrl)
      target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'
      target.pathname = '/'
      target.search = new URL(request.url!, 'http://localhost').search
      const upstream = new WebSocket(target, 'vite-hmr', { handshakeTimeout: 5000 })
      upstream.on('error', () => {
        socket.destroy()
        upstream.terminate()
      })
      upstream.once('open', () => {
        hotSockets.handleUpgrade(request, socket, head, (downstream) => {
          upstream.on('message', (data, binary) => {
            if (downstream.readyState === WebSocket.OPEN) downstream.send(data, { binary })
          })
          downstream.on('message', (data, binary) => {
            if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary })
          })
          downstream.on('error', () => upstream.terminate())
          downstream.once('close', () => upstream.terminate())
          upstream.once('close', () => downstream.close())
        })
      })
      socket.once('close', () => upstream.terminate())
      return
    }
    if (request.url !== '/sele/ws') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      return
    }
    sockets.handleUpgrade(request, socket, head, (ws) =>
      sockets.emit('connection', ws, request.socket.remoteAddress ?? 'unknown')
    )
  })

  sockets.on('connection', (ws, address: string) => {
    let authenticated = false
    let pairing = false
    const pairingLifetime = new AbortController()
    let alive = true
    let inFlight = 0
    let writing = false
    let queuedOutputBytes = 0
    const output: Array<{ data: string; bytes: number }> = []
    const requests: Array<{ id: number; channel: string; args: unknown[] }> = []
    const lifetime = new EventEmitter()

    const drainRequests = (): void => {
      // Stop starting work while the socket is backpressured. A few concurrent
      // reads keep discovery responsive without materializing every history page
      // at once while a phone is still receiving the preceding large reply.
      while (
        ws.readyState === WebSocket.OPEN &&
        inFlight < 4 &&
        queuedOutputBytes < 8 * 1024 * 1024 &&
        requests.length
      ) {
        const request = requests.shift()!
        inFlight++
        void Promise.resolve()
          .then(() => {
            if (client.isDestroyed()) throw new Error('Client disconnected.')
            return options.invoke(client, request.channel, request.args)
          })
          .then(
            (result) => send({ type: 'result', id: request.id, result }),
            (error) => {
              console.warn('Local-access request failed.', request.channel, error)
              send({
                type: 'result',
                id: request.id,
                error: error instanceof Error ? error.message : String(error)
              })
            }
          )
          .finally(() => {
            inFlight--
            drainRequests()
          })
          .catch((error) => {
            console.error('Unable to deliver a local-access reply.', error)
            ws.terminate()
          })
      }
    }

    const flushOutput = (): void => {
      if (writing || ws.readyState !== WebSocket.OPEN) return
      const packet = output.shift()
      if (!packet) return
      writing = true
      ws.send(packet.data, (error) => {
        writing = false
        queuedOutputBytes = Math.max(0, queuedOutputBytes - packet.bytes)
        if (ws.readyState !== WebSocket.OPEN) return
        if (error) {
          console.warn('Unable to write to a local-access client.', error)
          ws.terminate()
          return
        }
        flushOutput()
        drainRequests()
      })
    }

    const send = (message: unknown): void => {
      if (ws.readyState !== WebSocket.OPEN) return
      // History replies can individually exceed the old 8 MiB cutoff. Let the
      // socket drain each packet instead of closing a healthy Wi-Fi connection.
      const data = encodeClientMessage(message)
      const bytes = Buffer.byteLength(data)
      queuedOutputBytes += bytes
      output.push({ data, bytes })
      flushOutput()
    }
    const client: RendererClient = {
      id: nextClientId--,
      isDestroyed: () => ws.readyState !== WebSocket.OPEN,
      send: (channel, ...args) => send({ type: 'event', channel, args }),
      on: (event, listener) => lifetime.on(event, listener),
      once: (event, listener) => lifetime.once(event, listener)
    }
    const authenticationTimer = setTimeout(() => ws.close(1008, 'Authentication required'), 5000)
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate()
        return
      }
      alive = false
      ws.ping()
    }, 30_000)
    ws.on('pong', () => {
      alive = true
    })
    ws.on('error', () => ws.terminate())
    ws.once('close', () => {
      pairingLifetime.abort()
      authorizations.delete(ws)
      clearTimeout(authenticationTimer)
      clearInterval(heartbeat)
      requests.length = 0
      output.length = 0
      queuedOutputBytes = 0
      lifetime.emit('destroyed')
      lifetime.removeAllListeners()
    })
    ws.on('message', (data, binary) => {
      try {
        if (binary) throw new Error('Expected a JSON message.')
        if (!authenticated) {
          if (Buffer.byteLength(data.toString()) > 4096)
            throw new Error('Invalid authentication message.')
          const hello = JSON.parse(data.toString())
          if (pairing) throw new Error('Pairing is already in progress.')
          if (
            hello.type === 'pair' &&
            hello.version === localAccessProtocolVersion &&
            options.pair
          ) {
            const now = Date.now()
            for (const [key, attempt] of pairingAttempts)
              if (attempt.reset <= now) pairingAttempts.delete(key)
            const attempt = pairingAttempts.get(address) ?? { count: 0, reset: now + 60_000 }
            if (++attempt.count > 5 || pairingAttempts.size > 256)
              throw new Error('Too many pairing attempts.')
            pairingAttempts.set(address, attempt)
            pairing = true
            clearTimeout(authenticationTimer)
            void options
              .pair(hello, pairingLifetime.signal)
              .then((approved) => {
                send({
                  type: 'pairing',
                  approved,
                  computer: approved ? options.identity : undefined
                })
                ws.close(1000, approved ? 'Pairing approved' : 'Pairing declined or expired')
              })
              .catch((error) => {
                console.warn(
                  'Local-access pairing failed.',
                  error instanceof Error ? error.message : 'Invalid request'
                )
                ws.close(1008, 'Unable to pair. Try again on your computer.')
              })
            return
          }
          if (
            hello.type !== 'hello' ||
            hello.version !== localAccessProtocolVersion ||
            !authorized(hello.token)
          ) {
            ws.close(1008, 'Invalid connection link or protocol version')
            return
          }
          authenticated = true
          authorizations.set(ws, hello.token)
          clearTimeout(authenticationTimer)
          send({ type: 'ready', version: localAccessProtocolVersion })
          return
        }
        const message = decodeClientMessage(data.toString())
        if (
          !message ||
          typeof message.channel !== 'string' ||
          message.channel.length > 150 ||
          !Array.isArray(message.args) ||
          message.args.length > 20
        )
          throw new Error('Invalid client message.')
        const { channel, args } = message
        if (message.type === 'send') {
          options.receive(client, channel, args)
        } else if (
          message.type === 'invoke' &&
          typeof message.id === 'number' &&
          Number.isSafeInteger(message.id) &&
          message.id > 0
        ) {
          if (inFlight + requests.length >= 128) {
            send({
              type: 'result',
              id: message.id,
              error: 'Too many pending requests. Wait for the current requests to finish.'
            })
            return
          }
          // Never replay requests: a mutation may have reached the provider even
          // if its response never reaches the phone.
          requests.push({ id: message.id, channel, args })
          drainRequests()
        } else throw new Error('Invalid client message type.')
      } catch {
        console.warn('Rejected an invalid local-access message.')
        ws.close(1008, 'Invalid or unsupported client message')
      }
    })
  })

  await new Promise<void>((resolveListening, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host ?? '0.0.0.0', () => {
      server.removeListener('error', reject)
      resolveListening()
    })
  })
  server.on('error', (error) => console.error('Local-access server error.', error))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Missing local-access server address.')
  port = address.port
  return {
    port,
    disconnectUnauthorized: (): void => {
      for (const [socket, token] of authorizations) {
        if (!authorized(token)) socket.close(1008, 'Device access was revoked')
      }
    },
    stop: async (): Promise<void> => {
      stopping = true
      sockets.clients.forEach((ws) => ws.terminate())
      hotSockets.clients.forEach((ws) => ws.terminate())
      await new Promise<void>((resolveStopped) => {
        server.close(() => resolveStopped())
        server.closeAllConnections()
      })
      sockets.close()
      hotSockets.close()
    }
  }
}
