import { join } from 'node:path'
import { app } from 'electron'

export const getDatabasePath = (): string =>
  process.env.SELE_DATABASE_PATH ?? join(app.getPath('userData'), 'sele.sqlite')

export const getPreferencesDatabasePath = (): string => `${getDatabasePath()}.preferences.sqlite`
