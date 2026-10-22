import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { hasChatUpdateInterest, setChatUpdateInterest } from './chatUpdateInterest.ts'

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
    persistentChatHistory: { invalidate() {}, observe() {}, beginOpening: () => null },
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
