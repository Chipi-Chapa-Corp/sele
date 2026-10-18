import type Database from 'better-sqlite3'
import type { PreferenceValues } from '../../shared/preferences'

export const openPreferences = (db: Database.Database) => {
  db.exec('CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const get = db.prepare('SELECT value FROM preferences WHERE key = ?')
  const put = db.prepare(
    'INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  const remove = db.prepare('DELETE FROM preferences WHERE key = ?')
  const read = (key: string): string | null =>
    (get.get(key) as { value: string } | undefined)?.value ?? null
  const validateKey = (key: string): void => {
    if (typeof key !== 'string' || !key.startsWith('sele:'))
      throw new Error('Invalid preference key.')
  }
  // The empty key marks a completed migration, including a legitimately empty store.
  // It commits in the same transaction as the imported preferences.
  const load = (): PreferenceValues | null =>
    read('') === null
      ? null
      : Object.fromEntries(
          (
            db.prepare("SELECT key, value FROM preferences WHERE key <> ''").all() as {
              key: string
              value: string
            }[]
          ).map(({ key, value }) => [key, value])
        )
  const set = (key: string, value: string | null): void => {
    validateKey(key)
    if (read('') === null) throw new Error('Preferences have not been migrated.')
    if (value === null) remove.run(key)
    else {
      if (typeof value !== 'string') throw new Error('Invalid preference value.')
      put.run(key, value)
    }
  }
  return {
    load,
    migrate: db.transaction((values: PreferenceValues): PreferenceValues => {
      const existing = load()
      if (existing !== null) return existing
      if (!values || typeof values !== 'object' || Array.isArray(values))
        throw new Error('Invalid preferences.')
      for (const [key, value] of Object.entries(values)) {
        validateKey(key)
        if (typeof value !== 'string') throw new Error('Invalid preference value.')
        put.run(key, value)
      }
      put.run('', '1')
      return values
    }),
    get: (key: string): string | null => {
      validateKey(key)
      return read(key)
    },
    set,
    setMany: db.transaction((values: Record<string, string | null>): void => {
      if (!values || typeof values !== 'object' || Array.isArray(values))
        throw new Error('Invalid preferences.')
      for (const [key, value] of Object.entries(values)) set(key, value)
    })
  }
}
