import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isExpectedFileAbsenceError } from '../shared/expectedAbsence.ts'

export async function cleanInstalledWindowsUpdate(
  localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
): Promise<void> {
  // Electron Builder derives this directory from the package name.
  const cache = join(localAppData, 'sele-updater')
  const pending = join(cache, 'pending')
  try {
    if (!(await lstat(cache)).isDirectory() || !(await lstat(pending)).isDirectory()) return
    const { fileName, sha512 } = JSON.parse(
      await readFile(join(pending, 'update-info.json'), 'utf8')
    )
    if (typeof fileName !== 'string' || !/^[\w.-]+\.exe$/i.test(fileName)) return
    if (typeof sha512 !== 'string' || !/^[\w+/]{86}==$/.test(sha512)) return

    const installed = join(cache, 'installer.exe')
    const downloaded = join(pending, fileName)
    const installedStat = await lstat(installed)
    const downloadedStat = await lstat(downloaded)
    if (!installedStat.isFile() || !downloadedStat.isFile()) return
    if (installedStat.size !== downloadedStat.size) return

    // NSIS saves the installer it just applied. Match the recorded download checksum
    // before removing it, so a newer installer remains available after an interrupted update.
    const hash = createHash('sha512')
    for await (const chunk of createReadStream(installed)) hash.update(chunk)
    if (hash.digest('base64') !== sha512) return

    // The relaunch can happen before NSIS releases its executable. Remove it first
    // so a locked file leaves update-info.json available for cleanup on the next start.
    await rm(downloaded, { force: true, recursive: true, maxRetries: 8, retryDelay: 200 })
    await rm(pending, { force: true, recursive: true })
  } catch (error) {
    if (!isExpectedFileAbsenceError(error)) throw error
  }
}
