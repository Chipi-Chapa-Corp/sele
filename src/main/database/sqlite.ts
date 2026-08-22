import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { Kysely, SqliteDialect, sql, type ColumnType } from 'kysely'
import type { ProviderChatCwdKind, ProviderChatPurpose, ProviderId } from '../../shared/provider'

type SqliteBooleanColumn = ColumnType<number, number | boolean | undefined, number | boolean>
type SqliteNullableNumberColumn = ColumnType<
  number | null,
  number | null | undefined,
  number | null
>
type SqliteNullableChatPurposeColumn = ColumnType<
  ProviderChatPurpose | null,
  ProviderChatPurpose | null | undefined,
  ProviderChatPurpose | null
>

export type LocalDatabase = {
  chat: {
    id: string
    container_name: string | null
    container_runtime_name: string | null
    container_runtime_tool: string | null
    container_tool: string | null
    pinned: SqliteBooleanColumn
    pinned_order: SqliteNullableNumberColumn
    done: SqliteBooleanColumn
    seen_updated_at: SqliteNullableNumberColumn
    purpose: SqliteNullableChatPurposeColumn
  }
  cwd_metadata: {
    cwd: string
    kind: ProviderChatCwdKind
    project_cwd: string | null
    branch_name: string | null
    worktree_base_branch_name: string | null
  }
  cwd_notes: {
    id: string
    provider_id: ProviderId
    cwd_key: string
    notes_json: string
  }
  project_icons: {
    cwd_key: string
    image_path: string
    updated_at: number
  }
  projects: {
    cwd: string
    name: string
    icon: string | null
    additional_cwds_json: string
    sidebar_order: SqliteNullableNumberColumn
    added_at: number
    updated_at: number
  }
  ssh_environments: {
    id: string
    name: string
    host: string
    port: number
    user: string | null
    identity_file: string | null
    created_at: number
    updated_at: number
  }
  message_reviews: {
    id: string
    chat_id: string
    prompt: string
    serialized_content: string
    comments_json: string
    created_at: number
  }
}

let database: Kysely<LocalDatabase> | null = null
let schemaReady = false

const getDatabasePath = (): string =>
  process.env.SELE_DATABASE_PATH ?? join(app.getPath('userData'), 'sele.sqlite')

const ensureColumn = async (
  db: Kysely<LocalDatabase>,
  table: string,
  columnName: string,
  addColumn: () => Promise<void>
): Promise<void> => {
  const columns = await sql<{ name: string }>`pragma table_info(${sql.raw(table)})`.execute(db)
  if (columns.rows.some((column) => column.name === columnName)) return

  await addColumn()
}

const ensureSchema = async (db: Kysely<LocalDatabase>): Promise<void> => {
  if (schemaReady) return

  await db.schema
    .createTable('chat')
    .ifNotExists()
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('container_tool', 'text')
    .addColumn('container_name', 'text')
    .addColumn('container_runtime_tool', 'text')
    .addColumn('container_runtime_name', 'text')
    .addColumn('pinned', 'integer', (column) => column.notNull().defaultTo(0))
    .addColumn('pinned_order', 'integer')
    .addColumn('done', 'integer', (column) => column.notNull().defaultTo(0))
    .addColumn('seen_updated_at', 'integer')
    .addColumn('purpose', 'text')
    .execute()

  await db.schema
    .createTable('cwd_metadata')
    .ifNotExists()
    .addColumn('cwd', 'text', (column) => column.primaryKey())
    .addColumn('kind', 'text', (column) => column.notNull())
    .addColumn('project_cwd', 'text')
    .addColumn('branch_name', 'text')
    .addColumn('worktree_base_branch_name', 'text')
    .execute()

  await db.schema
    .createTable('cwd_notes')
    .ifNotExists()
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('provider_id', 'text', (column) => column.notNull())
    .addColumn('cwd_key', 'text', (column) => column.notNull())
    .addColumn('notes_json', 'text', (column) => column.notNull())
    .execute()

  await db.schema
    .createTable('project_icons')
    .ifNotExists()
    .addColumn('cwd_key', 'text', (column) => column.primaryKey())
    .addColumn('image_path', 'text', (column) => column.notNull())
    .addColumn('updated_at', 'integer', (column) => column.notNull())
    .execute()

  await db.schema
    .createTable('projects')
    .ifNotExists()
    .addColumn('cwd', 'text', (column) => column.primaryKey())
    .addColumn('name', 'text', (column) => column.notNull().defaultTo(''))
    .addColumn('icon', 'text')
    .addColumn('additional_cwds_json', 'text', (column) => column.notNull().defaultTo('[]'))
    .addColumn('sidebar_order', 'integer')
    .addColumn('added_at', 'integer', (column) => column.notNull())
    .addColumn('updated_at', 'integer', (column) => column.notNull())
    .execute()

  await db.schema
    .createTable('ssh_environments')
    .ifNotExists()
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('host', 'text', (column) => column.notNull())
    .addColumn('port', 'integer', (column) => column.notNull())
    .addColumn('user', 'text')
    .addColumn('identity_file', 'text')
    .addColumn('created_at', 'integer', (column) => column.notNull())
    .addColumn('updated_at', 'integer', (column) => column.notNull())
    .execute()

  await db.schema
    .createTable('message_reviews')
    .ifNotExists()
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('chat_id', 'text', (column) => column.notNull())
    .addColumn('prompt', 'text', (column) => column.notNull())
    .addColumn('serialized_content', 'text', (column) => column.notNull())
    .addColumn('comments_json', 'text', (column) => column.notNull())
    .addColumn('created_at', 'integer', (column) => column.notNull())
    .execute()

  await db.schema
    .createIndex('message_reviews_chat_id_created_at')
    .ifNotExists()
    .on('message_reviews')
    .columns(['chat_id', 'created_at'])
    .execute()

  await ensureColumn(db, 'cwd_metadata', 'project_cwd', () =>
    db.schema.alterTable('cwd_metadata').addColumn('project_cwd', 'text').execute()
  )
  await ensureColumn(db, 'cwd_metadata', 'branch_name', () =>
    db.schema.alterTable('cwd_metadata').addColumn('branch_name', 'text').execute()
  )
  await ensureColumn(db, 'cwd_metadata', 'worktree_base_branch_name', () =>
    db.schema.alterTable('cwd_metadata').addColumn('worktree_base_branch_name', 'text').execute()
  )
  await ensureColumn(db, 'chat', 'seen_updated_at', () =>
    db.schema.alterTable('chat').addColumn('seen_updated_at', 'integer').execute()
  )
  await ensureColumn(db, 'chat', 'purpose', () =>
    db.schema.alterTable('chat').addColumn('purpose', 'text').execute()
  )
  await ensureColumn(db, 'chat', 'container_tool', () =>
    db.schema.alterTable('chat').addColumn('container_tool', 'text').execute()
  )
  await ensureColumn(db, 'chat', 'container_name', () =>
    db.schema.alterTable('chat').addColumn('container_name', 'text').execute()
  )
  await ensureColumn(db, 'chat', 'container_runtime_tool', () =>
    db.schema.alterTable('chat').addColumn('container_runtime_tool', 'text').execute()
  )
  await ensureColumn(db, 'chat', 'container_runtime_name', () =>
    db.schema.alterTable('chat').addColumn('container_runtime_name', 'text').execute()
  )
  await ensureColumn(db, 'chat', 'pinned_order', () =>
    db.schema.alterTable('chat').addColumn('pinned_order', 'integer').execute()
  )
  await ensureColumn(db, 'projects', 'name', () =>
    db.schema
      .alterTable('projects')
      .addColumn('name', 'text', (column) => column.notNull().defaultTo(''))
      .execute()
  )
  await ensureColumn(db, 'projects', 'icon', () =>
    db.schema.alterTable('projects').addColumn('icon', 'text').execute()
  )
  await ensureColumn(db, 'projects', 'additional_cwds_json', () =>
    db.schema
      .alterTable('projects')
      .addColumn('additional_cwds_json', 'text', (column) => column.notNull().defaultTo('[]'))
      .execute()
  )
  await ensureColumn(db, 'projects', 'sidebar_order', () =>
    db.schema.alterTable('projects').addColumn('sidebar_order', 'integer').execute()
  )

  schemaReady = true
}

export const getDatabase = async (): Promise<Kysely<LocalDatabase>> => {
  if (!database) {
    const path = getDatabasePath()
    mkdirSync(dirname(path), { recursive: true })

    database = new Kysely<LocalDatabase>({
      dialect: new SqliteDialect({
        database: new Database(path)
      })
    })
  }

  await ensureSchema(database)
  return database
}

export const disposeDatabase = async (): Promise<void> => {
  const db = database
  database = null
  schemaReady = false

  if (db) await db.destroy()
}
