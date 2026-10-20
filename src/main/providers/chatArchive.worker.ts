import { parentPort } from 'node:worker_threads'
import { readFile, stat } from 'node:fs/promises'
import { archivePreview, decodeChatArchive, restoreArchiveAssets } from './ChatArchive'
import type { SeleChatArchive } from '../../shared/chatArchive'

const port = parentPort!
let archive: SeleChatArchive | undefined
let nextFile = 0
const files = new Map<number, { resolve: () => void; reject: (error: Error) => void }>()
const file = (path: string, data?: Buffer): Promise<void> =>
  new Promise((resolve, reject) => {
    const id = ++nextFile
    files.set(id, { resolve, reject })
    port.postMessage({ type: 'file', id, path, data })
  })

port.on('message', async (message) => {
  if (message.type === 'fileResult') {
    const pending = files.get(message.id)
    files.delete(message.id)
    if (message.error) pending?.reject(new Error(message.error))
    else pending?.resolve()
    return
  }
  try {
    let value: unknown
    if (message.type === 'read') {
      if ((await stat(message.path)).size > 512 * 1024 * 1024)
        throw new Error('Chat archive exceeds the 512 MB limit.')
      archive = await decodeChatArchive(await readFile(message.path))
      value = archivePreview(message.importId, archive)
    } else if (message.type === 'restore') {
      if (!archive) throw new Error('Chat archive is unavailable.')
      // Preserve the original paths for retries into a different environment or provider.
      const restored = structuredClone(archive)
      await restoreArchiveAssets(restored, message.directory, {
        mkdir: (path) => file(path),
        write: (path, data) => file(path, data)
      })
      value = restored
    } else if (message.type === 'parse') value = JSON.parse(message.json)
    else if (message.type === 'stringify') value = JSON.stringify(message.value)
    else throw new Error('Unknown chat archive task.')
    port.postMessage({ id: message.id, value })
  } catch (error) {
    port.postMessage({
      id: message.id,
      error: error instanceof Error ? error.message : String(error)
    })
  }
})
