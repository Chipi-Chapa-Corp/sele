import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { CodexSubagentHistory } from './CodexSubagentHistory.ts'
import { getChatItems } from './CodexItemRenderers.ts'
import {
  createCodexSubagentSummary,
  createCodexSubagentTranscriptItems,
  getCodexSubagentInstruction,
  selectCodexSubagentTurns
} from './CodexSubagents.ts'

const source = ts.createSourceFile(
  'CodexProviderAdapter.ts',
  readFileSync(new URL('./CodexProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name.text === 'CodexProviderAdapter'
)
const method = declaration.members.find(
  (node) => node.name?.getText(source) === 'getSubagentInContext'
)
const code = ts.transpile(`class Harness { ${method.getText(source)} }; new Harness()`, {
  target: ts.ScriptTarget.ES2022
})

test('Codex adapter keeps child status and synthetic instruction while polling bounded turns', async () => {
  const turns = [
    {
      id: 'inherited',
      status: 'interrupted',
      startedAt: 100,
      items: [
        { id: 'root-user', type: 'userMessage', content: [{ type: 'text', text: 'Root' }] },
        { id: 'spawn', type: 'subAgentActivity', agentThreadId: 'child', prompt: 'Inspect it' }
      ]
    },
    ...Array.from({ length: 100 }, (_, index) => ({
      id: `turn-${index}`,
      status: 'completed',
      startedAt: 100 + index,
      items: [
        {
          id: `answer-${index}`,
          type: 'agentMessage',
          phase: 'final_answer',
          text: `Done ${index}`
        }
      ]
    }))
  ]
  const requests = []
  const request = async (_method, params) => {
    requests.push(params)
    const ordered = params.sortDirection === 'desc' ? [...turns].reverse() : turns
    const offset = Number(params.cursor ?? 0)
    const page = ordered.slice(offset, offset + params.limit)
    return {
      data: page.map((turn) => (params.itemsView === 'full' ? turn : { ...turn, items: [] })),
      nextCursor: offset + page.length < ordered.length ? String(offset + page.length) : null
    }
  }
  const adapter = vm.runInNewContext(code, {
    isLegacyCodexHistory: () => false,
    assertSupportedCodexHistory: () => {},
    getCodexSubagentInstruction,
    createCodexSubagentSummary,
    createCodexSubagentTranscriptItems,
    getChatItems,
    getContainerTargetKey: () => 'host'
  })
  Object.assign(adapter, {
    getSubagentsInContext: async () => [{ id: 'child', afterItemId: 'anchor' }],
    readThread: async () => ({
      thread: {
        id: 'child',
        historyMode: 'paginated',
        createdAt: 100,
        updatedAt: 200,
        status: { type: 'active', activeFlags: [] },
        turns: []
      }
    }),
    threads: new Map(),
    subagentHistory: new CodexSubagentHistory(),
    client: { request },
    getCurrentContainer: () => null,
    filterRolledBackTurns: (_id, value) => value,
    getRenderableTurns: (thread) => thread.turns,
    resolveThreadCwd: async () => '/repo',
    resolveThreadName: async () => 'child name',
    loadTranscriptMetadata: async () => false,
    rememberThreadContainer: () => {}
  })
  const latest = await adapter.getSubagentInContext('root', 'child', {
    startIndex: null,
    limit: 10
  })
  assert.equal(latest.status, 'running')
  assert.equal(latest.turnCount, 101)
  assert.equal(latest.itemsStartTurnIndex, 91)
  assert.equal(latest.afterItemId, 'anchor')
  assert.equal(latest.description, 'Inspect it')
  assert.equal(latest.items.at(-1).content, 'Done 99')
  requests.length = 0
  const oldest = await adapter.getSubagentInContext('root', 'child', {
    startIndex: 0,
    limit: 10
  })
  assert.equal(oldest.items[0].id, 'child:instruction')
  assert.equal(oldest.items[1].id.startsWith('turn-0:'), true)
  assert.equal(oldest.itemsStartTurnIndex, 0)
  assert.equal(requests.filter((call) => call.itemsView === 'full').length, 1)
  assert.equal(requests.find((call) => call.itemsView === 'full')?.limit, 9)
})

test('legacy Codex child history retains inherited filtering and instruction', async () => {
  const adapter = vm.runInNewContext(code, {
    isLegacyCodexHistory: () => true,
    selectCodexSubagentTurns,
    getCodexSubagentInstruction,
    createCodexSubagentSummary,
    createCodexSubagentTranscriptItems,
    getChatItems
  })
  const turns = [
    {
      id: 'parent-copy',
      status: 'interrupted',
      startedAt: 100,
      items: [
        { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'Root' }] },
        { id: 'spawn', type: 'subAgentActivity', agentThreadId: 'child', prompt: 'Inspect it' }
      ]
    },
    {
      id: 'child-turn',
      status: 'completed',
      startedAt: 101,
      items: [{ id: 'answer', type: 'agentMessage', phase: 'final_answer', text: 'Finished' }]
    }
  ]
  Object.assign(adapter, {
    getSubagentsInContext: async () => [],
    readThread: async () => ({ thread: { historyMode: 'legacy' } }),
    loadLegacyThread: async () => ({
      id: 'child',
      historyMode: 'legacy',
      createdAt: 100,
      updatedAt: 102,
      status: { type: 'idle' },
      turns
    }),
    filterRolledBackTurns: (_id, value) => value,
    rememberThreadContainer: () => {},
    cacheThread: () => {},
    threads: new Map()
  })
  const detail = await adapter.getSubagentInContext('root', 'child', {
    startIndex: null,
    limit: 10
  })
  assert.equal(detail.status, 'completed')
  assert.equal(detail.items[0].id, 'child:instruction')
  assert.equal(detail.items.at(-1).content, 'Finished')
  assert.equal(
    detail.items.some((item) => item.id.startsWith('parent-copy:')),
    false
  )
})
