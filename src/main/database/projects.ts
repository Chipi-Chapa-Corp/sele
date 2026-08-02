import { getDatabase } from './sqlite'

export type ProjectRecord = {
  cwd: string
  addedAt: number
  updatedAt: number
}

const mapProjectRow = (row: {
  cwd: string
  added_at: number
  updated_at: number
}): ProjectRecord => ({
  cwd: row.cwd,
  addedAt: row.added_at,
  updatedAt: row.updated_at
})

const normalizeProjectCwd = (cwd: string): string => {
  const normalizedCwd = cwd.trim()
  if (!normalizedCwd) throw new Error('Invalid project cwd')
  return normalizedCwd
}

export const getProjects = async (): Promise<ProjectRecord[]> => {
  const db = await getDatabase()
  const rows = await db
    .selectFrom('projects')
    .select(['cwd', 'added_at', 'updated_at'])
    .orderBy('updated_at', 'desc')
    .orderBy('cwd', 'asc')
    .execute()

  return rows.map(mapProjectRow)
}

export const addProject = async (cwd: string): Promise<ProjectRecord> => {
  const db = await getDatabase()
  const normalizedCwd = normalizeProjectCwd(cwd)
  const updatedAt = Date.now()

  await db
    .insertInto('projects')
    .values({
      cwd: normalizedCwd,
      added_at: updatedAt,
      updated_at: updatedAt
    })
    .onConflict((conflict) =>
      conflict.column('cwd').doUpdateSet({
        updated_at: updatedAt
      })
    )
    .execute()

  const row = await db
    .selectFrom('projects')
    .select(['cwd', 'added_at', 'updated_at'])
    .where('cwd', '=', normalizedCwd)
    .executeTakeFirst()

  if (!row) throw new Error('Unable to save project')
  return mapProjectRow(row)
}
