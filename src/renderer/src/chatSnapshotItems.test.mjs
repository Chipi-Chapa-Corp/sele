import assert from 'node:assert/strict'
import test from 'node:test'
import { reuseChatSnapshotItems } from './chatSnapshotItems.ts'
import { getChatItemRenderKey } from './chatItemIdentity.ts'

const message = (id, content) => ({ id, type: 'message', role: 'assistant', content })
const detail = (items, extra = {}) => ({ id: 'chat', items, ...extra })

test('confirmation preserves render identity while provider IDs and edits remain authoritative', () => {
  const pending = { ...message('optimistic:1:user', 'Send this'), role: 'user' }
  const echo = { ...pending, id: 'native-user', editTargetId: 'native-turn' }
  const confirmed = reuseChatSnapshotItems(detail([pending]), detail([echo]))
  assert.equal(confirmed.items[0], echo)
  assert.equal(confirmed.items[0].id, 'native-user')
  assert.equal(getChatItemRenderKey(echo), pending.id)
  const refreshed = { ...echo, content: 'Edited after confirmation' }
  reuseChatSnapshotItems(confirmed, detail([refreshed]))
  assert.equal(getChatItemRenderKey(refreshed), pending.id)
})

test('identical historical text, different attachments and other chats cannot claim a pending row', () => {
  const user = (id, content) => ({ ...message(id, content), role: 'user' })
  const pending = user('optimistic:2:user', 'Again')
  const anchor = user('anchor', 'Earlier')
  const historical = user('historical', 'Again')
  const echo = user('confirmed', 'Again')
  reuseChatSnapshotItems(detail([anchor, pending]), detail([historical, anchor, echo]))
  assert.equal(getChatItemRenderKey(historical), historical.id)
  assert.equal(getChatItemRenderKey(echo), pending.id)
  const other = user('other-user', 'Again')
  reuseChatSnapshotItems(detail([pending]), { id: 'other', items: [other] })
  assert.equal(getChatItemRenderKey(other), other.id)
  const attachment = user('attachment-user', 'Again')
  attachment.attachments = [{ kind: 'image', path: '/different.png' }]
  reuseChatSnapshotItems(detail([pending]), detail([attachment]))
  assert.equal(getChatItemRenderKey(attachment), attachment.id)
})

test('repeated prompts reconcile once each in submission order', () => {
  const user = (id) => ({ ...message(id, 'Same prompt'), role: 'user' })
  const first = user('optimistic:3:user')
  const second = user('optimistic:4:user')
  const a = user('a'),
    b = user('b')
  reuseChatSnapshotItems(detail([first, second]), detail([a, b]))
  assert.equal(getChatItemRenderKey(a), first.id)
  assert.equal(getChatItemRenderKey(b), second.id)
})

test('IPC refreshes retain unchanged items without retaining stale metadata', () => {
  const old = detail([message('a', 'First'), message('b', 'Second')], { revision: 1 })
  const copy = structuredClone(old)
  copy.revision = 2
  copy.title = 'Updated title'
  const result = reuseChatSnapshotItems(old, copy)
  assert.equal(result.items, old.items)
  assert.equal(result.revision, 2)
  assert.equal(result.title, 'Updated title')
})

test('edits, order, insertion, removal and loaded payloads remain authoritative', () => {
  const old = detail([message('a', 'First'), message('b', 'Second')])
  const edited = detail([message('b', 'Edited'), message('a', 'First'), message('c', 'Third')])
  const result = reuseChatSnapshotItems(old, edited)
  assert.deepEqual(
    result.items.map((item) => item.id),
    ['b', 'a', 'c']
  )
  assert.equal(result.items[0], edited.items[0])
  assert.equal(result.items[1], old.items[0])
  const removed = reuseChatSnapshotItems(old, detail([message('b', 'Second')]))
  assert.deepEqual(removed.items, [old.items[1]])
  const unloaded = detail([{ ...old.items[0], contentLoaded: false }])
  assert.equal(reuseChatSnapshotItems(old, unloaded).items[0], unloaded.items[0])
  const other = { ...edited, id: 'other' }
  assert.equal(reuseChatSnapshotItems(old, other), other)
})

test('nested tool changes render, while equivalent payloads reuse the old working step', () => {
  const old = detail([
    {
      id: 'step',
      type: 'working',
      status: 'working',
      items: [{ id: 'tool', stdout: 'x'.repeat(1_000_000), rawInput: { args: ['a', 'b'] } }]
    }
  ])
  assert.equal(reuseChatSnapshotItems(old, structuredClone(old)).items, old.items)
  const next = structuredClone(old)
  next.items[0].items[0].rawInput.args.push('c')
  assert.equal(reuseChatSnapshotItems(old, next).items[0], next.items[0])
})

test('exotic values and bounded comparison never claim unequal payloads are equal', () => {
  const old = detail([{ ...message('a', 'Test'), rawInput: new Map([['key', 'old']]) }])
  const next = structuredClone(old)
  next.items[0].rawInput.set('key', 'new')
  assert.equal(reuseChatSnapshotItems(old, next).items[0], next.items[0])
  const big = detail([
    { ...message('a', 'Test'), rawInput: Array.from({ length: 30000 }, (_, i) => i) }
  ])
  const copy = structuredClone(big)
  assert.equal(reuseChatSnapshotItems(big, copy).items[0], copy.items[0])
})

test('exhausting the tool comparison budget still reuses unchanged messages after it', () => {
  const old = detail([
    {
      id: 'step',
      type: 'working',
      status: 'worked',
      items: [{ id: 'tool', rawOutput: Array.from({ length: 8000 }, (_, i) => ({ i, value: i })) }]
    },
    message('answer', 'A long answer '.repeat(10000)),
    message('edited', 'Before')
  ])
  const next = structuredClone(old)
  next.items[2].content = 'After'
  const result = reuseChatSnapshotItems(old, next)
  assert.ok(result.items[0] === next.items[0], 'oversized payload comparison stays bounded')
  assert.ok(
    result.items[1] === old.items[1],
    'the payload must not invalidate the following answer'
  )
  assert.ok(result.items[2] === next.items[2], 'edited text is still authoritative')
})
