import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { CodexDynamicTools } from './CodexDynamicTools.ts'

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
    [
      'ownedThreadIds',
      'recoveryThreadIds',
      'lifecycle',
      'reconnectTimer',
      'dynamicTools',
      'ownsThread',
      'request',
      'dispose',
      'handleProcessEnd'
    ],
    { CodexDynamicTools, registerBrowserUseSession() {}, removeBrowserUseSessions() {} }
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

const releaseFixture = (globals = {}) => {
  const client = extract(
    './CodexAppServerClient.ts',
    'CodexAppServerClient',
    [
      'ownedThreadIds',
      'browserSessionCwds',
      'notificationListeners',
      'stoppedListeners',
      'requestFailureListeners',
      'onNotification',
      'onStopped',
      'ownsThread',
      'request',
      'releaseThread',
      'handleLine'
    ],
    {
      setTimeout,
      clearTimeout,
      requestTimeoutMs: 30_000,
      registerBrowserUseSession() {},
      ...globals
    }
  )
  Object.assign(client, {
    start: async () => {},
    dynamicTools: { specs: [] },
    sendRequest: async () => ({ status: 'unsubscribed' })
  })
  client.ownedThreadIds.add('chat')
  client.ownedThreadIds.add('sibling')
  client.browserSessionCwds.set('chat', '/chat')
  const notify = (threadId) =>
    client.handleLine(JSON.stringify({ method: 'thread/closed', params: { threadId } }))
  return { client, notify }
}

test('account handoff waits for thread closure after unsubscribe without releasing sibling chats', async () => {
  const { client, notify } = releaseFixture()
  let released = false
  const release = client.releaseThread('chat').then(() => {
    released = true
  })
  await new Promise(setImmediate)
  assert.equal(released, false)
  assert.equal(client.ownsThread('chat'), true)
  notify('unrelated')
  await new Promise(setImmediate)
  assert.equal(released, false)
  notify('chat')
  await release
  assert.equal(client.ownsThread('chat'), false)
  assert.equal(client.ownsThread('sibling'), true)
  assert.equal(client.browserSessionCwds.has('chat'), false)
  assert.equal(client.notificationListeners.size, 0)
  assert.equal(client.stoppedListeners.size, 0)
})

test('account handoff handles closure before the unsubscribe response and already unloaded threads', async () => {
  for (const status of ['unsubscribed', 'notLoaded']) {
    const { client, notify } = releaseFixture()
    client.sendRequest = async () => {
      if (status === 'unsubscribed') notify('chat')
      return { status }
    }
    await client.releaseThread('chat')
    assert.equal(client.ownsThread('chat'), false)
    assert.equal(client.notificationListeners.size, 0)
  }
})

test('failed or timed out handoffs retain ownership and clean up before a retry', async () => {
  for (const failure of ['request', 'timeout', 'stopped']) {
    let expire
    let cleared = false
    const { client, notify } = releaseFixture({
      setTimeout: (callback) => {
        expire = callback
        return 1
      },
      clearTimeout: () => {
        cleared = true
      }
    })
    if (failure === 'request')
      client.sendRequest = async () => {
        throw new Error('unsubscribe failed')
      }
    const release = client.releaseThread('chat')
    if (failure === 'timeout') expire()
    if (failure === 'stopped')
      client.stoppedListeners.forEach((listener) => listener(new Error('stopped')))
    await assert.rejects(release, /failed|still releasing|stopped/)
    assert.equal(client.ownsThread('chat'), true)
    assert.equal(client.notificationListeners.size, 0)
    assert.equal(client.stoppedListeners.size, 0)
    assert.equal(cleared, true)
    // A timeout must still permit another unsubscribe and a successful handoff.
    client.sendRequest = async () => ({ status: 'notSubscribed' })
    const retry = client.releaseThread('chat')
    notify('chat')
    await retry
    assert.equal(client.ownsThread('chat'), false)
  }
})

test('switching an active chat stops it and waits for an outstanding ownership check before release', async () => {
  const events = []
  let checked
  const check = new Promise((resolve) => {
    checked = resolve
  })
  let closed
  const adapter = extract('./CodexProviderAdapter.ts', 'CodexProviderAdapter', ['releaseChat'])
  Object.assign(adapter, {
    activeTurnIds: new Map([['chat', 'turn']]),
    pendingTurnIds: new Map(),
    pendingTurnStarts: new Map(),
    pendingApprovalsByThread: new Map(),
    queuedTurnsByThread: new Map(),
    writeAccessChecks: new Map([['chat', check]]),
    getThreadContainer: (_id, options) => options.container,
    runWithContainer: (container, run) => {
      assert.equal(container, 'fixture-container')
      return run()
    },
    stopChat: async () => {
      events.push('stop')
    },
    client: {
      ownsThread: () => true,
      releaseThread: () => {
        events.push('release')
        return new Promise((resolve) => {
          closed = resolve
        })
      }
    }
  })
  let released = false
  const release = adapter.releaseChat('chat', { container: 'fixture-container' }).then(() => {
    released = true
  })
  await new Promise(setImmediate)
  assert.deepEqual(events, ['stop'])
  checked()
  await new Promise(setImmediate)
  assert.deepEqual(events, ['stop', 'release'])
  assert.equal(released, false)
  closed()
  await release
})
