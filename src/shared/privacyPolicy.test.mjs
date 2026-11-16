import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { privacyPolicy } from './privacyPolicy.ts'

test('offline privacy disclosure matches the published store policy', async () => {
  assert.equal(privacyPolicy, await readFile('fastlane/metadata/android/PRIVACY.md', 'utf8'))
})
