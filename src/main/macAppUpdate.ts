import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { constants, createWriteStream } from 'node:fs'
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { isNewerStableVersion } from '../shared/appUpdate.ts'
import { isExpectedFileAbsenceError } from '../shared/expectedAbsence.ts'
import {
  findLatestPlatformRelease,
  platformReleaseVersion,
  type PlatformRelease
} from './platformRelease.ts'

const exec = promisify(execFile)
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const stagingPrefix = 'mac-update-'
const stagingName = /^mac-update-[a-zA-Z0-9]{6}$/
// Give interrupted downloads and legacy helpers a grace period before pruning.
const staleStageAgeMs = 24 * 60 * 60 * 1000
export type MacUpdate = { version: string; url: string; sha256: string; size: number }
export function selectMacUpdate(
  release: PlatformRelease,
  current: string,
  arch: string
): MacUpdate | null {
  if (arch !== 'arm64' && arch !== 'x64') throw new Error(`Unsupported Mac architecture: ${arch}`)
  const version = platformReleaseVersion(release, `macos-${arch}`)
  if (!version || !isNewerStableVersion(version, current)) return null
  const name = `Sele-${version}-${arch}-mac.zip`
  const asset = release.assets?.find((asset) => asset.name === name)
  if (!asset) throw new Error(`Release ${version} has no update for ${arch}.`)
  const expectedUrl = `https://github.com/Chipi-Chapa-Corp/sele/releases/download/${release.tag_name}/${name}`
  if (
    asset.browser_download_url !== expectedUrl ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '') ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0
  ) {
    throw new Error('The Mac update has invalid download metadata or no SHA-256 checksum.')
  }
  return { version, url: expectedUrl, sha256: asset.digest!.slice(7), size: asset.size }
}

export async function checkMacUpdate(current: string): Promise<MacUpdate | null> {
  if (process.arch !== 'arm64' && process.arch !== 'x64')
    throw new Error(`Unsupported Mac architecture: ${process.arch}`)
  const selected = await findLatestPlatformRelease(`macos-${process.arch}`, current)
  return selected ? selectMacUpdate(selected.release, current, process.arch) : null
}

export const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

// Passed inline to bash (including through osascript), never executed from a user-writable script
// as root. All paths are quoted values; downloaded contents are never executed with elevation.
export function macInstallScript(
  target: string,
  archive: string,
  sha256: string,
  stage: string,
  pid: number
): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid update checksum')
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Invalid updater parent PID')
  return `set -eu
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
target=${shellQuote(target)}
archive=${shellQuote(archive)}
stage=${shellQuote(stage)}
work=''
moved=0
installed=0
finish() {
  code=$?
  trap - EXIT HUP INT TERM
  if [ "$code" -ne 0 ]; then
    echo "Mac update failed (exit $code)."
    if [ "$moved" -eq 1 ]; then
      if [ "$installed" -eq 1 ]; then
        if ! /bin/mv "$target" "$work/failed.app"; then
          echo "Cannot move failed app. Backup remains at $work/previous.app"
          exit 1
        fi
      fi
      if /bin/mv "$work/previous.app" "$target"; then
        /bin/mkdir "$stage/rolled-back"
      else
        echo "Restore failed. Previous app remains at $work/previous.app"
        exit 1
      fi
    fi
  fi
  if [ -n "$work" ]; then
    if ! /bin/rm -rf "$work"; then echo "Could not clean update backup directory: $work"; fi
  fi
  exit "$code"
}
trap finish EXIT
trap 'exit 1' HUP INT TERM
[ -d "$target" ] && [ ! -L "$target" ]
work=$(/usr/bin/mktemp -d ${shellQuote(join(dirname(target), '.sele-update.XXXXXX'))})
# Reverify a private copy before privileged extraction. Never trust mutable staging files.
/bin/cp "$archive" "$work/update.zip"
actual=$(/usr/bin/shasum -a 256 "$work/update.zip")
[ "\${actual%% *}" = ${shellQuote(sha256)} ]
/usr/bin/ditto --noqtn -x -k "$work/update.zip" "$work/unpacked"
/bin/rm -f "$work/update.zip"
/bin/mv "$work/unpacked/Sele.app" "$work/new.app"
/usr/bin/xattr -dr com.apple.quarantine "$work/new.app"
[ ! -d "$stage/cancel" ]
/bin/mkdir "$stage/ready"
# Only replace after the user authorized this attempt AND the original process exited.
count=0
while /bin/kill -0 ${pid} 2>/dev/null; do
  [ ! -d "$stage/cancel" ]
  count=$((count + 1))
  [ "$count" -lt 120 ]
  /bin/sleep 1
done
[ -d "$stage/commit" ] && [ ! -d "$stage/cancel" ]
/bin/mv "$target" "$work/previous.app"
moved=1
/bin/mv "$work/new.app" "$target"
installed=1
/bin/mkdir "$stage/installed"
count=0
while [ ! -d "$stage/launched" ]; do
  [ ! -d "$stage/launch-failed" ]
  count=$((count + 1))
  [ "$count" -lt 60 ]
  /bin/sleep 1
done
# open succeeded; replacement rollback is no longer needed.
moved=0
`
}

export function macAuthorizationScript(command: string): string {
  return `with timeout of 600 seconds\n  do shell script ${JSON.stringify(command)} with administrator privileges\nend timeout`
}

export function macSupervisorScript(
  worker: string,
  elevated: boolean,
  target: string,
  stage: string
): string {
  const command = `/bin/bash -c ${shellQuote(worker)}`
  const invocation = elevated
    ? `/usr/bin/osascript -e ${shellQuote(macAuthorizationScript(command))}`
    : command
  return `export PATH=/usr/bin:/bin:/usr/sbin:/sbin
stage=${shellQuote(stage)}
echo "$$" > "$stage/supervisor.pid"
${invocation} &
worker=$!
while /bin/kill -0 "$worker" 2>/dev/null; do
  if [ -d "$stage/installed" ] && [ ! -d "$stage/launched" ] && [ ! -d "$stage/launch-failed" ]; then
    if /usr/bin/open -n ${shellQuote(target)}; then
      /bin/mkdir "$stage/launched"
    else
      /bin/mkdir "$stage/launch-failed"
    fi
  fi
  /bin/sleep 1
done
wait "$worker"
result=$?
/bin/rm -f "$stage/update.zip"
if [ "$result" -eq 0 ]; then
  echo success > "$stage/result.tmp"
else
  echo error > "$stage/result.tmp"
  if [ -d "$stage/rolled-back" ] || { [ -d "$stage/commit" ] && [ ! -d "$stage/installed" ]; }; then
    /usr/bin/open -n ${shellQuote(target)}
  fi
fi
/bin/mv "$stage/result.tmp" "$stage/result"
exit "$result"
`
}

async function validateBundle(bundle: string, version: string): Promise<void> {
  const visit = async (path: string): Promise<void> => {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) {
      const destination = await realpath(path)
      if (!destination.startsWith(`${bundle}${sep}`))
        throw new Error('Update bundle contains an external symlink.')
    } else if (stat.isDirectory()) {
      for (const name of await readdir(path)) await visit(join(path, name))
    } else if (!stat.isFile()) throw new Error('Update bundle contains a special file.')
  }
  if (!(await lstat(bundle)).isDirectory()) throw new Error('Update is not an application bundle.')
  await visit(bundle)
  const plist = join(bundle, 'Contents/Info.plist')
  const field = async (name: string): Promise<string> =>
    (await exec('/usr/libexec/PlistBuddy', ['-c', `Print :${name}`, plist])).stdout.trim()
  if (
    (await field('CFBundleIdentifier')) !== 'com.chipichapa.sele' ||
    (await field('CFBundleShortVersionString')) !== version ||
    (await field('CFBundleExecutable')) !== 'Sele'
  ) {
    throw new Error('Downloaded application identity or version does not match the release.')
  }
  // -verify_arch consumes all following arguments as architecture names.
  await exec('/usr/bin/lipo', [
    join(bundle, 'Contents/MacOS/Sele'),
    '-verify_arch',
    process.arch === 'arm64' ? 'arm64' : 'x86_64'
  ])
  // ditto --noqtn avoids adding quarantine. Clear any attribute already present in the archive.
  // xattr -dr succeeds for bundles without the attribute; any real failure aborts staging.
  await exec('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', bundle])
}

export async function installMacUpdate(options: {
  update: MacUpdate
  executable: string
  userData: string
  progress: (percent: number) => void
  quit: () => void
}): Promise<void> {
  const { update, progress } = options
  // Resolve Homebrew symlinks and replace the actual bundle without breaking the app link.
  const executable = await realpath(options.executable)
  const marker = '.app/Contents/MacOS/'
  const index = executable.lastIndexOf(marker)
  if (index < 0 || executable.startsWith('/Volumes/') || executable.includes('/AppTranslocation/'))
    throw new Error('Install Sele on a writable disk before updating.')
  const target = executable.slice(0, index + 4)
  const stage = await mkdtemp(join(options.userData, stagingPrefix))
  const pending = join(options.userData, 'mac-update-pending.json')
  let helperStarted = false
  let pendingWritten = false
  try {
    const archive = join(stage, 'update.zip')
    const response = await fetch(update.url, { signal: AbortSignal.timeout(15 * 60_000) })
    if (!response.ok || !response.body)
      throw new Error(`Update download failed (${response.status}).`)
    const hash = createHash('sha256')
    let received = 0
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length
          if (received > update.size)
            return callback(new Error('Update exceeds its declared size.'))
          hash.update(chunk)
          progress(Math.round((received / update.size) * 100))
          callback(null, chunk)
        }
      }),
      createWriteStream(archive, { flags: 'wx', mode: 0o600 })
    )
    if (received !== update.size || hash.digest('hex') !== update.sha256)
      throw new Error('Update checksum or size does not match the release.')
    const listing = (
      await exec('/usr/bin/unzip', ['-Z1', archive], { maxBuffer: 16 * 1024 * 1024 })
    ).stdout
    for (const path of listing.trim().split('\n')) {
      if (!path.startsWith('Sele.app/') || path.split('/').includes('..') || path.includes('\\'))
        throw new Error('Update archive contains an unexpected path.')
    }
    const extracted = join(stage, 'extracted')
    await mkdir(extracted)
    await exec('/usr/bin/ditto', ['--noqtn', '-x', '-k', archive, extracted], {
      timeout: 5 * 60_000
    })
    const bundle = join(extracted, 'Sele.app')
    await validateBundle(bundle, update.version)
    await rm(extracted, { recursive: true, force: true })
    let elevated = false
    try {
      await access(dirname(target), constants.W_OK)
      await access(target, constants.W_OK)
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'EACCES' &&
        (error as NodeJS.ErrnoException).code !== 'EPERM'
      )
        throw error
      console.warn('Mac update requires administrator authorization:', error)
      elevated = true
    }
    const record = join(stage, 'pending.json')
    await writeFile(record, JSON.stringify({ stage, version: update.version }), { mode: 0o600 })
    await rename(record, pending)
    pendingWritten = true
    const log = await open(join(stage, 'helper.log'), 'wx', 0o600)
    const helper = spawn(
      '/bin/bash',
      [
        '-c',
        macSupervisorScript(
          macInstallScript(target, archive, update.sha256, stage, process.pid),
          elevated,
          target,
          stage
        )
      ],
      {
        detached: true,
        stdio: ['ignore', log.fd, log.fd],
        cwd: '/'
      }
    )
    let spawnError: Error | null = null
    helper.on('error', (error) => {
      spawnError = error
    })
    helperStarted = helper.pid !== undefined
    helper.unref()
    await log.close()
    // Keep the app open through staging and the system's authorization dialog.
    for (let attempt = 0; attempt < 600; attempt++) {
      if (spawnError) throw spawnError
      if (await exists(join(stage, 'result')))
        throw new Error(
          `Unable to prepare the update. Authorization may have been cancelled.\n${await readFile(join(stage, 'helper.log'), 'utf8')}`
        )
      if (await exists(join(stage, 'ready'))) {
        await mkdir(join(stage, 'commit'))
        options.quit()
        return
      }
      await sleep(500)
    }
    throw new Error('Timed out waiting for update authorization.')
  } catch (error) {
    try {
      if (helperStarted) {
        await mkdir(join(stage, 'cancel'), { recursive: true })
      } else {
        if (pendingWritten) await rm(pending, { force: true })
        await rm(stage, { recursive: true, force: true })
      }
    } catch (cleanupError) {
      console.warn(`Unable to clean Mac update staging ${stage}:`, cleanupError)
    }
    throw error
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isExpectedFileAbsenceError(error)) return false
    throw error
  }
}

export async function readMacUpdateResult(
  userData: string
): Promise<{ version: string; error: string | null } | null> {
  const pending = join(userData, 'mac-update-pending.json')
  let pendingStage: string | undefined
  try {
    const record = await readOptionalUpdateFile(pending)
    if (record === null) return null
    const { stage: recordedStage, version } = JSON.parse(record) as {
      stage: string
      version: string
    }
    if (
      typeof recordedStage !== 'string' ||
      dirname(resolve(recordedStage)) !== resolve(userData) ||
      !stagingName.test(basename(recordedStage))
    )
      throw new Error('Invalid pending Mac update path.')
    const stage = resolve(recordedStage)
    pendingStage = stage
    const stat = await lstat(stage).catch((error: unknown) => {
      if (isExpectedFileAbsenceError(error)) return null
      throw error
    })
    if (stat && !stat.isDirectory()) throw new Error('Invalid pending Mac update directory.')
    // The helper may still be recording the result while the new app starts.
    let result = stat ? await readStageResult(stage) : null
    const mayBeRunning =
      stat !== null && result === null && !(await isStaleStage(stage, stat.mtimeMs))
    for (let attempt = 0; mayBeRunning && result === null && attempt < 130; attempt++) {
      await sleep(500)
      result = await readStageResult(stage)
    }
    const log = stat ? ((await readOptionalUpdateFile(join(stage, 'helper.log'))) ?? '') : ''
    const outcome = result ?? 'incomplete'
    console[result === 'success' ? 'warn' : 'error'](`Mac update ${version}: ${outcome}`, log)
    if (result || !mayBeRunning) {
      await rm(pending, { force: true })
      pendingStage = undefined
      if (stat) {
        await rm(stage, { recursive: true, force: true }).catch((error: unknown) =>
          console.warn(`Unable to clean Mac update staging ${stage}:`, error)
        )
      }
    }
    return {
      version,
      error:
        result === 'success'
          ? null
          : `Previous Mac update ${outcome}. ${log.trim() || 'The helper did not finish.'}`
    }
  } finally {
    await cleanMacUpdateStages(userData, pendingStage).catch((error: unknown) =>
      console.warn('Unable to scan Mac update staging:', error)
    )
  }
}

async function readOptionalUpdateFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isExpectedFileAbsenceError(error)) return null
    throw error
  }
}

async function readStageResult(stage: string): Promise<'success' | 'error' | null> {
  const result = (await readOptionalUpdateFile(join(stage, 'result')))?.trim()
  return result === 'success' || result === 'error' ? result : null
}

async function isStaleStage(stage: string, modifiedAt: number): Promise<boolean> {
  if (Date.now() - modifiedAt < staleStageAgeMs) return false
  const pid = Number(await readOptionalUpdateFile(join(stage, 'supervisor.pid')))
  if (!Number.isInteger(pid) || pid <= 1 || pid > 0x7fffffff) return true
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return true
    if (code === 'EPERM') return false
    throw error
  }
}

async function cleanMacUpdateStages(userData: string, pendingStage?: string): Promise<void> {
  const entries = await readdir(userData, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || !stagingName.test(entry.name)) continue
    const stage = resolve(userData, entry.name)
    if (stage === pendingStage) continue
    try {
      const result = await readStageResult(stage)
      if (!result && !(await isStaleStage(stage, (await lstat(stage)).mtimeMs))) continue
      const log = await readOptionalUpdateFile(join(stage, 'helper.log'))
      if (log) console.warn(`Removing Mac update staging ${stage} (${result ?? 'incomplete'})`, log)
      await rm(stage, { recursive: true, force: true })
    } catch (error) {
      if (!isExpectedFileAbsenceError(error)) console.warn(`Unable to clean ${stage}:`, error)
    }
  }
}
