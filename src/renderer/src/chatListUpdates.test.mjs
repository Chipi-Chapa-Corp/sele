import assert from 'node:assert/strict'
import test from 'node:test'
import { compareChatsByCreatedAtDesc, mergeChatUpdate } from './chatListUpdates.ts'

const makeChat = (id, createdAt = Number(id), providerId = 'codex') => ({
  id,
  providerId,
  createdAt,
  updatedAt: createdAt,
  title: id
})
const fullMerge = (chats, chat) => {
  const byKey = new Map(chats.map((value) => [value.providerId + ':' + value.id, value]))
  const previous = byKey.get(chat.providerId + ':' + chat.id)
  if (!previous || previous.updatedAt <= chat.updatedAt)
    byKey.set(chat.providerId + ':' + chat.id, chat)
  return [...byKey.values()].sort(compareChatsByCreatedAtDesc)
}

test('streamed summary replacements preserve order, untouched objects and immutable inputs', () => {
  const chats = Array.from({ length: 1000 }, (_, index) => makeChat(String(1000 - index)))
  const update = { ...chats[500], updatedAt: 5000, status: 'active' }
  const next = mergeChatUpdate(chats, update)
  assert.deepEqual(next, fullMerge(chats, update))
  assert.equal(next[500], update)
  assert.ok(next.every((chat, index) => index === 500 || chat === chats[index]))
  assert.notEqual(chats[500], update)
  assert.equal(mergeChatUpdate(next, update), next)
  assert.equal(mergeChatUpdate(next, { ...update, updatedAt: 1 }), next)
})

test('single updates match bulk merging across ties, creation changes, providers and new chats', () => {
  let chats = [makeChat('3', 3), makeChat('2', 2), makeChat('1', 2)]
  const updates = [
    { ...chats[2], updatedAt: 5 },
    { ...chats[0], createdAt: 1, updatedAt: 6 },
    makeChat('new', 4),
    makeChat('new', 4, 'claude'),
    { ...chats[1], createdAt: 4, updatedAt: 8 },
    { ...chats[0], updatedAt: 0 }
  ]
  for (const update of updates) {
    const expected = fullMerge(chats, update)
    chats = mergeChatUpdate(chats, update)
    assert.deepEqual(chats, expected)
  }
})

test('a fresh lifecycle update with an older activity time preserves sidebar metadata', () => {
  const active = {
    ...makeChat('1'),
    status: 'active',
    updatedAt: 10,
    seenUpdatedAt: 10,
    pendingApproval: null
  }
  const chats = [active]
  const stopped = {
    ...active,
    title: 'Previous title',
    updatedAt: 5,
    seenUpdatedAt: null,
    status: null,
    lastTurnOutcome: 'stopped'
  }
  assert.equal(mergeChatUpdate(chats, stopped), chats)
  const options = { authoritativeLifecycle: true }
  const next = mergeChatUpdate(chats, stopped, options)
  assert.deepEqual(next, [{ ...active, status: null, lastTurnOutcome: 'stopped' }])
  assert.equal(mergeChatUpdate(next, stopped, options), next)
  assert.deepEqual(
    mergeChatUpdate(next, { ...stopped, status: 'active', lastTurnOutcome: null }, options),
    [{ ...active, lastTurnOutcome: null }]
  )
})
