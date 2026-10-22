import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { hasChatUpdateInterest, setChatUpdateInterest } from './chatUpdateInterest.ts'
import {
  createConversationView,
  isConversationOpeningDetail
} from '../../shared/conversationView.ts'
import { prepareChatDetailForRenderer } from './chatDetailLazy.ts'

const source = ts.createSourceFile(
  'providerService.ts',
  readFileSync(new URL('./providerService.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declarations = new Map(
  source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .map((node) => [node.name.getText(source), node.initializer])
)

const fixture = () => {
  let usageReads = 0
  let finishUsage
  let viewed = false
  let finishMetadata
  const events = []
  const context = vm.createContext({
    console,
    persistentChatHistory: {
      invalidate() {},
      observe() {},
      beginOpening: () => null,
      viewScope: () => null
    },
    knownConversationScopes: new Set(),
    queueConversationView: () => {},
    saveProviderChatHistory: () => {},
    Date,
    getLastTurnOutcome: () => undefined,
    getChatMetadata: async () => {
      if (finishMetadata) await finishMetadata
      return {}
    },
    getCwdMetadata: async () => ({}),
    getMessageReviews: async () => [],
    isNoProjectChat: () => false,
    getContainerTargetKey: () => 'host',
    applyTurnTokenUsage: (items) => items,
    getChatTokenUsage: () => {
      usageReads++
      return new Promise((resolve) => {
        finishUsage = resolve
      })
    },
    getLiveChatTokenUsage: async () => ({ total: { inputTokens: 5 }, byTurn: new Map() }),
    hasChatUpdateInterest: () => viewed,
    getChatUpdateSummary: (detail) => ({ id: detail.id, revision: detail.revision }),
    pendingProviderChatUpdates: new Map(),
    processingProviderChatUpdateKeys: new Set(),
    latestProviderChatUpdateRevision: new Map(),
    unreportedTurnCompletions: new Set(),
    chatUpdatedListeners: new Set([(event) => events.push(event)])
  })
  for (const name of [
    'applyMetadataToDetail',
    'drainProviderChatUpdates',
    'enqueueProviderChatUpdate'
  ])
    context[name] = vm.runInContext(
      ts.transpile(`(${declarations.get(name).getText(source)})`, {
        target: ts.ScriptTarget.ES2022
      }),
      context
    )
  return {
    context,
    events,
    get usageReads() {
      return usageReads
    },
    watch: () => {
      viewed = true
    },
    holdMetadata: (promise) => {
      finishMetadata = promise
    },
    finishUsage: () => finishUsage({ total: { inputTokens: 10 }, byTurn: new Map() }),
    publish: (revision, completed = false) =>
      context.enqueueProviderChatUpdate(
        'codex',
        { id: 'chat', revision, items: [] },
        { turnCompleted: completed }
      )
  }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))

test('background summaries do not wait for the ledger, while viewed updates include usage', async () => {
  const f = fixture()
  f.publish(1, true)
  await settle()
  assert.equal(f.events.length, 1)
  assert.equal(f.events[0].turnCompleted, true)
  assert.equal(f.usageReads, 0)
  f.watch()
  f.publish(2)
  await settle()
  assert.equal(f.usageReads, 1)
  assert.equal(f.events.length, 1)
  f.finishUsage()
  await settle()
  assert.equal(f.events[1].detail.tokenUsage.inputTokens, 10)
})

test('active streaming delivers committed totals without waiting for durable accounting', async () => {
  const f = fixture()
  f.watch()
  f.context.enqueueProviderChatUpdate('codex', {
    id: 'chat',
    revision: 1,
    status: 'active',
    items: []
  })
  await settle()
  assert.equal(f.usageReads, 0)
  assert.equal(f.events.length, 1)
  assert.equal(f.events[0].detail.tokenUsage.inputTokens, 5)
})

test('selecting a chat during metadata loading upgrades its update before delivery', async () => {
  const f = fixture()
  let release
  f.holdMetadata(
    new Promise((resolve) => {
      release = resolve
    })
  )
  f.publish(1)
  f.watch()
  release()
  await settle()
  assert.equal(f.usageReads, 1)
  assert.equal(f.events.length, 0)
  f.finishUsage()
  await settle()
  assert.equal(f.events.length, 1)
})

test('view subscriptions survive another window closing and clear explicitly', () => {
  setChatUpdateInterest(101, 'codex:chat')
  setChatUpdateInterest(102, 'codex:chat')
  setChatUpdateInterest(101, null)
  assert.equal(hasChatUpdateInterest('codex:chat'), true)
  setChatUpdateInterest(102, null)
  assert.equal(hasChatUpdateInterest('codex:chat'), false)
})

test('first background ingestion commits the durable view before publishing known state', async () => {
  const f = fixture()
  const scope = { key: 'scope' }
  let release
  let writes = 0
  f.context.persistentChatHistory.viewScope = () => scope
  f.context.saveProviderConversationView = async () => {
    writes++
    await new Promise((resolve) => {
      release = resolve
    })
    f.context.knownConversationScopes.add(scope.key)
  }
  f.publish(1)
  await settle()
  assert.equal(f.events.length, 0, 'no known-state publication ahead of its commit')
  release()
  await settle()
  assert.equal(f.events[0].conversationKnown, true)
  f.publish(2)
  await settle()
  assert.equal(writes, 1, 'subsequent streaming updates use the coalesced update path')
  assert.equal(f.events.length, 2)
})

const ingestionFixture = () => {
  const timers = new Map()
  const saved = []
  let closed = false
  let hold = false
  let release
  const scope = {
    key: 'scope',
    provider: 'codex',
    chatId: 'chat',
    containerKey: 'host',
    current: () => !closed
  }
  const context = vm.createContext({
    console,
    createConversationView,
    isConversationOpeningDetail,
    prepareChatDetailForRenderer,
    getContainerTargetKey: () => 'host',
    persistentChatHistory: {
      viewScope: () => scope,
      dispose: () => {
        closed = true
      }
    },
    adapters: { fixture: { dispose() {} } },
    pendingConversationViews: new Map(),
    conversationViewSequences: new Map(),
    conversationViewWrites: new Set(),
    knownConversationScopes: new Set(),
    latestProviderChatUpdateRevision: new Map(),
    setTimeout: (callback, delay) => {
      const token = {}
      timers.set(token, { callback, delay })
      return token
    },
    clearTimeout: (token) => timers.delete(token),
    durableConversationViews: {
      write: async (_scope, view, current) => {
        if (hold)
          await new Promise((resolve) => {
            release = resolve
          })
        if (!current()) return false
        saved.push(view)
        return true
      }
    }
  })
  for (const name of [
    'saveProviderConversationView',
    'queueConversationView',
    'disposeProviderAdapters'
  ])
    context[name] = vm.runInContext(
      ts.transpile(`(${declarations.get(name).getText(source)})`, {
        target: ts.ScriptTarget.ES2022
      }),
      context
    )
  return {
    context,
    scope,
    timers,
    saved,
    closed: () => closed,
    hold: () => {
      hold = true
    },
    release: () => {
      hold = false
      release()
    },
    tick: () => {
      const work = [...timers.values()]
      timers.clear()
      work.forEach(({ callback }) => callback())
    }
  }
}
const opening = (revision) => ({
  id: 'chat',
  revision,
  container: null,
  status: 'active',
  items: [{ type: 'message', id: 'u', role: 'user', content: String(revision) }]
})

test('stream ingestion coalesces repeated revisions and completion schedules an immediate flush', async () => {
  const h = ingestionFixture()
  for (let i = 1; i <= 200; i++) h.context.queueConversationView('codex', opening(i), false)
  assert.equal(h.timers.size, 1)
  assert.equal([...h.timers.values()][0].delay, 250)
  assert.equal(h.saved.length, 0)
  h.tick()
  await settle()
  assert.equal(h.saved.length, 1)
  assert.equal(h.saved[0].items[0].content, '200')
  h.context.queueConversationView('codex', opening(201), true)
  assert.equal([...h.timers.values()][0].delay, 0)
  h.tick()
  await settle()
  assert.equal(h.saved.at(-1).items[0].content, '201')
})

test('shutdown awaits the final durable viewport before closing its scope', async () => {
  const h = ingestionFixture()
  h.hold()
  h.context.queueConversationView('codex', opening(1), false)
  const shuttingDown = h.context.disposeProviderAdapters()
  await settle()
  assert.equal(h.timers.size, 0)
  assert.equal(h.closed(), false)
  assert.equal(h.saved.length, 0)
  h.release()
  await shuttingDown
  assert.equal(h.saved[0].items[0].content, '1')
  assert.equal(h.closed(), true)
})
