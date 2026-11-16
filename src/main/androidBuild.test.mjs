import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { androidBuildSpec } from '../../scripts/build-android.mjs'
import { validatePlayManifest } from '../../scripts/verify-android-play.mjs'

test('debug builds keep their existing APK format and require no production credentials', () => {
  assert.deepEqual(androidBuildSpec('3.33.0', [], {}), {
    task: 'assembleDebug',
    source: 'app/build/outputs/apk/debug/app-debug.apk',
    name: 'sele-3.33.0-android-debug.apk'
  })
})

test('Play builds fail before Gradle when signing configuration is missing or invalid', () => {
  assert.throws(() => androidBuildSpec('3.33.0', ['--play'], {}), /SELE_ANDROID_KEYSTORE/)
  assert.throws(() => androidBuildSpec('3.33.0', ['--unknown'], {}), /Usage/)
})

test('Play builds produce a release bundle with separate upload signing', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-play-build-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const keystore = join(directory, 'upload.jks')
  const env = {
    SELE_ANDROID_KEYSTORE: keystore,
    SELE_ANDROID_STORE_PASSWORD: 'fixture-store-password',
    SELE_ANDROID_KEY_ALIAS: 'upload',
    SELE_ANDROID_KEY_PASSWORD: 'fixture-key-password'
  }
  assert.throws(() => androidBuildSpec('3.33.0', ['--play'], env), /keystore is missing/)
  await writeFile(keystore, 'fixture keystore')
  assert.deepEqual(androidBuildSpec('3.33.0', ['--play'], env), {
    task: 'bundleRelease',
    source: 'app/build/outputs/bundle/release/app-release.aab',
    name: 'sele-3.33.0-android-release.aab'
  })
})

test('Play verification rejects debuggable bundles, stale targets and wrong app identities', () => {
  const manifest =
    '<manifest package="com.chipichapa.sele.android" android:versionName="3.33.0" android:versionCode="3033000"><uses-sdk android:minSdkVersion="24" android:targetSdkVersion="36"/><application android:debuggable="false"/></manifest>'
  assert.equal(validatePlayManifest(manifest, '3.33.0').targetSdk, 36)
  assert.equal(
    validatePlayManifest(manifest.replace('android:debuggable="false"', ''), '3.33.0').debuggable,
    false
  )
  assert.throws(
    () =>
      validatePlayManifest(manifest.replace('debuggable="false"', 'debuggable="true"'), '3.33.0'),
    /debuggable/
  )
  assert.throws(
    () =>
      validatePlayManifest(
        manifest.replace('targetSdkVersion="36"', 'targetSdkVersion="35"'),
        '3.33.0'
      ),
    /target API/
  )
  assert.throws(
    () =>
      validatePlayManifest(manifest.replace('com.chipichapa.sele.android', 'other.app'), '3.33.0'),
    /package name/
  )
  assert.throws(() => validatePlayManifest(manifest, '3.34.0'), /version differs/)
})
