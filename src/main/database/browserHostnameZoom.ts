import { normalizeBrowserScalePercent } from '../../shared/browser'
import { getDatabase } from './sqlite'

export const getBrowserHostnameZoomScale = async (hostname: string): Promise<number | null> => {
  const db = await getDatabase()
  const row = await db
    .selectFrom('browser_hostname_zoom')
    .select('scale')
    .where('hostname', '=', hostname)
    .executeTakeFirst()

  return row && Number.isFinite(row.scale) ? normalizeBrowserScalePercent(row.scale) : null
}

export const setBrowserHostnameZoomScale = async (
  hostname: string,
  scale: number
): Promise<number> => {
  const db = await getDatabase()
  const normalizedScale = normalizeBrowserScalePercent(scale)
  const updatedAt = Date.now()

  await db
    .insertInto('browser_hostname_zoom')
    .values({
      hostname,
      scale: normalizedScale,
      updated_at: updatedAt
    })
    .onConflict((conflict) =>
      conflict.column('hostname').doUpdateSet({
        scale: normalizedScale,
        updated_at: updatedAt
      })
    )
    .execute()

  return normalizedScale
}

export const deleteBrowserHostnameZoomScale = async (hostname: string): Promise<void> => {
  const db = await getDatabase()
  await db.deleteFrom('browser_hostname_zoom').where('hostname', '=', hostname).execute()
}
