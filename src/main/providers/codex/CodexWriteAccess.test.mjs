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

for (const locallyOwned of [false, true]) {
  test(`opening a chat publishes known ownership before any send (local owner: ${locallyOwned})`, async () => {
    let revision = 2
    let probeCount = 0
    let disposed = false
    const published = []
    const capabilities = { editMessages: true, activeMessages: true }
    const adapter = extract(
      './CodexProviderAdapter.ts',
      'CodexProviderAdapter',
      ['getChat', 'probeChatWriteAccess'],
      {
        rendererChatUpdateTurnLimit: 10,
        isLegacyCodexHistory: () => false,
        codexCapabilities: capabilities,
        isActiveWriterError: () => true,
        CodexAppServerClient: class {
          async request() {
            probeCount++
            // A live update arrives while access is being checked.
            revision = 8
            throw new Error('thread chat already has an active writer')
          }
          async disposeAndWait() {
            disposed = true
          }
        }
      }
    )
    const snapshot = () => ({
      id: 'chat',
      revision,
      items: ['latest transcript'],
      capabilities,
      writeAccess: adapter.externallyOwnedThreadIds.has('chat') ? 'readOnly' : 'writable',
      writeAccessReason: adapter.externallyOwnedThreadIds.has('chat') ? 'externalOwner' : undefined
    })
    Object.assign(adapter, {
      client: { ownsThread: () => locallyOwned },
      threads: new Map([['chat', {}]]),
      pendingTurnStarts: new Map(),
      pendingTurnIds: new Map(),
      activeTurnIds: new Map(),
      externallyOwnedThreadIds: new Set(),
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
    assert.equal(detail.writeAccess, locallyOwned ? 'writable' : 'readOnly')
    assert.equal(published[0].writeAccess, detail.writeAccess)
    assert.equal(detail.capabilities.editMessages, locallyOwned)
    assert.deepEqual(Array.from(detail.items), ['latest transcript'])
    if (!locallyOwned) {
      assert.equal(disposed, true)
      assert.equal(detail.revision, 9)
      assert.equal(detail.writeAccessReason, 'externalOwner')
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
