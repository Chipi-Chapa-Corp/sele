import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { handleLoggedIpc, logDiagnostic } from './logging'
import {
  checkMacUpdate,
  installMacUpdate,
  readMacUpdateResult,
  type MacUpdate
} from './macAppUpdate'
import { appIpcChannels } from '../shared/app'
import { isNewerStableVersion, type AppUpdateState } from '../shared/appUpdate'
import { isExpectedFileAbsenceError } from '../shared/expectedAbsence.ts'

const exec = promisify(execFile)
const appId = 'com.chipichapa.sele'
const repository = 'https://api.github.com/repos/Chipi-Chapa-Corp/sele/releases/latest'
const intervalMs = 5 * 60 * 1000

export function registerAppUpdate(): void {
  let state: AppUpdateState = { version: null, status: 'idle', progress: null, error: null }
  let checking = false
  let disabled = false
  let ignored: string[] = []
  const skipped = new Set<string>()
  const preferencesPath = join(app.getPath('userData'), 'app-update-preferences.json')
  const flatpak = process.platform === 'linux' && existsSync('/.flatpak-info')
  const executable = app.getPath('exe')
  const installedWindows =
    process.platform === 'win32' && existsSync(join(dirname(executable), 'Uninstall Sele.exe'))
  const installedMac =
    process.platform === 'darwin' &&
    executable.includes('.app/Contents/MacOS/') &&
    !executable.startsWith('/Volumes/') &&
    !executable.includes('/AppTranslocation/')
  const supported = app.isPackaged && (flatpak || installedWindows || installedMac)
  let flatpakTarget: { scope: string; ref: string; commit: string; instance: string } | null = null

  let macTarget: MacUpdate | null = null

  const publish = (patch: Partial<AppUpdateState>): void => {
    state = { ...state, ...patch }
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(appIpcChannels.appUpdateChanged, state)
    }
  }
  const host = async (args: string[], timeout = 30_000): Promise<string> => {
    const result = await exec('flatpak-spawn', ['--host', 'flatpak', ...args], {
      timeout,
      maxBuffer: 2 * 1024 * 1024
    })
    return result.stdout.trim()
  }
  const fail = (error: unknown): void => {
    console.error('Application update failed:', error)
    publish({
      status: 'error',
      progress: null,
      error: error instanceof Error ? error.message : 'Unable to update Sele.'
    })
  }
  const check = async (): Promise<void> => {
    if (!supported || disabled || checking || state.status === 'updating') return
    checking = true
    try {
      let version: string | null = null
      if (installedMac) {
        macTarget = await checkMacUpdate(app.getVersion())
        version = macTarget?.version ?? null
        logDiagnostic('info', 'app-update', {
          platform: 'darwin',
          current: app.getVersion(),
          available: version
        })
      } else if (flatpak) {
        const response = await fetch(repository, {
          signal: AbortSignal.timeout(20_000),
          headers: { Accept: 'application/vnd.github+json' }
        })
        if (!response.ok) throw new Error(`Release check failed (${response.status}).`)
        const release = (await response.json()) as {
          tag_name?: string
          draft?: boolean
          prerelease?: boolean
        }
        if (
          release.draft ||
          release.prerelease ||
          typeof release.tag_name !== 'string' ||
          !isNewerStableVersion(release.tag_name, app.getVersion())
        )
          return
        version = release.tag_name.replace(/^v/, '')
        if (ignored.includes(version) || skipped.has(version)) return
        const info = await readFile('/.flatpak-info', 'utf8')
        const field = (name: string): string =>
          new RegExp(`^${name}=(.+)$`, 'm').exec(info)?.[1]?.trim() ?? ''
        const path = field('app-path')
        const scope = path.startsWith('/var/lib/flatpak/')
          ? '--system'
          : path.includes('/.local/share/flatpak/')
            ? '--user'
            : null
        if (!scope)
          throw new Error('This Flatpak installation must be updated with its package manager.')
        const ref = `app/${appId}/${field('arch')}/${field('branch')}`
        const origin = await host(['info', scope, '--show-origin', ref])
        const commit = await host(['remote-info', scope, '--show-commit', origin, ref])
        if (!/^[a-f0-9]{64}$/.test(commit) || commit === field('app-commit')) return
        const instance = field('instance-id')
        if (!/^\d+$/.test(instance))
          throw new Error('Unable to identify the running Flatpak instance.')
        flatpakTarget = { scope, ref, commit, instance }
      } else {
        const result = await autoUpdater.checkForUpdates()
        if (
          result?.isUpdateAvailable &&
          isNewerStableVersion(result.updateInfo.version, app.getVersion())
        )
          version = result.updateInfo.version
      }
      if (version && !ignored.includes(version) && !skipped.has(version))
        publish({
          version,
          status: state.version === version && state.error ? 'error' : 'available',
          progress: null,
          error: state.version === version ? state.error : null
        })
    } catch (error) {
      console.error('[caught:appUpdate:check]', error)
      // Background network failures do not interrupt chat or remove an existing suggestion.
      console.error('Unable to check for application updates:', error)
    } finally {
      checking = false
    }
  }

  if (installedWindows) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false
    autoUpdater.on('error', (error) => {
      if (state.status === 'updating') fail(error)
      else console.error('Application updater:', error)
    })
    autoUpdater.on('download-progress', ({ percent }) => publish({ progress: Math.round(percent) }))
  }

  handleLoggedIpc(appIpcChannels.getAppUpdate, () => state)
  handleLoggedIpc(appIpcChannels.dismissAppUpdate, async (_, mode: unknown) => {
    if (!['session', 'version', 'forever'].includes(String(mode)))
      throw new Error('Invalid update dismissal')
    if (state.status === 'updating' || !state.version) return
    if (mode === 'forever' || mode === 'version') {
      const nextDisabled = mode === 'forever' || disabled
      const nextIgnored = mode === 'version' ? [...new Set([...ignored, state.version])] : ignored
      await writeFile(
        preferencesPath,
        JSON.stringify({ disabled: nextDisabled, ignored: nextIgnored }),
        'utf8'
      )
      disabled = nextDisabled
      ignored = nextIgnored
    } else skipped.add(state.version)
    publish({ version: null, status: 'idle', error: null })
  })
  handleLoggedIpc(appIpcChannels.installAppUpdate, async () => {
    if (!supported || !state.version || state.status === 'updating' || checking) return
    publish({ status: 'updating', progress: null, error: null })
    try {
      if (installedMac) {
        if (!macTarget || macTarget.version !== state.version)
          throw new Error('Please wait for the next update check.')
        await installMacUpdate({
          update: macTarget,
          executable,
          userData: app.getPath('userData'),
          progress: (progress) => publish({ progress }),
          quit: () => app.quit()
        })
      } else if (flatpak) {
        const target = flatpakTarget
        if (!target) throw new Error('Please wait for the next update check.')
        await host(
          [
            'update',
            target.scope,
            '--assumeyes',
            '--noninteractive',
            `--commit=${target.commit}`,
            target.ref
          ],
          15 * 60 * 1000
        )
        const installed = await host(['info', target.scope, '--show-commit', target.ref])
        if (installed !== target.commit)
          throw new Error('Flatpak did not install the requested update.')
        // The helper lives on the host and waits for this sandbox to exit before launching a fresh one.
        const helper = spawn(
          'flatpak-spawn',
          [
            '--host',
            'sh',
            '-c',
            'nohup sh -c \'while flatpak ps --columns=instance | grep -qx "$1"; do sleep 1; done; exec flatpak run "$2" "$3"\' sh "$1" "$2" "$3" >/dev/null 2>&1 </dev/null &',
            'sh',
            target.instance,
            target.scope,
            target.ref
          ],
          { stdio: 'ignore' }
        )
        await new Promise<void>((resolve, reject) => {
          helper.once('error', reject)
          helper.once('exit', (code) =>
            code === 0 ? resolve() : reject(new Error('Unable to schedule the restart.'))
          )
        })
        app.quit()
      } else {
        await autoUpdater.downloadUpdate()
        autoUpdater.quitAndInstall(false, true)
      }
    } catch (error) {
      fail(error)
    }
  })

  void (async () => {
    try {
      const preferences = JSON.parse(await readFile(preferencesPath, 'utf8'))
      disabled = preferences.disabled === true
      ignored = Array.isArray(preferences.ignored)
        ? preferences.ignored.filter((value: unknown) => typeof value === 'string')
        : []
    } catch (error) {
      if (!isExpectedFileAbsenceError(error)) {
        console.error('[caught:appUpdate:registerAppUpdate]', error)
      }
      /* Missing preferences use the defaults. */
    }
    if (installedMac) {
      try {
        const result = await readMacUpdateResult(app.getPath('userData'))
        if (result?.error)
          publish({ version: result.version, status: 'error', error: result.error })
      } catch (error) {
        fail(error)
      }
    }
    await check()
  })()
  const timer = setInterval(() => void check(), intervalMs)
  timer.unref()
  app.once('before-quit', () => clearInterval(timer))
}
