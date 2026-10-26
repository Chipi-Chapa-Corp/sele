import assert from 'node:assert/strict'
import test from 'node:test'
import { ChatAccounts } from './ChatAccounts.ts'

const setup = (stored = new Map()) => {
  let selected = 'a'
  const calls = []
  const runtimes = new Map()
  const make = (account) => {
    let update
    const adapter = {
      id: 'codex',
      onChatUpdated: (listener) => {
        update = listener
        return () => {}
      },
      onTokenUsage: () => () => {},
      dispose: () => calls.push(['dispose', account]),
      getModels: async () => [account],
      getUsage: async () => ({ account }),
      login: async () => ({ account }),
      getChats: async () => ({
        chats: [{ id: 'existing', container: null, status: null }],
        nextCursor: null
      }),
      startChat: async (_message, _options, created) => {
        const id = `new-${account}`
        await created(id)
        update?.({ id, status: 'active', revision: 1, items: [] })
        return { id, status: 'active', revision: 1, items: [] }
      },
      importHistory: async (id, _messages, _options, created) => {
        await created(id ?? 'import')
        return id ?? 'import'
      },
      forkChat: async (id, _message, created) => {
        await created(`fork-${id}`)
        return { id: `fork-${id}` }
      },
      continueChatInFork: async (id, _message, _options, created) => {
        await created(`continue-${id}`)
        return { id: `continue-${id}` }
      },
      summarizeChatInFork: async (id, _options, created) => {
        await created(`summary-${id}`)
        return 'summary'
      },
      update: (detail) => update?.(detail)
    }
    for (const method of [
      'continueChat',
      'sendActiveChatMessage',
      'enqueueLimitResetMessage',
      'getChat',
      'getChatWindow',
      'resolveApproval',
      'resolveUserInput',
      'stopChat',
      'getSubagent',
      'setChatTitle',
      'editPendingMessage',
      'compactChat'
    ]) {
      adapter[method] = async (id) => {
        calls.push([method, account, id])
        return { id, account, revision: account === 'a' ? 100 : 1, items: [] }
      }
    }
    if (account !== 'base') runtimes.set(account, adapter)
    return adapter
  }
  const router = new ChatAccounts(make('base'), {
    metadata: async (id) => ({ id, container: null, accountId: stored.get(id) }),
    save: async (id, account, replace) => {
      if (replace || !stored.has(id)) stored.set(id, account)
      return stored.get(id)
    },
    selected: async () => selected,
    create: make
  })
  return {
    router,
    adapter: router.adapter,
    stored,
    calls,
    runtimes,
    select: (account) => {
      selected = account
    }
  }
}

test('default account changes leave running and idle chats bound across sends and restarts', async () => {
  const h = setup()
  await h.adapter.startChat('hello')
  h.select('b')
  await h.adapter.startChat('other account')
  await h.adapter.continueChat('new-a', 'still account a')
  await h.adapter.sendActiveChatMessage('new-b', 'still account b')
  assert.deepEqual(h.calls, [
    ['continueChat', 'a', 'new-a'],
    ['sendActiveChatMessage', 'b', 'new-b']
  ])
  const restarted = setup(h.stored)
  restarted.select('c')
  await restarted.adapter.getChat('new-a')
  await restarted.adapter.continueChat('new-b', 'resume')
  assert.deepEqual(restarted.calls, [
    ['getChat', 'a', 'new-a'],
    ['continueChat', 'b', 'new-b']
  ])
})

test('discovered legacy chats are pinned before changing the new-chat default', async () => {
  const h = setup()
  await h.adapter.getChats()
  h.select('b')
  await h.adapter.getChat('existing')
  assert.equal(h.stored.get('existing'), 'a')
  assert.deepEqual(h.calls, [['getChat', 'a', 'existing']])
})

test('opening a completed chat replaces stale running activity from a missed update', async () => {
  const h = setup()
  await h.adapter.getChat('existing')
  const runtime = h.runtimes.get('a')
  runtime.update({ id: 'existing', status: 'active', revision: 101, items: [] })
  runtime.getChat = async () => ({ id: 'existing', status: null, revision: 102, items: [] })
  await h.adapter.getChat('existing')
  assert.equal((await h.adapter.getChats()).chats[0].status, null)
  runtime.update({ id: 'existing', status: 'active', revision: 101, items: [] })
  assert.equal((await h.adapter.getChats()).chats[0].status, null)
})

test('opening an older history window does not replace the running sidebar activity', async () => {
  const h = setup()
  await h.adapter.getChat('existing')
  const runtime = h.runtimes.get('a')
  runtime.update({ id: 'existing', status: 'active', revision: 101, items: [] })
  runtime.getChatWindow = async () => ({ id: 'existing', status: null, revision: 102, items: [] })
  await h.adapter.getChatWindow('existing', { startIndex: 0, limit: 1 })
  assert.equal((await h.adapter.getChats()).chats[0].status, 'active')
})

test('chat account selection changes only that chat and rejects updates from its previous runtime', async () => {
  const h = setup()
  const updates = []
  h.adapter.onChatUpdated((detail) => updates.push(detail))
  await h.adapter.startChat('first')
  await h.adapter.getChat('sibling')
  await h.router.select('new-a', 'b')
  h.runtimes.get('a').update({ id: 'new-a', title: 'stale' })
  await h.adapter.continueChat('new-a', 'account b')
  await h.adapter.continueChat('sibling', 'account a')
  await h.adapter.startChat('default is still a')
  assert.equal(
    updates.some((detail) => detail.title === 'stale'),
    false
  )
  assert.deepEqual(h.calls.slice(1, 4), [
    ['stopChat', 'a', 'new-a'],
    ['continueChat', 'b', 'new-a'],
    ['continueChat', 'a', 'sibling']
  ])
})

test('forks, linked-chat summaries, and imported histories retain their source account', async () => {
  const h = setup()
  await h.adapter.getChat('source')
  h.select('b')
  await h.adapter.forkChat('source', 'message', async () => {})
  await h.adapter.continueChatInFork('source', 'message', {}, async () => {})
  await h.adapter.summarizeChatInFork('source', {}, async () => {})
  await h.adapter.importHistory('source', [], {})
  for (const id of ['source', 'fork-source', 'continue-source', 'summary-source'])
    assert.equal(h.stored.get(id), 'a')
  await h.adapter.importHistory(null, [], {})
  assert.equal(h.stored.get('import'), 'b')
})

test('chat usage and models follow the chat; settings continue using the default', async () => {
  const h = setup()
  await h.adapter.getChat('source')
  h.select('b')
  assert.deepEqual(await h.adapter.getModels({ chatId: 'source' }), ['a'])
  assert.deepEqual(await h.adapter.getUsage({ chatId: 'source' }), { account: 'a' })
  assert.deepEqual(await h.adapter.getModels(), ['base'])
})

test('approvals, edits, navigation, subagents and compaction all route to saved credentials', async () => {
  const h = setup(new Map([['source', 'saved']]))
  for (const method of [
    'getChatWindow',
    'resolveApproval',
    'resolveUserInput',
    'getSubagent',
    'setChatTitle',
    'editPendingMessage',
    'compactChat'
  ])
    await h.adapter[method]('source')
  assert.ok(h.calls.every(([, account]) => account === 'saved'))
})

test('snapshots keep increasing when a chat changes runtimes and switches back', async () => {
  const h = setup()
  const before = await h.adapter.getChat('source')
  await h.router.select('source', 'b')
  const switched = await h.adapter.getChat('source')
  assert.ok(switched.revision > before.revision)
  await h.router.select('source', 'a')
  const restored = await h.adapter.getChat('source')
  assert.ok(restored.revision > switched.revision)
})

test('new operations wait for this chat account switch while sibling chats remain usable', async () => {
  const h = setup()
  await h.adapter.getChat('source')
  let released
  h.runtimes.get('a').releaseChat = () =>
    new Promise((resolve) => {
      released = resolve
    })
  const switching = h.router.select('source', 'b')
  await new Promise(setImmediate)
  const send = h.adapter.continueChat('source', 'after switch')
  await h.adapter.continueChat('sibling', 'unaffected')
  assert.equal(
    h.calls.some(([method, , id]) => method === 'continueChat' && id === 'source'),
    false
  )
  released()
  await switching
  await send
  assert.deepEqual(h.calls.at(-1), ['continueChat', 'b', 'source'])
})

test('a switch drains an in-flight history open before releasing its old writer', async () => {
  const h = setup()
  await h.adapter.getChat('source')
  let resolve
  const getChat = h.runtimes.get('a').getChat
  h.runtimes.get('a').getChat = (id) =>
    id === 'source'
      ? new Promise((done) => {
          resolve = done
        })
      : getChat(id)
  const read = h.adapter.getChat('source')
  await new Promise(setImmediate)
  let released = false
  h.runtimes.get('a').releaseChat = async () => {
    released = true
  }
  const switching = h.router.select('source', 'b')
  await h.adapter.getChat('sibling')
  assert.equal(released, false)
  assert.equal(h.stored.get('source'), 'a')
  resolve({ id: 'source', revision: 200, items: [] })
  await read
  await switching
  assert.equal(released, true)
  assert.equal((await h.adapter.getChat('source')).account, 'b')
})

test('a failed writer release preserves the binding and permits a later switch', async () => {
  const h = setup()
  await h.adapter.getChat('source')
  h.runtimes.get('a').releaseChat = async () => {
    throw new Error('still releasing')
  }
  await assert.rejects(h.router.select('source', 'b'), /still releasing/)
  assert.equal(h.stored.get('source'), 'a')
  h.runtimes.get('a').releaseChat = async () => {}
  await h.router.select('source', 'b')
  assert.equal((await h.adapter.getChat('source')).account, 'b')
})

test('reset queue handoffs use the chat account instead of the default account', async () => {
  const h = setup()
  await h.adapter.getChat('source')
  await h.adapter.enqueueLimitResetMessage('source', 'prompt', 'reset-id', {}, async () => {})
  assert.deepEqual(h.calls.at(-1), ['enqueueLimitResetMessage', 'a', 'source'])
})

test('scheduled new chats retain their captured account after the new-chat default changes', async () => {
  const h = setup()
  h.select('b')
  const chat = await h.adapter.startChat('', { accountId: 'a', deferInitialMessage: true })
  assert.equal(chat.accountId, 'a')
  assert.equal(h.stored.get(chat.id), 'a')
  assert.equal((await h.adapter.getUsage({ accountId: 'a' })).account, 'a')
  assert.deepEqual(await h.adapter.getModels({ accountId: 'a' }), ['a'])
})
