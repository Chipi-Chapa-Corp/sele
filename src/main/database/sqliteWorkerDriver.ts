import {
  CompiledQuery,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type Kysely,
  type QueryResult,
  type TransactionSettings
} from 'kysely'
import { SqliteWorkerClient } from './SqliteWorkerClient'

const queryListeners = new Set<(sql: string) => void>()
export const observeDatabaseQueries = (listener: (sql: string) => void): (() => void) => {
  queryListeners.add(listener)
  return () => {
    queryListeners.delete(listener)
  }
}

// Preserve the native driver's Buffer values across structured cloning.
const restoreBuffers = <Row>(result: QueryResult<Row>): QueryResult<Row> => {
  for (const row of result.rows) {
    if (!row || typeof row !== 'object') continue
    for (const [key, value] of Object.entries(row))
      if (value instanceof Uint8Array)
        (row as Record<string, unknown>)[key] = Buffer.from(
          value.buffer,
          value.byteOffset,
          value.byteLength
        )
  }
  return result
}

class WorkerConnection implements DatabaseConnection {
  constructor(private worker: SqliteWorkerClient) {}
  async executeQuery<Row>(query: CompiledQuery): Promise<QueryResult<Row>> {
    for (const listener of queryListeners) listener(query.sql)
    return restoreBuffers(
      await this.worker.request<QueryResult<Row>>({
        kind: 'query',
        sql: query.sql,
        parameters: query.parameters
      })
    )
  }
  async *streamQuery<Row>(
    query: CompiledQuery,
    size: number
  ): AsyncIterableIterator<QueryResult<Row>> {
    if (query.query.kind !== 'SelectQueryNode')
      throw new Error('Sqlite driver only supports streaming of select queries')
    for (const listener of queryListeners) listener(query.sql)
    const cursor = await this.worker.request<number>({
      kind: 'cursor',
      sql: query.sql,
      parameters: query.parameters
    })
    try {
      while (true) {
        const page = await this.worker.request<QueryResult<Row> & { done: boolean }>({
          kind: 'next',
          cursor,
          size
        })
        if (page.rows.length) yield restoreBuffers(page)
        if (page.done) break
      }
    } finally {
      await this.worker.request({ kind: 'return', cursor })
    }
  }
}

class WorkerDriver implements Driver {
  private worker: SqliteWorkerClient | null = null
  private connection: WorkerConnection | null = null
  constructor(private path: string) {}
  async init(): Promise<void> {
    const worker = new SqliteWorkerClient({ path: this.path })
    try {
      await worker.request({ kind: 'ready' })
      this.worker = worker
      this.connection = new WorkerConnection(worker)
    } catch (error) {
      await worker.close()
      throw error
    }
  }
  async acquireConnection(): Promise<DatabaseConnection> {
    if (!this.connection) throw new Error('SQLite driver is not initialized.')
    return this.connection
  }
  async releaseConnection(): Promise<void> {}
  async beginTransaction(
    connection: DatabaseConnection,
    _settings: TransactionSettings
  ): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('begin'))
  }
  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('commit'))
  }
  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('rollback'))
  }
  async savepoint(connection: DatabaseConnection, name: string): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw(`savepoint "${name.replaceAll('"', '""')}"`))
  }
  async rollbackToSavepoint(connection: DatabaseConnection, name: string): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw(`rollback to "${name.replaceAll('"', '""')}"`))
  }
  async releaseSavepoint(connection: DatabaseConnection, name: string): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw(`release "${name.replaceAll('"', '""')}"`))
  }
  async destroy(): Promise<void> {
    const worker = this.worker
    this.worker = null
    this.connection = null
    await worker?.close()
  }
}

/** Kysely retains its SQLite compiler, semantics and single-connection transaction mutex. */
export class WorkerSqliteDialect implements Dialect {
  constructor(private path: string) {}
  createDriver(): Driver {
    return new WorkerDriver(this.path)
  }
  createAdapter(): SqliteAdapter {
    return new SqliteAdapter()
  }
  createQueryCompiler(): SqliteQueryCompiler {
    return new SqliteQueryCompiler()
  }
  createIntrospector(database: Kysely<unknown>): SqliteIntrospector {
    return new SqliteIntrospector(database)
  }
}
