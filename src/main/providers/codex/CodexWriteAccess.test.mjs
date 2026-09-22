import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const extract = (file, className, names, globals = {}) => {
  const source = ts.createSourceFile(
    file,
    readFileSync(new URL(file, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const declaration = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name.text === className
  )
  const members = declaration.members.filter((node) => names.includes(node.name?.getText(source)))
  return vm.runInNewContext(
    ts.transpile(
      `class Harness { ${members.map((node) => node.getText(source)).join('\n')} }; new Harness()`,
      { target: ts.ScriptTarget.ES2022 }
    ),
    globals
  )
}

for (const [locallyOwned, externallyOwned] of [
  [false, true],
  [false, false],
  [true, false]
]) {
  test(`history does not wait for ownership (local: ${locallyOwned}, external: ${externallyOwned})`, async () => {
    let revision = 2
    let probeCount = 0
    let ownsThread = locallyOwned
    let finishProbe
    const probeGate = new Promise((resolve) => {
      finishProbe = resolve
    })
    const published = []
    const capabilities = { editMessages: true, activeMessages: true }
    const adapter = extract(
      './CodexProviderAdapter.ts',
      'CodexProviderAdapter',
      ['getChat', 'claimChatWriteAccess', 'checkChatWriteAccessInBackground'],
      {
        rendererChatUpdateTurnLimit: 10,
        isLegacyCodexHistory: () => false,
        codexCapabilities: capabilities,
        isActiveWriterError: () => true,
        CodexAppServerClient: class {
          constructor() {
            assert.fail('opening must reuse the persistent app-server')
          }
        }
      }
    )
    const snapshot = () => ({
      id: 'chat',
      revision,
      items: ['latest transcript'],
      capabilities,
      writeAccess: adapter.externallyOwnedThreadIds.has('chat')
        ? 'readOnly'
        : adapter.writeAccessChecks.has('chat')
          ? 'checking'
          : 'writable',
      writeAccessReason: adapter.externallyOwnedThreadIds.has('chat') ? 'externalOwner' : undefined
    })
    Object.assign(adapter, {
      client: {
        ownsThread: () => ownsThread,
        request: async (method, params) => {
          assert.equal(method, 'thread/resume')
          assert.equal(params.threadId, 'chat')
          assert.equal(params.excludeTurns, true)
          probeCount++
          await probeGate
          revision = 8
          if (externallyOwned) throw new Error('thread chat already has an active writer')
          ownsThread = true
          return { thread: { id: 'chat' } }
        }
      },
      threads: new Map([['chat', {}]]),
      pendingTurnStarts: new Map(),
      pendingTurnIds: new Map(),
      activeTurnIds: new Map(),
      externallyOwnedThreadIds: new Set(),
      writeAccessChecks: new Map(),
      bumpThreadRevision: () => {
        revision++
      },
      getThreadContainer: () => null,
      getCurrentContainer: () => null,
      runWithContainer: (container, run) => run(),
      loadChatCursorWindowInContext: async () => ({ ...snapshot(), items: ['old transcript'] }),
      emitChatUpdated: () => {
        revision++
        published.push(snapshot())
      },
      getCachedChatDetail: snapshot
    })
    const detail = await adapter.getChat('chat')
    assert.equal(probeCount, locallyOwned ? 0 : 1)
    assert.equal(detail.writeAccess, locallyOwned ? 'writable' : 'checking')
    assert.equal(published.length, 0)
    assert.deepEqual(Array.from(detail.items), ['latest transcript'])
    if (!locallyOwned) {
      // History is ready even while the ownership request is still pending.
      const repeated = await adapter.getChat('chat')
      assert.equal(repeated.writeAccess, 'checking')
      assert.equal(probeCount, 1)
      const check = adapter.writeAccessChecks.get('chat')
      finishProbe()
      await check
      assert.equal(published[0].revision, 9)
      assert.equal(published[0].writeAccess, externallyOwned ? 'readOnly' : 'writable')
      assert.equal(published[0].writeAccessReason, externallyOwned ? 'externalOwner' : undefined)
      if (!externallyOwned) {
        const reopened = await adapter.getChat('chat')
        assert.equal(reopened.writeAccess, 'writable')
        assert.equal(probeCount, 1)
      }
    }
  })
}

test('client ownership lasts through idle turns and clears on disposal or process exit', async () => {
  const client = extract(
    './CodexAppServerClient.ts',
    'CodexAppServerClient',
    ['ownedThreadIds', 'ownsThread', 'request', 'dispose', 'handleProcessEnd'],
    { registerBrowserUseSession() {}, removeBrowserUseSessions() {} }
  )
  Object.assign(client, {
    start: async () => {},
    sendRequest: async () => ({ thread: { id: 'chat', cwd: '/tmp' } }),
    browserSessionCwds: new Map(),
    rejectPending() {},
    process: null
  })
  for (const release of ['dispose', 'handleProcessEnd']) {
    await client.request('thread/resume', { threadId: 'chat' })
    assert.equal(client.ownsThread('chat'), true)
    client[release](new Error('closed'))
    assert.equal(client.ownsThread('chat'), false)
  }
})
