import { randomUUID } from 'node:crypto'
import type {
  AppCreateSshEnvironmentOptions,
  AppSshEnvironment,
  AppUpdateSshEnvironmentOptions
} from '../../shared/app'
import { getDatabase } from './sqlite'

type SshEnvironmentRow = {
  id: string
  name: string
  host: string
  port: number
  user: string | null
  identity_file: string | null
  created_at: number
  updated_at: number
}

const mapSshEnvironmentRow = (row: SshEnvironmentRow): AppSshEnvironment => ({
  id: row.id,
  name: row.name,
  host: row.host,
  port: row.port,
  user: row.user,
  identityFile: row.identity_file,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

export const getSshEnvironments = async (): Promise<AppSshEnvironment[]> => {
  const db = await getDatabase()
  const rows = await db
    .selectFrom('ssh_environments')
    .selectAll()
    .orderBy('updated_at', 'desc')
    .orderBy('name', 'asc')
    .execute()

  return rows.map(mapSshEnvironmentRow)
}

export const getSshEnvironment = async (id: string): Promise<AppSshEnvironment | null> => {
  const db = await getDatabase()
  const row = await db
    .selectFrom('ssh_environments')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()

  return row ? mapSshEnvironmentRow(row) : null
}

export const createSshEnvironment = async (
  options: AppCreateSshEnvironmentOptions
): Promise<AppSshEnvironment> => {
  const db = await getDatabase()
  const id = randomUUID()
  const now = Date.now()

  await db
    .insertInto('ssh_environments')
    .values({
      id,
      name: options.name,
      host: options.host,
      port: options.port,
      user: options.user ?? null,
      identity_file: options.identityFile ?? null,
      created_at: now,
      updated_at: now
    })
    .execute()

  const environment = await getSshEnvironment(id)
  if (!environment) throw new Error('Unable to save SSH environment')
  return environment
}

export const updateSshEnvironment = async (
  options: AppUpdateSshEnvironmentOptions
): Promise<AppSshEnvironment> => {
  const db = await getDatabase()

  await db
    .updateTable('ssh_environments')
    .set({
      name: options.name,
      host: options.host,
      port: options.port,
      user: options.user ?? null,
      identity_file: options.identityFile ?? null,
      updated_at: Date.now()
    })
    .where('id', '=', options.id)
    .execute()

  const environment = await getSshEnvironment(options.id)
  if (!environment) throw new Error('SSH environment not found')
  return environment
}

export const deleteSshEnvironment = async (id: string): Promise<void> => {
  const db = await getDatabase()
  await db.deleteFrom('ssh_environments').where('id', '=', id).execute()
}
