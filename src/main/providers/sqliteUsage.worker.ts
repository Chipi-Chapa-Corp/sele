import { parentPort } from 'node:worker_threads'
import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import Database from 'better-sqlite3'
import type { SqliteUsageRead } from './SqliteUsageReader'

/** Also exported for real SQLite integration checks, using the same code as the worker. */
export const readSqliteUsage = async (options: SqliteUsageRead): Promise<unknown[] | null> => {
  if (options.command) {
    const command = options.command
    const output = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        command.file,
        command.args,
        {
          cwd: command.cwd,
          env: command.env,
          encoding: 'utf8',
          windowsHide: true,
          timeout: 10_000,
          maxBuffer: 1024 * 1024
        },
        (error, stdout) => (error ? reject(error) : resolve(stdout))
      )
      child.stdin?.end()
    })
    const rows = JSON.parse(output)
    if (rows !== null && !Array.isArray(rows)) throw new Error('Invalid historical usage response.')
    return rows
  }
  if (!options.path || !existsSync(options.path)) return null
  const db = new Database(options.path, { readonly: true, fileMustExist: true, timeout: 1000 })
  try {
    // Names come only from provider-owned constants, never renderer inputs.
    const columns = db.prepare(`pragma table_info(${options.table})`).all() as { name: string }[]
    const names = new Set(columns.map((column) => column.name))
    if (!options.requiredColumns.every((name) => names.has(name))) return null
    const stats = statSync(options.path)
    const rows = db
      .prepare(names.has('token_details_json') ? options.query : options.queryWithoutDetails)
      .all() as Record<string, unknown>[]
    return rows.map((row) => ({ ...row, database_identity: `${stats.dev}:${stats.ino}` }))
  } finally {
    db.close()
  }
}

// Serialize reads to avoid multiple scans of a native database at once.
let queue = Promise.resolve()
parentPort?.on('message', (message: { id: number; options: SqliteUsageRead }) => {
  queue = queue.then(async () => {
    try {
      parentPort!.postMessage({ id: message.id, rows: await readSqliteUsage(message.options) })
    } catch (error) {
      parentPort!.postMessage({
        id: message.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })
})
