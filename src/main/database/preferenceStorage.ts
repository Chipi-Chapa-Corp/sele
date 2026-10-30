import { SqliteWorkerClient } from './SqliteWorkerClient'
import { getDatabasePath, getPreferencesDatabasePath } from './storagePaths'

let initialized: Promise<SqliteWorkerClient> | null = null

export const getPreferenceStorage = (): Promise<SqliteWorkerClient> => {
  initialized ??= Promise.resolve()
    .then(async () => {
      const worker = new SqliteWorkerClient({
        path: getPreferencesDatabasePath(),
        preferences: true,
        legacyPath: getDatabasePath()
      })
      try {
        await worker.request({ kind: 'ready' })
        return worker
      } catch (error) {
        await worker.close()
        throw error
      }
    })
    .catch((error: unknown) => {
      initialized = null
      throw error
    })
  return initialized
}

export const closePreferenceStorage = async (): Promise<void> => {
  const opening = initialized
  if (!opening) return
  try {
    await (await opening).close()
  } finally {
    if (initialized === opening) initialized = null
  }
}
