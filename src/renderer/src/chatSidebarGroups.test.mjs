import assert from 'node:assert/strict'
import test from 'node:test'
import { reuseChatGroups } from './chatSidebarGroups.ts'
import { getProjectDropInsertionIndex } from './chatSidebarOrder.ts'

const group = (key, chats = []) => ({ key, cwd: '/' + key, label: key, kind: 'cwd', chats })

test('project drop positions use logical indices when only middle headers are mounted', () => {
  const keys = Array.from({ length: 20 }, (_, i) => String(i))
  const headers = [
    { key: '10', top: 0, height: 40 },
    { key: '11', top: 40, height: 40 }
  ]
  assert.equal(getProjectDropInsertionIndex(keys, headers, 5), 10)
  assert.equal(getProjectDropInsertionIndex(keys, headers, 25), 11)
  assert.equal(getProjectDropInsertionIndex(keys, headers, 65), 12)
  assert.equal(getProjectDropInsertionIndex(keys, [], 65), null)
})

test('equivalent groups reuse the complete list; a changed project preserves its neighbors', () => {
  const before = [group('first'), group('second'), group('third')]
  const equal = before.map((value) => ({ ...value }))
  assert.equal(reuseChatGroups(equal, before), before)
  const updated = { ...equal[1], chats: [{ id: 'new', providerId: 'codex' }] }
  const after = reuseChatGroups([equal[0], updated, equal[2]], before)
  assert.equal(after[0], before[0])
  assert.equal(after[1], updated)
  assert.equal(after[2], before[2])
  assert.equal(before[1].chats.length, 0)
})

test('project order, deletion, visible metadata and membership changes invalidate the right group', () => {
  const before = [group('first'), group('second')]
  assert.deepEqual(reuseChatGroups([...before].reverse(), before), [...before].reverse())
  assert.deepEqual(reuseChatGroups([before[1]], before), [before[1]])
  for (const change of [
    { label: 'Renamed' },
    { cwd: '/moved' },
    { kind: 'done' },
    { projectName: 'Project name' },
    { hasWorkingChat: true },
    { key: 'other' },
    { chats: [...before[0].chats] }
  ]) {
    const updated = { ...before[0], ...change }
    const after = reuseChatGroups([updated, { ...before[1] }], before)
    assert.equal(after[0], updated)
    assert.equal(after[1], before[1])
  }
})
