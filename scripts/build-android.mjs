import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sdk = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  join(homedir(), 'Android', 'Sdk'),
  join(homedir(), 'Library', 'Android', 'sdk'),
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk')
].find((path) => path && existsSync(join(path, 'platforms', 'android-36', 'android.jar')))

if (!sdk)
  throw new Error(
    'Android SDK platform 36 is required. Set ANDROID_HOME to your Android SDK directory.'
  )
const java = process.env.JAVA_HOME
  ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  : 'java'
const javaProbe = spawnSync(java, ['-version'], { encoding: 'utf8' })
const javaVersion = Number(/version "(\d+)/.exec(javaProbe.stderr ?? '')?.[1])
if (javaProbe.status !== 0 || javaVersion < 21 || javaVersion > 24 || !javaVersion) {
  throw new Error('Use JDK 21 for the Android build. Set JAVA_HOME to its installation directory.')
}

const result = spawnSync(
  process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
  ['--no-daemon', '--max-workers=2', 'assembleDebug'],
  {
    cwd: join(root, 'android'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk }
  }
)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const directory = join(root, 'dist')
await mkdir(directory, { recursive: true })
const name = `sele-${version}-android-debug.apk`
const destination = join(directory, name)
await copyFile(
  join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
  destination
)
const checksum = createHash('sha256')
  .update(await readFile(destination))
  .digest('hex')
await writeFile(`${destination}.sha256`, `${checksum}  ${name}\n`)
console.log(`Installable debug APK: ${destination}`)
