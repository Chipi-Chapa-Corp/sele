import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// Bundle the pure session registry so these lifecycle tests need no Electron process.
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('./CodexBrowserSessions.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm'
})
const {
  registerBrowserUseSession,
  getBrowserUseSession,
  onBrowserUseSessionRemoved,
  removeBrowserUseSessions
} = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
)

function mockBridgeClient(sessionId) {
  let leaseHeld = true
  let closeCount = 0
  const unsubscribe = onBrowserUseSessionRemoved((removedId) => {
    if (removedId !== sessionId) return
    closeCount++
    leaseHeld = false
  })
  return {
    unsubscribe,
    get leaseHeld() {
      return leaseHeld
    },
    get closeCount() {
      return closeCount
    }
  }
}

test('moving an existing Codex session to SSH revokes its local scope and clients', () => {
  const owner = {}
  const sessionId = 'ssh-reregistration'
  registerBrowserUseSession(owner, sessionId, '/project', null)
  const client = mockBridgeClient(sessionId)
  try {
    assert.equal(getBrowserUseSession(sessionId).containerKey, 'host')
    registerBrowserUseSession(owner, sessionId, '/project', {
      kind: 'container',
      tool: 'ssh',
      name: 'remote',
      runtime: { kind: 'host' }
    })
    assert.equal(getBrowserUseSession(sessionId), undefined)
    assert.equal(client.leaseHeld, false)
    assert.equal(client.closeCount, 1)
    // Re-registering or removing an already remote-only session must not revoke twice.
    registerBrowserUseSession(owner, sessionId, '/project', {
      kind: 'container',
      tool: 'ssh',
      name: 'remote'
    })
    removeBrowserUseSessions(owner)
    assert.equal(client.closeCount, 1)
  } finally {
    client.unsubscribe()
    removeBrowserUseSessions(owner)
  }
})

test('changing a local container scope revokes old clients before registering its replacement', () => {
  const owner = {}
  const sessionId = 'container-reregistration'
  registerBrowserUseSession(owner, sessionId, '/project', null)
  const original = mockBridgeClient(sessionId)
  try {
    const container = { kind: 'container', tool: 'toolbox', name: 'dev' }
    registerBrowserUseSession(owner, sessionId, '/project', container)
    assert.equal(original.leaseHeld, false)
    assert.equal(original.closeCount, 1)
    assert.equal(getBrowserUseSession(sessionId).containerKey, 'toolbox:dev')
    original.unsubscribe()
    const replacement = mockBridgeClient(sessionId)
    try {
      registerBrowserUseSession(owner, sessionId, '/project', container)
      assert.equal(replacement.leaseHeld, true, 'unchanged registration preserves the client')
      registerBrowserUseSession(owner, sessionId, '/other-project', container)
      assert.equal(replacement.leaseHeld, false)
      assert.equal(replacement.closeCount, 1)
      assert.equal(getBrowserUseSession(sessionId).cwd, '/other-project')
    } finally {
      replacement.unsubscribe()
    }
  } finally {
    original.unsubscribe()
    removeBrowserUseSessions(owner)
  }
})

test('owner replacement revokes existing clients and owner cleanup cannot remove the replacement', () => {
  const previousOwner = {}
  const nextOwner = {}
  const sessionId = 'owner-reregistration'
  registerBrowserUseSession(previousOwner, sessionId, '/project', null)
  const client = mockBridgeClient(sessionId)
  try {
    registerBrowserUseSession(nextOwner, sessionId, '/project', null)
    assert.equal(client.leaseHeld, false)
    assert.equal(client.closeCount, 1)
    removeBrowserUseSessions(previousOwner)
    assert.ok(getBrowserUseSession(sessionId))
  } finally {
    client.unsubscribe()
    removeBrowserUseSessions(nextOwner)
  }
})
