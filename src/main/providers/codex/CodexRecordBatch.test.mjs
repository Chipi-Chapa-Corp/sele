import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { BufferedSnapshotMap } from '../transcriptProjection/BufferedSnapshotMap.ts'
import { updateIndexedTranscriptRecords } from '../transcriptProjection/recordChanges.ts'

test('actual Codex item handlers batch appends and deltas until a snapshot is read', () => {
  const source = ts.createSourceFile(
    'adapter.ts',
    readFileSync(new URL('./CodexProviderAdapter.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const declaration = source.statements.find((node) => ts.isClassDeclaration(node))
  const names = new Set([
    'threads',
    'threadRevisions',
    'activeTurnIds',
    'pendingTurnIds',
    'rolledBackTurnIds',
    'updateItem',
    'isRolledBackTurn',
    'bumpThreadRevision',
    'handleAgentMessageDelta'
  ])
  const code = ts.transpileModule(
    `class Harness { ${declaration.members
      .filter((member) => names.has(member.name?.getText(source)))
      .map((member) => member.getText(source))
      .join('\n')} }; globalThis.Harness=Harness`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
  ).outputText
  const context = vm.createContext({
    BufferedSnapshotMap,
    updateIndexedTranscriptRecords,
    nowSeconds: () => 1,
    getThreadId: (params) => params.threadId,
    getTurnId: (params) => params.turnId,
    getItemId: (params) => params.itemId,
    getDelta: (params) => params.delta
  })
  vm.runInContext(code, context)
  const adapter = new context.Harness()
  adapter.cacheThread = (thread) => adapter.threads.set(thread.id, thread)
  adapter.scheduleChatUpdated = () => {}
  adapter.refreshLatestThread = () => assert.fail('unexpected history refresh')
  const items = Array.from({ length: 100_000 }, (_, index) => ({
    id: `command-${index}`,
    type: 'commandExecution'
  }))
  let copies = 0
  Object.defineProperty(items, 'slice', {
    value: (...args) => {
      copies++
      return Array.prototype.slice.apply(items, args)
    }
  })
  const initial = { id: 'chat', turns: [{ id: 'turn', items, status: 'inProgress' }] }
  adapter.threads.set('chat', initial)
  for (let index = 0; index < 100; index++)
    adapter.handleAgentMessageDelta({
      threadId: 'chat',
      turnId: 'turn',
      itemId: 'answer',
      delta: String(index % 10)
    })
  assert.equal(copies, 0, 'event ingestion does not publish/copy a snapshot per delta')
  assert.equal(
    adapter.threadRevisions.get('chat'),
    100,
    'queued events invalidate stale RPC snapshots immediately'
  )
  const published = adapter.threads.get('chat')
  assert.equal(copies, 1)
  assert.equal(published.turns[0].items.at(-1).text, '0123456789'.repeat(10))
  assert.equal(initial.turns[0].items.length, 100_000)
  adapter.handleAgentMessageDelta({
    threadId: 'chat',
    turnId: 'turn',
    itemId: 'answer',
    delta: 'tail'
  })
  assert.equal(adapter.threads.get('chat').turns[0].items.at(-1).text.length, 104)
  assert.equal(published.turns[0].items.at(-1).text.length, 100)
})
