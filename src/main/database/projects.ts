import { isAbsolute } from 'node:path'
import { getDatabase } from './sqlite'
import { isAppProjectIconKind, type AppProjectIconKind } from '../../shared/app'

export type ProjectRecord = {
  cwd: string
  name: string
  icon: AppProjectIconKind | null
  additionalCwds: string[]
  sidebarOrder: number | null
  addedAt: number
  updatedAt: number
}

export type AddProjectRecordOptions = {
  cwd: string
  name?: string
  icon?: AppProjectIconKind | null
  additionalCwds?: string[]
}

const mapProjectRow = (row: {
  cwd: string
  name: string
  icon: string | null
  additional_cwds_json: string
  sidebar_order: number | null
  added_at: number
  updated_at: number
}): ProjectRecord => {
  let additionalCwds: string[] = []
  try {
    const value: unknown = JSON.parse(row.additional_cwds_json)
    if (Array.isArray(value)) {
      additionalCwds = Array.from(
        new Set(
          value.filter(
            (cwd): cwd is string => typeof cwd === 'string' && isAbsolute(cwd) && cwd !== row.cwd
          )
        )
      )
    }
  } catch {
    // Treat malformed legacy data as an empty folder list.
  }

  return {
    cwd: row.cwd,
    name: row.name,
    icon: isAppProjectIconKind(row.icon) ? row.icon : null,
    additionalCwds,
    sidebarOrder:
      typeof row.sidebar_order === 'number' && Number.isFinite(row.sidebar_order)
        ? row.sidebar_order
        : null,
    addedAt: row.added_at,
    updatedAt: row.updated_at
  }
}

const normalizeProjectCwd = (cwd: string): string => {
  const normalizedCwd = cwd.trim()
  if (!normalizedCwd) throw new Error('Invalid project cwd')
  return normalizedCwd
}

export const getProjects = async (): Promise<ProjectRecord[]> => {
  const db = await getDatabase()
  const rows = await db
    .selectFrom('projects')
    .select([
      'cwd',
      'name',
      'icon',
      'additional_cwds_json',
      'sidebar_order',
      'added_at',
      'updated_at'
    ])
    .orderBy('updated_at', 'desc')
    .orderBy('cwd', 'asc')
    .execute()

  return rows.map(mapProjectRow)
}

export const addProject = async (options: AddProjectRecordOptions): Promise<ProjectRecord> => {
  const db = await getDatabase()
  const normalizedCwd = normalizeProjectCwd(options.cwd)
  const updatedAt = Date.now()
  const name = options.name?.trim() ?? ''
  const icon = options.icon ?? null
  const additionalCwds = options.additionalCwds ?? []
  const update = {
    updated_at: updatedAt,
    ...(options.name !== undefined ? { name } : {}),
    ...(options.icon !== undefined ? { icon } : {}),
    ...(options.additionalCwds !== undefined
      ? { additional_cwds_json: JSON.stringify(additionalCwds) }
      : {})
  }

  await db
    .insertInto('projects')
    .values({
      cwd: normalizedCwd,
      name,
      icon,
      additional_cwds_json: JSON.stringify(additionalCwds),
      sidebar_order: null,
      added_at: updatedAt,
      updated_at: updatedAt
    })
    .onConflict((conflict) => conflict.column('cwd').doUpdateSet(update))
    .execute()

  const row = await db
    .selectFrom('projects')
    .select([
      'cwd',
      'name',
      'icon',
      'additional_cwds_json',
      'sidebar_order',
      'added_at',
      'updated_at'
    ])
    .where('cwd', '=', normalizedCwd)
    .executeTakeFirst()

  if (!row) throw new Error('Unable to save project')
  return mapProjectRow(row)
}

export const setProjectOrder = async (projectCwds: string[]): Promise<ProjectRecord[]> => {
  const cwds = Array.from(new Set(projectCwds.map(normalizeProjectCwd)))
  if (cwds.length === 0) return []

  const db = await getDatabase()
  const addedAt = Date.now()
  await db.transaction().execute(async (transaction) => {
    for (const [sidebarOrder, cwd] of cwds.entries()) {
      await transaction
        .insertInto('projects')
        .values({
          cwd,
          name: '',
          icon: null,
          additional_cwds_json: '[]',
          sidebar_order: sidebarOrder,
          added_at: addedAt,
          updated_at: addedAt
        })
        .onConflict((conflict) =>
          conflict.column('cwd').doUpdateSet({ sidebar_order: sidebarOrder })
        )
        .execute()
    }
  })

  const projectsByCwd = new Map((await getProjects()).map((project) => [project.cwd, project]))
  return cwds.flatMap((cwd) => {
    const project = projectsByCwd.get(cwd)
    return project ? [project] : []
  })
}
