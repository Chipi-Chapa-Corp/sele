import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { dirname } from 'node:path'
import { formatWithOptions } from 'node:util'

export type LogLevel = 'info' | 'warn' | 'error'

// Keep the current file and one previous file, including across app restarts.
export const createDiagnosticLog = (
  path: string,
  maxBytes = 5 * 1024 * 1024
): {
  path: string
  write: (level: LogLevel, source: string, ...args: unknown[]) => void
  snapshot: () => string
} => {
  const previousPath = `${path}.1`
  const write = (level: LogLevel, source: string, ...args: unknown[]): void => {
    const message = formatWithOptions({ depth: 5, maxArrayLength: 100, getters: false }, ...args)
    const entry = JSON.stringify({ time: new Date().toISOString(), level, source, message }) + '\n'
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    if (existsSync(path) && statSync(path).size + Buffer.byteLength(entry) > maxBytes) {
      rmSync(previousPath, { force: true })
      renameSync(path, previousPath)
    }
    // Bound individual messages too (a provider error can contain a very large payload).
    const boundedEntry =
      Buffer.byteLength(entry) > maxBytes
        ? JSON.stringify({
            time: new Date().toISOString(),
            level,
            source,
            message: message.slice(0, Math.floor(maxBytes / 12)),
            truncated: true
          }) + '\n'
        : entry
    appendFileSync(path, boundedEntry, { mode: 0o600 })
  }
  const snapshot = (): string =>
    [previousPath, path]
      .filter((file) => existsSync(file))
      .map((file) => readFileSync(file, 'utf8'))
      .join('')
  return { path, write, snapshot }
}
