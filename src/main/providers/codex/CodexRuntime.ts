import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { PassThrough } from 'node:stream'
import type { HostCommand } from '../../hostProcess'
import runtimeSource from './codexRuntime.cjs?raw'

export type CodexProcess = EventEmitter & {
  stdin: NodeJS.WritableStream & { writable: boolean }
  stdout: NodeJS.ReadableStream
  stderr: NodeJS.ReadableStream
  exitCode: number | null
  kill: () => boolean | void
  detach?: () => void
}

// The profile, account and execution environment are all part of the worker identity.
export const codexRuntimeKey = (profile: string, identity: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify([profile, identity]))
    .digest('hex')
    .slice(0, 32)

const attach = (port: number, token: string): Promise<CodexProcess> =>
  new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const transport = new EventEmitter() as CodexProcess
    let authenticated = false
    const timeout = setTimeout(
      () => socket.destroy(new Error('Codex runtime connection timed out.')),
      5000
    )
    transport.stdin = socket
    transport.stdout = stdout
    transport.stderr = stderr
    transport.exitCode = null
    transport.kill = () => {
      socket.end(JSON.stringify({ runtimeStop: true }) + '\n')
    }
    transport.detach = () => socket.end()
    socket.on('connect', () => socket.write(JSON.stringify({ token }) + '\n'))
    socket.on('error', (error) => {
      if (!authenticated) reject(error)
      else transport.emit('error', error)
    })
    socket.on('close', () => {
      clearTimeout(timeout)
      transport.exitCode = 0
      stdout.end()
      stderr.end()
      if (!authenticated) reject(new Error('Codex runtime rejected the connection.'))
      else transport.emit('close', 0)
    })
    const reader = createInterface({ input: socket })
    reader.on('error', () => {}) // The socket's error handler owns connection failures.
    reader.on('line', (line) => {
      try {
        const message = JSON.parse(line) as { runtimeReady?: boolean; runtimeStderr?: string }
        if (message.runtimeReady) {
          authenticated = true
          clearTimeout(timeout)
          resolve(transport)
        } else if (typeof message.runtimeStderr === 'string') stderr.write(message.runtimeStderr)
        else stdout.write(line + '\n')
      } catch (error) {
        socket.destroy(error instanceof Error ? error : new Error(String(error)))
      }
    })
  })

const missingListener = (error: unknown): boolean =>
  ['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException)?.code ?? '')

/** Launch once, then reconnect to its original stdio owner after Electron exits. */
export const connectCodexRuntime = async (
  profile: string,
  identity: unknown,
  command: HostCommand
): Promise<CodexProcess> => {
  const key = codexRuntimeKey(profile, identity)
  const directory = join(profile, 'codex-runtime-v1', key)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const tokenPath = join(directory, 'token')
  try {
    await writeFile(tokenPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  let token = await readFile(tokenPath, 'utf8')
  for (let attempt = 0; !/^[a-f0-9]{64}$/.test(token) && attempt < 100; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    token = await readFile(tokenPath, 'utf8')
  }
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid Codex runtime authentication token.')
  // A loopback endpoint also works across Flatpak's per-instance /tmp namespaces.
  // The private profile contains the capability token; only loopback accepts connections.
  const endpointPath = join(directory, 'endpoint.json')
  const reconnect = async (): Promise<CodexProcess> => {
    const endpoint = JSON.parse(await readFile(endpointPath, 'utf8')) as { port: number }
    if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535)
      throw new Error('Invalid Codex runtime endpoint.')
    return attach(endpoint.port, token)
  }
  try {
    return await reconnect()
  } catch (error) {
    if (!missingListener(error)) throw error
  }

  // Serialize launch across app instances. A dead launcher must not leave a
  // permanent lock, and a live runtime must never be replaced by a second worker.
  const lockPath = join(directory, 'launch.lock')
  let lock: Awaited<ReturnType<typeof open>> | undefined
  const deadline = Date.now() + 15_000
  while (!lock) {
    try {
      lock = await open(lockPath, 'wx', 0o600)
      await lock.writeFile(String(process.pid))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const pid = Number(await readFile(lockPath, 'utf8'))
        const age = Date.now() - (await stat(lockPath)).mtimeMs
        if (age > 30_000) await unlink(lockPath)
        else if (pid > 0) {
          try {
            process.kill(pid, 0)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') await unlink(lockPath)
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      try {
        return await reconnect()
      } catch (error) {
        if (!missingListener(error)) throw error
      }
      if (Date.now() >= deadline)
        throw new Error('Timed out waiting for the Codex runtime launcher.')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  try {
    try {
      return await reconnect()
    } catch (error) {
      if (!missingListener(error)) throw error
    }
    const script = join(directory, 'runtime.cjs')
    await writeFile(script, runtimeSource, { mode: 0o600 })
    const log = await open(join(directory, 'runtime.log'), 'a', 0o600)
    let worker: ReturnType<typeof spawn>
    try {
      worker = spawn(process.execPath, [script], {
        detached: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'ignore', log.fd],
        windowsHide: true
      })
    } finally {
      await log.close()
    }
    let launchError: Error | undefined
    worker.on('error', (error) => {
      launchError = error
    })
    worker.stdin!.on('error', (error) => {
      launchError = error
    })
    worker.stdin!.end(JSON.stringify({ endpointPath, token, command }) + '\n')
    worker.unref()
    while (Date.now() < deadline) {
      if (launchError) throw launchError
      if (worker.exitCode !== null)
        throw new Error('Codex runtime exited during startup. See its runtime.log.')
      try {
        return await reconnect()
      } catch (error) {
        if (!missingListener(error)) throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('Codex runtime did not become ready. See its runtime.log.')
  } finally {
    await lock.close()
    await unlink(lockPath)
  }
}
