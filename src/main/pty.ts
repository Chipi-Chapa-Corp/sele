import { spawn, type IPty } from '@lydell/node-pty'

const running = new Map<IPty, Promise<void>>()
let stopping = false

export const isPtyShutdown = (): boolean => stopping

export const spawnPty: typeof spawn = (...args) => {
  if (stopping) throw new Error('Sele is shutting down.')
  const pty = spawn(...args)
  const exited = new Promise<void>((resolve) => {
    const listener = pty.onExit(() => {
      running.delete(pty)
      listener.dispose()
      resolve()
    })
  })
  running.set(pty, exited)
  return pty
}

export const stopPtys = async (): Promise<void> => {
  stopping = true
  const pending = [...running.values()]
  const kill = (signal?: string): void => {
    for (const pty of running.keys()) {
      try {
        pty.kill(signal)
      } catch (error) {
        console.error('Unable to stop terminal process.', error)
      }
    }
  }
  kill()
  const force = setTimeout(() => kill('SIGKILL'), 500)
  try {
    // Native exit callbacks must finish before Electron tears down Node.
    await Promise.all(pending)
    await new Promise<void>((resolve) => setImmediate(resolve))
  } finally {
    clearTimeout(force)
  }
}
