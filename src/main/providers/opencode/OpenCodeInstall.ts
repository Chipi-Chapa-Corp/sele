import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'
import type { AppContainerTarget } from '../../../shared/app'
import { getHostCommand } from '../../hostProcess'
import {
  clearOpenCodeInstallationCache,
  getOpenCodeInstallations,
  managedOpenCodeV2Directory,
  managedOpenCodeV2Executable,
  probeOpenCodeInstallation
} from './OpenCodeInstallations'
import { ensureOpenCodeV2Profile } from './OpenCodeV2Profile'
import type { ProviderUpdateAvailability } from '../../../shared/provider'
import { OpenCodeServerClient } from './OpenCodeServerClient'

const migrations = new Map<string, Promise<ProviderUpdateAvailability>>()
export const installOpenCode = (
  container?: AppContainerTarget | null,
  force = false
): Promise<ProviderUpdateAvailability> => {
  const key = JSON.stringify([container ?? null, force])
  const pending = migrations.get(key)
  if (pending) return pending
  const migrate = (async (): Promise<ProviderUpdateAvailability> => {
    const installations = await getOpenCodeInstallations(container)
    const currentVersion = installations[0]?.version ?? '2'
    let v2 = installations.find((item) => item.major === 2)
    if (!v2 || force) {
      const platform = container?.kind === 'container' ? 'linux' : process.platform
      if (
        !['linux', 'darwin', 'win32'].includes(platform) ||
        !['x64', 'arm64'].includes(process.arch)
      )
        throw new Error('Automatic OpenCode v2 installation is unavailable on this platform.')
      const archive = `opencode-${platform === 'win32' ? 'windows' : platform}-${process.arch}${platform === 'linux' ? '.tar.gz' : '.zip'}`
      const directory = managedOpenCodeV2Directory()
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const staging = await mkdtemp(join(directory, '.install-'))
      try {
        const response = await fetch(
          `https://opencode.ai/update/api/latest/cli/opencode/${archive}`,
          { signal: AbortSignal.timeout(10 * 60_000) }
        )
        if (!response.ok || !response.body) throw new Error('Unable to download OpenCode v2.')
        const archivePath = join(staging, archive)
        await pipeline(
          Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
          createWriteStream(archivePath, { mode: 0o600 })
        )
        const file =
          platform === 'win32' ? 'powershell.exe' : platform === 'darwin' ? 'ditto' : 'tar'
        const args =
          platform === 'win32'
            ? [
                '-NoProfile',
                '-NonInteractive',
                '-EncodedCommand',
                Buffer.from(
                  `Expand-Archive -LiteralPath '${archivePath.replaceAll("'", "''")}' -DestinationPath '${staging.replaceAll("'", "''")}' -Force`,
                  'utf16le'
                ).toString('base64')
              ]
            : platform === 'darwin'
              ? ['-x', '-k', archivePath, staging]
              : ['-xzf', archivePath, '-C', staging]
        const command = await getHostCommand(file, args, { container })
        await new Promise<void>((resolve, reject) => {
          const child = execFile(
            command.file,
            command.args,
            { env: command.env, cwd: command.cwd, timeout: 60_000 },
            (error) => (error ? reject(new Error('Unable to extract OpenCode v2.')) : resolve())
          )
          child.stdin?.end()
        })
        const candidate = join(staging, platform === 'win32' ? 'opencode.exe' : 'opencode')
        await chmod(candidate, 0o700)
        const verified = await probeOpenCodeInstallation(candidate, container)
        if (!verified || verified.major !== 2)
          throw new Error('The downloaded OpenCode executable did not report a valid v2 version.')
        await rename(candidate, managedOpenCodeV2Executable())
        v2 = { ...verified, executable: managedOpenCodeV2Executable() }
      } finally {
        await rm(staging, { recursive: true, force: true })
      }
    }
    await ensureOpenCodeV2Profile(container)
    clearOpenCodeInstallationCache()
    const server = new OpenCodeServerClient(container ?? null)
    try {
      await server.getClient()
    } finally {
      await server.dispose()
    }
    return { currentVersion, latestVersion: v2.version }
  })().finally(() => migrations.delete(key))
  migrations.set(key, migrate)
  return migrate
}
