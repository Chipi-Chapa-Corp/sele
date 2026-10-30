import { parentPort, workerData } from 'node:worker_threads'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { openPreferences } from './preferences'
import type { PreferenceResult, PreferenceValues } from '../../shared/preferences'
import type {
  SqliteOperation,
  SqliteWorkerOptions,
  SqliteWorkerRequest,
  SqliteWorkerError
} from './sqliteProtocol'

const serializeError = (value: unknown): SqliteWorkerError => {
  const error = value as (Partial<Error> & { code?: string }) | null
  return {
    name: typeof error?.name === 'string' ? error.name : 'Error',
    message: typeof error?.message === 'string' ? error.message : String(value),
    stack: typeof error?.stack === 'string' ? error.stack : undefined,
    code: typeof error?.code === 'string' ? error.code : undefined
  }
}

const start = (): void => {
  const options = workerData as SqliteWorkerOptions
  mkdirSync(dirname(options.path), { recursive: true })
  const database = new Database(options.path)
  database.pragma('journal_mode = WAL')
  database.pragma('synchronous = FULL')
  const preferences = options.preferences ? openPreferences(database) : null
  const revisions = new Map<number, Map<string, number>>()
  const statements = new Map<string, Database.Statement>()
  const cursors = new Map<number, Iterator<unknown>>()
  let nextCursor = 0

  // Migrate only a fully committed legacy store. The old table stays untouched;
  // either the entire validated copy commits or startup fails without resetting it.
  if (
    preferences &&
    preferences.load() === null &&
    options.legacyPath &&
    existsSync(options.legacyPath)
  ) {
    const legacy = new Database(options.legacyPath, { readonly: true, fileMustExist: true })
    try {
      if (
        legacy
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='preferences'")
          .get()
      ) {
        const rows = legacy.prepare('SELECT key, value FROM preferences').all() as {
          key: string
          value: string
        }[]
        if (rows.some((row) => row.key === '')) {
          const values = Object.fromEntries(
            rows.filter((row) => row.key !== '').map((row) => [row.key, row.value])
          )
          preferences.migrate(values)
        }
      }
    } finally {
      legacy.close()
    }
  }

  const prepare = (sql: string): Database.Statement => {
    let statement = statements.get(sql)
    if (!statement) statement = database.prepare(sql)
    statements.delete(sql)
    statements.set(sql, statement)
    if (statements.size > 128) statements.delete(statements.keys().next().value!)
    return statement
  }

  const execute = (operation: SqliteOperation): unknown => {
    switch (operation.kind) {
      case 'ready':
        return null
      case 'query': {
        const statement = prepare(operation.sql)
        if (statement.reader) return { rows: statement.all(operation.parameters) }
        const result = statement.run(operation.parameters)
        return {
          rows: [],
          numAffectedRows: BigInt(result.changes),
          insertId: BigInt(result.lastInsertRowid)
        }
      }
      case 'cursor': {
        const cursor = ++nextCursor
        // A cursor owns its statement until return/exhaustion; it cannot share a
        // cached statement with a query that is still iterating it.
        cursors.set(cursor, database.prepare(operation.sql).iterate(operation.parameters))
        return cursor
      }
      case 'next': {
        const iterator = cursors.get(operation.cursor)
        if (!iterator) throw new Error('Unknown SQLite cursor.')
        if (!Number.isInteger(operation.size) || operation.size < 1)
          throw new Error('SQLite cursor batch size must be a positive integer.')
        const rows: unknown[] = []
        for (let i = 0; i < Math.max(1, Math.min(1000, operation.size)); i++) {
          const next = iterator.next()
          if (next.done) {
            cursors.delete(operation.cursor)
            return { rows, done: true }
          }
          rows.push(next.value)
        }
        return { rows, done: false }
      }
      case 'return': {
        cursors.get(operation.cursor)?.return?.()
        cursors.delete(operation.cursor)
        return null
      }
      case 'preferences': {
        if (!preferences) throw new Error('This connection does not own preferences.')
        const { request } = operation
        let value: PreferenceValues | null = null
        if (request.action === 'load') value = preferences.load()
        else if (request.action === 'migrate') value = preferences.migrate(request.values)
        else if (request.action === 'write') {
          if (
            typeof request.sourceId !== 'string' ||
            request.sourceId.length > 64 ||
            !Number.isSafeInteger(request.revision) ||
            request.revision < 1
          )
            throw new Error('Invalid preference write.')
          let sources = revisions.get(operation.senderId)
          if (!sources) revisions.set(operation.senderId, (sources = new Map()))
          if (request.revision > (sources.get(request.sourceId) ?? 0)) {
            preferences.setMany(request.values)
            sources.set(request.sourceId, request.revision)
          }
        } else throw new Error('Invalid preferences operation.')
        return { ok: true, value } satisfies PreferenceResult
      }
      case 'forget':
        revisions.delete(operation.senderId)
        return null
      case 'close':
        for (const cursor of cursors.values()) cursor.return?.()
        cursors.clear()
        statements.clear()
        database.close()
        return null
    }
  }

  parentPort!.on('message', ({ id, operation, barrier }: SqliteWorkerRequest) => {
    try {
      const result = execute(operation)
      if (barrier) {
        Atomics.store(new Int32Array(barrier, 0, 2), 0, 1)
      } else parentPort!.postMessage({ id, result })
    } catch (value) {
      const error = serializeError(value)
      console.error('SQLite operation failed.', error)
      if (barrier) {
        const message = new TextEncoder().encode(error.message).subarray(0, barrier.byteLength - 8)
        new Uint8Array(barrier, 8).set(message)
        const state = new Int32Array(barrier, 0, 2)
        Atomics.store(state, 1, message.byteLength)
        Atomics.store(state, 0, 2)
      } else parentPort!.postMessage({ id, error })
    } finally {
      if (barrier) Atomics.notify(new Int32Array(barrier, 0, 2), 0)
    }
  })
}

try {
  start()
} catch (value) {
  console.error('Unable to open SQLite storage.', serializeError(value))
  // Native SQLite errors can lose their message in Node's worker error event.
  // Send an explicit protocol error for startup failures before closing the port.
  parentPort!.postMessage({ id: 0, error: serializeError(value), fatal: true })
  parentPort!.close()
}
