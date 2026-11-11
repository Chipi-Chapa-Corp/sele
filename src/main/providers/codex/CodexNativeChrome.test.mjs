import assert from 'node:assert/strict'
import test from 'node:test'
import { getCodexNativeChromeConfig } from './CodexNativeChrome.ts'
import { usesNativeChrome } from '../nativeChrome.ts'

const installed = (names, marketplace = 'openai-bundled') => ({
  marketplaces: [{ name: marketplace, plugins: names.map((name) => ({ name, installed: true })) }]
})

test('official Chrome enables known installed plugins without requiring a particular catalog layout', () => {
  assert.deepEqual(getCodexNativeChromeConfig(installed(['chrome'])), {
    'plugins."chrome@openai-bundled".enabled': true
  })
  assert.deepEqual(
    getCodexNativeChromeConfig(installed(['chrome', 'browser', 'unified-computer-use'])),
    {
      'plugins."chrome@openai-bundled".enabled': true,
      'plugins."unified-computer-use@openai-bundled".enabled': true
    }
  )
  for (const value of [
    installed([]),
    installed(['browser']),
    installed(['chrome'], 'third-party'),
    {
      marketplaces: [{ name: 'openai-bundled', plugins: [{ name: 'chrome', installed: false }] }]
    }
  ])
    assert.deepEqual(getCodexNativeChromeConfig(value), {})
  assert.deepEqual(getCodexNativeChromeConfig(installed(['browser', 'unified-computer-use'])), {
    'plugins."unified-computer-use@openai-bundled".enabled': true
  })
})

test('native messaging requires an explicit local writable session', () => {
  const options = { nativeChrome: true, sandboxMode: 'workspace-write' }
  assert.equal(usesNativeChrome(options, null), true)
  assert.equal(usesNativeChrome(options, { kind: 'host' }), true)
  assert.equal(usesNativeChrome(undefined, null), false)
  assert.equal(usesNativeChrome({ ...options, nativeChrome: false }, null), false)
  assert.equal(usesNativeChrome({ ...options, sandboxMode: 'read-only' }, null), false)
  for (const tool of ['ssh', 'docker', 'podman', 'toolbox', 'distrobox'])
    assert.equal(usesNativeChrome(options, { kind: 'container', tool, name: 'dev' }), false)
})
