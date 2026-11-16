import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function validatePlayManifest(xml, version) {
  const attribute = (name) => new RegExp(`\\b${name}="([^"]+)"`).exec(xml)?.[1]
  assert.equal(attribute('package'), 'com.chipichapa.sele.android', 'Wrong Play package name')
  assert.equal(
    attribute('android:versionName'),
    version,
    'Bundle version differs from package.json'
  )
  const [major, minor, patch] = version.split(/[.-]/).map(Number)
  assert.equal(Number(attribute('android:versionCode')), major * 1_000_000 + minor * 1000 + patch)
  assert.ok(
    Number(attribute('android:targetSdkVersion')) >= 36,
    'Play requires target API 36 or later'
  )
  const debuggable = attribute('android:debuggable')
  assert.ok(
    debuggable === undefined || debuggable === 'false',
    'Play bundles must not be debuggable'
  )
  assert.notEqual(attribute('android:testOnly'), 'true', 'Play bundles must not be test-only')
  return {
    packageName: attribute('package'),
    versionName: version,
    versionCode: Number(attribute('android:versionCode')),
    minSdk: Number(attribute('android:minSdkVersion')),
    targetSdk: Number(attribute('android:targetSdkVersion')),
    debuggable: false
  }
}

export async function verifyAndroidPlay(bundle, bundletool) {
  assert.ok(bundle && bundletool, 'Usage: verify-android-play.mjs <bundle.aab> <bundletool.jar>')
  const javaBin = (name) =>
    process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', name) : name
  const run = (binary, args) => {
    const result = spawnSync(binary, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    if (result.status !== 0) throw result.error ?? new Error(result.stderr || result.stdout)
    return result.stdout
  }
  const java = (args) => run(javaBin('java'), ['-Duser.language=en', '-jar', bundletool, ...args])
  java(['validate', `--bundle=${bundle}`])
  const xml = java(['dump', 'manifest', `--bundle=${bundle}`, '--module=base'])
  const { version } = JSON.parse(await readFile('package.json', 'utf8'))
  const report = validatePlayManifest(xml, version)
  const signature = run(javaBin('jarsigner'), ['-J-Duser.language=en', '-verify', bundle])
  assert.match(signature, /jar verified\./, 'Bundle must have a valid JAR upload signature')
  const certificate = run(javaBin('keytool'), [
    '-J-Duser.language=en',
    '-printcert',
    '-jarfile',
    bundle
  ])
  assert.doesNotMatch(certificate, /Android Debug/i, 'A debug certificate cannot be used for Play')
  const entries = run('unzip', ['-Z1', bundle]).split('\n')
  const native = entries.filter((name) => /\/lib\/[^/]+\/[^/]+\.so$/.test(name))
  assert.equal(native.length, 0, 'Native libraries need a separate 16 KB ELF alignment audit')
  const capacitor = JSON.parse(run('unzip', ['-p', bundle, 'base/assets/capacitor.config.json']))
  assert.ok(
    !capacitor.server?.url,
    'The production UI must be bundled, not loaded from a dev server'
  )
  assert.notEqual(capacitor.android?.webContentsDebuggingEnabled, true)
  const html = run('unzip', ['-p', bundle, 'base/assets/public/index.html'])
  assert.match(html, /connect-src[^;]*wss:/, 'The packaged app must allow encrypted WebSockets')
  assert.doesNotMatch(
    html,
    /connect-src[^;]*\bws:/,
    'The packaged app must not allow plaintext WebSockets'
  )
  const digest = createHash('sha256')
    .update(await readFile(bundle))
    .digest('hex')
  assert.equal((await readFile(`${bundle}.sha256`, 'utf8')).split(/\s+/)[0], digest)
  Object.assign(report, {
    sha256: digest,
    uploadCertificateSha256: /SHA256:\s*([A-F0-9:]+)/
      .exec(certificate)?.[1]
      .replaceAll(':', '')
      .toLowerCase(),
    nativeLibraries: native.length,
    bundletoolValidated: true,
    uploadSignatureVerified: true,
    productionPolicyReviewComplete: false
  })
  await writeFile(`${bundle}.verification.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await verifyAndroidPlay(...process.argv.slice(2))
}
