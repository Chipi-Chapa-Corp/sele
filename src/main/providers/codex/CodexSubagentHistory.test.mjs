import assert from 'node:assert/strict'
import test from 'node:test'
import { CodexSubagentHistory } from './CodexSubagentHistory.ts'
import { createCodexSubagentTranscriptItems } from './CodexSubagents.ts'
import { getChatItems } from './CodexItemRenderers.ts'

const fixture = (childCount = 5_000) => {
  const inherited = {
    id: 'parent-copy',
    startedAt: 100,
    status: 'interrupted',
    items: [
      { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'Root request' }] },
      { id: 'spawn', type: 'subAgentActivity', agentThreadId: 'child', prompt: 'Inspect the code' }
    ]
  }
  const turns = [
    { id: 'old-parent', startedAt: 90, status: 'completed', items: [] },
    inherited,
    ...Array.from({ length: childCount }, (_, index) => ({
      id: `child-${index}`,
      startedAt: 100 + index,
      status: 'completed',
      items: [
        {
          id: `answer-${index}`,
          type: 'agentMessage',
          phase: 'final_answer',
          text: `Answer ${index}`
        }
      ]
    }))
  ]
  const requests = []
  const request = async (method, params) => {
    assert.equal(method, 'thread/turns/list')
    requests.push(params)
    const ordered = params.sortDirection === 'desc' ? [...turns].reverse() : turns
    const offset = Number(params.cursor ?? 0)
    const page = ordered.slice(offset, offset + params.limit)
    return {
      data: page.map((turn) => (params.itemsView === 'full' ? turn : { ...turn, items: [] })),
      nextCursor: offset + page.length < ordered.length ? String(offset + page.length) : null
    }
  }
  return { turns, requests, request }
}

test('Codex child pages hydrate only their requested turns after finding inherited boundary', async () => {
  const source = fixture()
  const history = new CodexSubagentHistory()
  const options = {
    request: source.request,
    key: 'host:child',
    threadId: 'child',
    createdAt: 100,
    updatedAt: 200,
    parentInstruction: null,
    filterTurns: (turns) => turns
  }
  const latest = await history.read({ ...options, window: { startIndex: null, limit: 10 } })
  assert.equal(latest.instruction, 'Inspect the code')
  assert.equal(latest.turnCount, 5_001)
  assert.equal(latest.itemsStartTurnIndex, 4_991)
  assert.deepEqual(
    latest.turns.map((turn) => turn.id),
    Array.from({ length: 10 }, (_, index) => `child-${4_990 + index}`)
  )
  const coldFull = source.requests.filter((call) => call.itemsView === 'full')
  assert.ok(
    coldFull.every((call) => call.limit <= 10),
    `cold full limits: ${coldFull.map((call) => call.limit)}`
  )

  source.requests.length = 0
  const again = await history.read({ ...options, window: { startIndex: null, limit: 10 } })
  assert.deepEqual(
    again.turns.map((turn) => turn.id),
    latest.turns.map((turn) => turn.id)
  )
  assert.equal(source.requests.filter((call) => call.itemsView === 'full').length, 1)
  assert.equal(
    source.requests.filter((call) => call.itemsView === 'notLoaded').length,
    1,
    'unchanged polls probe only the newest shell'
  )

  source.requests.length = 0
  const oldest = await history.read({ ...options, window: { startIndex: 0, limit: 10 } })
  assert.equal(oldest.itemsStartTurnIndex, 0)
  assert.deepEqual(
    oldest.turns.map((turn) => turn.id),
    Array.from({ length: 9 }, (_, index) => `child-${index}`)
  )
  assert.equal(source.requests.filter((call) => call.itemsView === 'full').length, 1)
  assert.equal(source.requests.find((call) => call.itemsView === 'full')?.limit, 9)
  const rendered = createCodexSubagentTranscriptItems(
    { id: 'child', createdAt: 100_000 },
    getChatItems(oldest.turns, 100),
    oldest.instruction
  )
  assert.equal(rendered[0].id, 'child:instruction')
  assert.equal(rendered[0].role, 'user')
  assert.equal(rendered.at(-1).content, 'Answer 8')
})

test('Codex child item lookup hydrates one old turn and keeps global coordinates', async () => {
  const source = fixture(200)
  const history = new CodexSubagentHistory()
  const options = {
    request: source.request,
    key: 'host:child',
    threadId: 'child',
    createdAt: 100,
    updatedAt: 200,
    parentInstruction: 'Inspect the code',
    filterTurns: (turns) => turns
  }
  await history.read({ ...options, window: { startIndex: null, limit: 10 } })
  source.requests.length = 0
  const page = await history.read({ ...options, itemId: 'child-3:working' })
  assert.equal(page.itemsStartTurnIndex, 4)
  assert.equal(page.turnCount, 201)
  assert.deepEqual(
    page.turns.map((turn) => turn.id),
    ['child-3']
  )
  assert.equal(source.requests.find((call) => call.itemsView === 'full')?.limit, 1)
})

test('Codex child cache refreshes after an appended turn without shifting the instruction', async () => {
  const source = fixture(20)
  const history = new CodexSubagentHistory()
  const options = {
    request: source.request,
    key: 'host:child',
    threadId: 'child',
    createdAt: 100,
    updatedAt: 200,
    parentInstruction: 'Inspect the code',
    filterTurns: (turns) => turns,
    window: { startIndex: null, limit: 2 }
  }
  await history.read(options)
  source.turns.push({
    id: 'child-20',
    startedAt: 120,
    status: 'completed',
    items: [{ id: 'answer-20', type: 'agentMessage', phase: 'final_answer', text: 'Answer 20' }]
  })
  const page = await history.read(options)
  assert.equal(page.turnCount, 22)
  assert.equal(page.itemsStartTurnIndex, 20)
  assert.deepEqual(
    page.turns.map((turn) => turn.id),
    ['child-19', 'child-20']
  )
})

test('Codex child metadata change invalidates a truncated catalog with the same newest ID', async () => {
  const source = fixture(20)
  const history = new CodexSubagentHistory()
  const options = {
    request: source.request,
    key: 'host\0child',
    threadId: 'child',
    createdAt: 100,
    updatedAt: 200,
    parentInstruction: 'Inspect the code',
    filterTurns: (turns) => turns,
    window: { startIndex: null, limit: 2 }
  }
  await history.read(options)
  source.turns.splice(5, 5)
  source.requests.length = 0
  const changed = await history.read({ ...options, updatedAt: 201 })
  assert.equal(changed.turnCount, 16)
  assert.equal(changed.itemsStartTurnIndex, 14)
  assert.ok(
    source.requests.some((call) => call.sortDirection === 'asc'),
    'a metadata change must rebuild the catalog even when its newest ID is unchanged'
  )
  source.requests.length = 0
  history.clearContainer('host')
  await history.read({ ...options, updatedAt: 201 })
  assert.ok(source.requests.some((call) => call.sortDirection === 'asc'))
})

test('Codex child catalog cache evicts old sessions', async () => {
  const source = fixture(1)
  const history = new CodexSubagentHistory()
  for (let index = 0; index < 20; index += 1) {
    await history.read({
      request: source.request,
      key: `host\0child-${index}`,
      threadId: 'child',
      createdAt: 100,
      updatedAt: 200,
      parentInstruction: 'Inspect the code',
      filterTurns: (turns) => turns,
      window: { startIndex: null, limit: 1 }
    })
  }
  assert.ok(history.entries.size <= 12)
})
