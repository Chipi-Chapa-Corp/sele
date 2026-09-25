import assert from 'node:assert/strict'
import test from 'node:test'
import { CodexTranscriptMetadataIndex } from './CodexTranscriptMetadataIndex.ts'
import { CodexGoalPrompts } from './CodexGoalPrompts.ts'
import { CodexCommandStartAnchors } from './CodexCommandStartAnchors.ts'

const row = (type, payload) => JSON.stringify({ type, payload }) + '\n'
const goal = (text) =>
  row('response_item', {
    type: 'message',
    id: 'goal',
    role: 'user',
    content: [
      {
        type: 'input_text',
        text: `<codex_internal_context source="goal">${text}</codex_internal_context>`
      }
    ]
  })
const start = (id) => row('event_msg', { type: 'task_started', turn_id: id })
const item = (turnId, id, startedAt) =>
  row('event_msg', {
    type: 'item_completed',
    turn_id: turnId,
    item: { id },
    started_at_ms: startedAt
  })

const fixture = (key, path, initial) => {
  let bytes = Buffer.from(initial)
  let modifiedAtMs = 1
  let identity = 'file-a'
  let bytesRead = 0
  let reads = 0
  let fail = false
  return {
    source: {
      key,
      path,
      stat: async () => ({ size: bytes.length, modifiedAtMs, identity }),
      read: async (offset, length) => {
        if (fail) throw Object.assign(new Error('EIO'), { code: 'EIO' })
        reads++
        const part = bytes.subarray(offset, offset + length)
        bytesRead += part.length
        return part
      }
    },
    append: (text) => {
      bytes = Buffer.concat([bytes, Buffer.from(text)])
      modifiedAtMs++
    },
    replace: (text, newIdentity = identity) => {
      bytes = Buffer.from(text)
      modifiedAtMs++
      identity = newIdentity
    },
    fail: (value) => {
      fail = value
    },
    stats: () => ({ bytesRead, reads, size: bytes.length })
  }
}

test('indexes goal and command times once; equivalent fresh snapshots use cached records', async () => {
  const file = fixture(
    'host',
    '/same',
    start('turn') +
      goal('Continue ☕') +
      item('turn', 'slow', 100) +
      item('turn', 'answer', 200) +
      'x'.repeat(20_000) +
      '\n'
  )
  const index = new CodexTranscriptMetadataIndex()
  const [first, same] = await Promise.all([index.load(file.source), index.load(file.source)])
  assert.equal(first, same)
  assert.equal(first.prompts.get('turn').text, 'Continue ☕')
  assert.equal(first.starts.get('turn').get('slow'), 100)
  const afterCold = file.stats()
  const turns = () => [
    {
      id: 'turn',
      status: 'completed',
      items: [
        { id: 'answer', type: 'agentMessage', phase: 'final_answer' },
        { id: 'slow', type: 'commandExecution' }
      ]
    }
  ]
  const goals = new CodexGoalPrompts()
  const anchors = new CodexCommandStartAnchors()
  for (let i = 0; i < 5; i++) {
    const snapshot = { id: 'thread', turns: turns() }
    const metadata = await index.load(file.source)
    goals.apply(snapshot, metadata)
    assert.equal(anchors.apply(snapshot, metadata), true)
    assert.equal(goals.project('thread', snapshot.turns[0]).goalPrompt.text, 'Continue ☕')
    assert.deepEqual(
      anchors.project(snapshot.turns[0]).items.map((entry) => entry.id),
      ['slow', 'answer']
    )
    assert.equal(anchors.apply(snapshot, metadata), false)
  }
  assert.ok(
    file.stats().bytesRead - afterCold.bytesRead <= 5 * 512,
    JSON.stringify({ afterCold, final: file.stats() })
  )
  assert.equal(anchors.apply({ turns: [turns()[0]] }, first), true)
})

test('goal-only negative lookups wait a second and completed misses stay checked', () => {
  const goals = new CodexGoalPrompts()
  const make = (status) => ({
    id: 'thread',
    turns: [
      { id: status, status, items: [{ id: 'answer', type: 'agentMessage', phase: 'final_answer' }] }
    ]
  })
  const active = make('inProgress')
  assert.equal(goals.shouldLoad(active), true)
  assert.equal(goals.shouldLoad(active), false)
  const completed = make('completed')
  assert.equal(goals.shouldLoad(completed), true)
  goals.apply(completed, { prompts: new Map(), starts: new Map(), version: 0 })
  assert.equal(goals.shouldLoad(completed), false)
})

test('append parses only new bytes, including split UTF-8 and JSON lines', async () => {
  const file = fixture('host', '/rollout', start('first') + goal('First'))
  const index = new CodexTranscriptMetadataIndex()
  await index.load(file.source)
  const baseline = file.stats().bytesRead
  const next = Buffer.from(start('second') + goal('Café') + item('second', 'command', 42))
  const split = next.indexOf(Buffer.from('é')) + 1
  file.append(next.subarray(0, split))
  assert.equal((await index.load(file.source)).prompts.get('second'), undefined)
  file.append(next.subarray(split))
  const metadata = await index.load(file.source)
  assert.equal(metadata.prompts.get('second').text, 'Café')
  assert.equal(metadata.starts.get('second').get('command'), 42)
  assert.ok(file.stats().bytesRead - baseline <= next.length + 4 * 512)
})

test('truncation, same-inode regrow, source identity and errors recover correctly', async () => {
  const first = fixture('source-a', '/same', start('old') + goal('Old') + 'x'.repeat(2000) + '\n')
  const second = fixture('source-b', '/same', start('other') + goal('Other'))
  const index = new CodexTranscriptMetadataIndex()
  assert.equal((await index.load(first.source)).prompts.get('old').text, 'Old')
  assert.equal((await index.load(second.source)).prompts.get('other').text, 'Other')
  first.replace(start('new') + goal('New'))
  let metadata = await index.load(first.source)
  assert.equal(metadata.prompts.has('old'), false)
  assert.equal(metadata.prompts.get('new').text, 'New')
  first.replace(start('again') + goal('Again') + 'y'.repeat(3000) + '\n')
  metadata = await index.load(first.source)
  assert.equal(metadata.prompts.has('new'), false)
  assert.equal(metadata.prompts.get('again').text, 'Again')
  first.fail(true)
  first.append(item('again', 'tool', 5))
  await assert.rejects(index.load(first.source), { code: 'EIO' })
  first.fail(false)
  assert.equal((await index.load(first.source)).starts.get('again').get('tool'), 5)
  index.clear()
  assert.equal((await index.load(second.source)).prompts.get('other').text, 'Other')
})

test('old turn metadata stays available after more than 4096 turns', async () => {
  const records =
    start('old') +
    goal('Old') +
    Array.from({ length: 4200 }, (_, index) => item(`turn-${index}`, `item-${index}`, index)).join(
      ''
    )
  const index = new CodexTranscriptMetadataIndex()
  const file = fixture('host', '/large', records)
  const metadata = await index.load(file.source)
  assert.equal(metadata.prompts.get('old').text, 'Old')
  assert.equal(metadata.starts.get('turn-0').get('item-0'), 0)
  assert.equal(metadata.starts.get('turn-4199').get('item-4199'), 4199)
})

test('whole-file fallback reads unchanged files once and parses only appended records', async () => {
  let content = Buffer.from(start('first') + goal('First'))
  let modifiedAtMs = 1
  let reads = 0
  const source = {
    key: 'remote',
    path: '/rollout',
    stat: async () => ({ modifiedAtMs }),
    readAll: async () => {
      reads++
      return content
    }
  }
  const index = new CodexTranscriptMetadataIndex()
  assert.equal((await index.load(source)).prompts.get('first').text, 'First')
  await index.load(source)
  assert.equal(reads, 1)
  content = Buffer.concat([content, Buffer.from(start('second') + goal('Second'))])
  modifiedAtMs++
  assert.equal((await index.load(source)).prompts.get('second').text, 'Second')
  assert.equal(reads, 2)
  await index.load(source)
  assert.equal(reads, 2)
})

test('clear during a pending read discards its stale metadata', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const file = fixture('host', '/slow', start('turn') + goal('Prompt'))
  const read = file.source.read
  file.source.read = async (...args) => {
    await gate
    return read(...args)
  }
  const index = new CodexTranscriptMetadataIndex()
  const pending = index.load(file.source)
  await Promise.resolve()
  index.clear()
  release()
  await assert.rejects(pending, { code: 'ERR_CANCELED' })
  assert.equal((await index.load(file.source)).prompts.get('turn').text, 'Prompt')
})

test('source cache evicts the oldest index after sixteen rollouts', async () => {
  const index = new CodexTranscriptMetadataIndex()
  const files = Array.from({ length: 17 }, (_, number) =>
    fixture(`source-${number}`, '/rollout', start(`turn-${number}`) + goal(`Goal ${number}`))
  )
  for (const file of files) await index.load(file.source)
  const before = files[0].stats().bytesRead
  assert.equal((await index.load(files[0].source)).prompts.get('turn-0').text, 'Goal 0')
  assert.ok(files[0].stats().bytesRead > before)
})
