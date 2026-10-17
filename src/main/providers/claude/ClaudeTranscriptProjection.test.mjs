/* Test fixtures are JavaScript and intentionally omit provider-only fields. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { ClaudeTranscriptProjection, renderClaudeChatItems } from './ClaudeItemRenderers.ts'
import { prepareChatDetailForRenderer } from '../chatDetailLazy.ts'

const options = { active: true, stopped: false }
const user = (id) => ({
  type: 'user',
  uuid: id,
  message: { content: id },
  parent_tool_use_id: null
})
const assistant = (id, content) => ({
  type: 'assistant',
  uuid: id,
  message: { id, content },
  parent_tool_use_id: null
})
const tool = (id) =>
  assistant(id, [{ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' } }])
const result = (id) => ({
  type: 'user',
  uuid: `${id}:result`,
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
  parent_tool_use_id: null
})
const normalized = (detail) => {
  const prepared = prepareChatDetailForRenderer(detail)
  return JSON.parse(
    JSON.stringify({
      items: prepared.items,
      itemsStartTurnIndex: prepared.itemsStartTurnIndex,
      turnCount: prepared.turnCount
    })
  )
}
const compare = (projection, source, overlays = [], settings = options) => {
  assert.deepEqual(
    normalized(projection.read(source, overlays, settings)),
    normalized({ items: renderClaudeChatItems([...source, ...overlays], settings) })
  )
}

test('Claude incremental projection matches full conversion across tools, steering, compaction and lifecycle', () => {
  const projection = new ClaudeTranscriptProjection()
  let source = []
  const messages = [
    user('u'),
    assistant('a', [{ type: 'text', text: 'Looking' }]),
    tool('t'),
    result('t'),
    assistant('a2', [
      { type: 'thinking', thinking: 'thinking' },
      { type: 'text', text: 'done' }
    ]),
    user('steer'),
    tool('t2'),
    result('t2'),
    { type: 'system', uuid: 'compact', message: { subtype: 'compact_boundary' } },
    user('after')
  ]
  for (const message of messages) {
    const next = [...source, message]
    projection.acceptSource(source, next, source.length)
    source = next
    compare(projection, source)
  }
  for (const settings of [
    { active: false, stopped: false },
    { active: false, stopped: true },
    { active: false, stopped: false, failed: true }
  ])
    compare(projection, source, [], settings)
})

test('Claude overlays roll back tool results, ids, final-answer demotion and mutable partials', () => {
  const projection = new ClaudeTranscriptProjection()
  const source = [user('u'), tool('t')]
  compare(projection, source, [result('t')])
  compare(projection, source)
  const partial = assistant('a', [{ type: 'text', text: 'stream' }])
  compare(projection, source, [partial])
  partial.message.content[0].text += ' more'
  compare(projection, source, [partial])
  compare(projection, source, [partial, tool('next')])
  compare(projection, source, [partial])
})

test('Claude bounded tails, tool counts and history windows match the full renderer', () => {
  const projection = new ClaudeTranscriptProjection()
  const source = []
  for (let i = 0; i < 15; i++) source.push(user(`u${i}`), tool(`t${i}`), result(`t${i}`))
  for (let i = 0; i < 110; i++) source.push(tool(`long${i}`), result(`long${i}`))
  compare(projection, source)
  for (let i = 0; i < 60; i++)
    source.push(assistant(`reason${i}`, [{ type: 'thinking', thinking: `${i}` }]))
  // An authoritative replacement is a fresh source identity.
  compare(projection, [...source])
})

test('Claude stream work is independent of committed history length and resets safely on replacement', () => {
  for (const count of [100, 10000]) {
    const projection = new ClaudeTranscriptProjection()
    let source = [user('u'), ...Array.from({ length: count }, (_, i) => tool(`t${i}`))]
    projection.read(source, [], options)
    const before = projection.processedRecordCount
    projection.read(source, [assistant('stream', [{ type: 'text', text: 'hello' }])], options)
    assert.equal(projection.processedRecordCount - before, 1)
    const next = [...source, result('t0')]
    projection.acceptSource(source, next, source.length)
    source = next
    compare(projection, source)
    compare(projection, source.slice(0, 2))
  }
})

test('Claude special records, shared API ids, pending messages and old tool results stay equivalent', () => {
  const projection = new ClaudeTranscriptProjection()
  let source = []
  const messages = [
    assistant('orphan', [{ type: 'text', text: 'orphan' }]),
    user('u'),
    assistant('msg_shared', [{ type: 'text', text: 'part one' }]),
    { ...assistant('msg_shared', [{ type: 'text', text: 'part two' }]), uuid: 'second-record' },
    assistant('skill', [
      { type: 'tool_use', id: 'skill', name: 'Skill', input: { skill: 'test' } }
    ]),
    { ...user('skill-body'), message: { content: 'Base directory for this skill: /tmp' } },
    result('skill'),
    {
      ...assistant('sub', [{ type: 'text', text: 'subagent text' }]),
      parent_tool_use_id: 'delegated'
    },
    { type: 'system', uuid: 'failure', failed: true, message: { content: 'failed' } },
    user('next'),
    result('skill')
  ]
  for (const message of messages) {
    const next = [...source, message]
    projection.acceptSource(source, next, source.length)
    source = next
    compare(projection, source)
  }
  compare(projection, source, [], {
    ...options,
    pendingItems: Array.from({ length: 12 }, (_, i) => ({
      type: 'pendingMessage',
      id: `q${i}`,
      content: 'queued'
    }))
  })
  const replacement = source.slice()
  replacement[2] = assistant('changed', [{ type: 'text', text: 'replacement' }])
  projection.acceptSource(source, replacement, 2)
  compare(projection, replacement)
})

test('Claude hidden tool payloads retain the full converter budget decision', () => {
  const projection = new ClaudeTranscriptProjection()
  let source = [user('u')]
  for (let i = 0; i < 60; i++) {
    const call = tool(`large${i}`)
    const output = result(`large${i}`)
    output.message.content[0].content = i < 10 ? 'x'.repeat(160000) : 'small'
    source.push(call, output)
  }
  compare(projection, source)
  const next = [...source, result('large0')]
  projection.acceptSource(source, next, source.length)
  source = next
  compare(projection, source)
})

test('Claude partial-to-committed transitions preserve API block ids and earlier snapshots', () => {
  const projection = new ClaudeTranscriptProjection()
  let source = [user('u')]
  const partial = {
    ...assistant('msg_stream', [{ type: 'text', text: 'hello' }]),
    uuid: 'msg_stream:partial'
  }
  const published = projection.read(source, [partial], options)
  const saved = JSON.stringify(published)
  partial.message.content[0].text = 'hello world'
  compare(projection, source, [partial])
  assert.equal(JSON.stringify(published), saved)
  const completed = {
    ...assistant('msg_stream', [{ type: 'text', text: 'hello world' }]),
    uuid: 'committed-sdk-uuid'
  }
  const next = [...source, completed]
  projection.acceptSource(source, next, source.length)
  source = next
  compare(projection, source)
  compare(projection, source, [
    assistant('msg_next', [{ type: 'tool_use', id: 'tool-next', name: 'Bash', input: {} }])
  ])
  compare(projection, source)
  assert.equal(JSON.stringify(published), saved)
})

test('Claude background agents keep each turn reply visible and report into their own turn', () => {
  const sub = (message) => ({ ...message, parent_tool_use_id: 'agent' })
  const notification = {
    type: 'user',
    uuid: 'notification',
    message: { content: '<task-notification>\n<task-id>a1</task-id>\n</task-notification>' },
    parent_tool_use_id: null
  }
  const messages = [
    user('u'),
    assistant('launch', [{ type: 'tool_use', id: 'agent', name: 'Agent', input: {} }]),
    result('agent'),
    assistant('started', [{ type: 'text', text: 'Started the agent.' }]),
    sub(assistant('sub-1', [{ type: 'text', text: 'Agent looking' }])),
    sub(tool('sub-tool')),
    notification,
    assistant('reply', [{ type: 'text', text: 'The agent is done.' }]),
    sub(result('sub-tool')),
    { type: 'system', uuid: 'marker', message: { subtype: 'sele_background_turn' } },
    assistant('reply-2', [{ type: 'text', text: 'Second follow-up.' }])
  ]
  const projection = new ClaudeTranscriptProjection()
  let source = []
  for (const message of messages) {
    const next = [...source, message]
    projection.acceptSource(source, next, source.length)
    source = next
    compare(projection, source)
    compare(projection, source, [], { active: false, stopped: false })
  }
  const items = normalized(projection.read(source, [], { active: false, stopped: false })).items
  const replies = items.filter((item) => item.type === 'message' && item.role === 'assistant')
  assert.deepEqual(
    replies.map((item) => item.content),
    ['Started the agent.', 'The agent is done.', 'Second follow-up.']
  )
  // Agent output stays in the turn that launched it, above that turn's reply, and its tool
  // finishes there. The follow-up turns only hold their replies.
  assert.deepEqual(
    items.map((item) => (item.type === 'message' ? `${item.role}:${item.content}` : item.type)),
    [
      'user:u',
      'working',
      'assistant:Started the agent.',
      'assistant:The agent is done.',
      'assistant:Second follow-up.'
    ]
  )
  const working = JSON.stringify(items[1])
  assert.match(working, /Agent looking/)
  assert.match(working, /"status":"finished"/)
})
