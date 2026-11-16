import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const signingVariables = [
  'SELE_ANDROID_KEYSTORE',
  'SELE_ANDROID_STORE_PASSWORD',
  'SELE_ANDROID_KEY_ALIAS',
  'SELE_ANDROID_KEY_PASSWORD'
]

export function androidBuildSpec(version, args = [], env = process.env) {
  if (args.some((arg) => arg !== '--play')) throw new Error('Usage: build-android.mjs [--play]')
  const play = args.includes('--play')
  if (play) {
    const missing = signingVariables.filter((name) => !env[name]?.trim())
    if (missing.length) throw new Error(`Play upload signing requires: ${missing.join(', ')}.`)
    if (!existsSync(env.SELE_ANDROID_KEYSTORE))
      throw new Error('The Play upload keystore is missing.')
  }
  return play
    ? {
        task: 'bundleRelease',
        source: 'app/build/outputs/bundle/release/app-release.aab',
        name: `sele-${version}-android-release.aab`
      }
    : {
        task: 'assembleDebug',
        source: 'app/build/outputs/apk/debug/app-debug.apk',
        name: `sele-${version}-android-debug.apk`
      }
}

export async function buildAndroid(args = process.argv.slice(2)) {
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const spec = androidBuildSpec(version, args)
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
  if (javaProbe.status !== 0 || javaVersion < 21 || javaVersion > 24 || !javaVersion)
    throw new Error(
      'Use JDK 21 for the Android build. Set JAVA_HOME to its installation directory.'
    )

  const result = spawnSync(
    process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
    ['--no-daemon', '--max-workers=2', spec.task],
    {
      cwd: join(root, 'android'),
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk }
    }
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Android ${spec.task} failed (${result.status}).`)
  const directory = join(root, 'dist')
  await mkdir(directory, { recursive: true })
  const destination = join(directory, spec.name)
  await copyFile(join(root, 'android', spec.source), destination)
  const checksum = createHash('sha256')
    .update(await readFile(destination))
    .digest('hex')
  await writeFile(`${destination}.sha256`, `${checksum}  ${spec.name}\n`)
  console.log(
    `${args.includes('--play') ? 'Play upload bundle' : 'Installable debug APK'}: ${destination}`
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildAndroid()
}
