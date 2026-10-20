import assert from 'node:assert/strict'
import test from 'node:test'
import { SubagentCompletionTimeline } from './subagentTimeline.ts'
import { getVisibleSubagentRows, getWorkingSubagentIds } from './subagentUi.ts'
const agent = (id, status = 'running', parentId = null) => ({
  id,
  title: id,
  parentId,
  status,
  description: null,
  createdAt: 100,
  updatedAt: 200
})
const message = (id, createdAt) => ({ type: 'message', id, role: 'user', content: id, createdAt })
const placements = (value) => [...value.before.values(), ...value.after.values()].flat()

test('running descendants keep every ancestor working, including a completed parent', () => {
  const agents = [
    agent('parent', 'completed'),
    agent('child', 'running', 'parent'),
    agent('other', 'completed')
  ]
  assert.deepEqual([...getWorkingSubagentIds(agents)], ['child', 'parent'])
  assert.deepEqual(
    getVisibleSubagentRows(agents, null).map(({ subagent }) => subagent.id),
    ['parent']
  )
  assert.deepEqual(
    getVisibleSubagentRows(agents, 'parent').map(({ subagent }) => subagent.id),
    ['parent', 'child']
  )
})

test('sidebar expands only the open branch and retains the selected terminal path', () => {
  const agents = [
    agent('a'),
    agent('b'),
    agent('a-child', 'running', 'a'),
    agent('b-child', 'running', 'b'),
    agent('done', 'completed')
  ]
  assert.deepEqual(
    getVisibleSubagentRows(agents, null).map(({ subagent }) => subagent.id),
    ['a', 'b']
  )
  assert.deepEqual(
    getVisibleSubagentRows(agents, 'a').map(({ subagent }) => subagent.id),
    ['a', 'a-child', 'b']
  )
  assert.deepEqual(
    getVisibleSubagentRows(
      agents.map((a) => ({ ...a, status: 'completed' })),
      'a'
    ).map(({ subagent }) => subagent.id),
    ['a']
  )
  assert.deepEqual(
    getVisibleSubagentRows(
      agents.map((a) => ({ ...a, status: 'completed' })),
      'a-child'
    ).map(({ subagent }) => subagent.id),
    ['a', 'a-child']
  )
  assert.deepEqual(
    getVisibleSubagentRows(
      agents.map((a) => ({ ...a, status: 'completed' })),
      null
    ),
    []
  )
})

test('completion stays at its native marker across new turns and history reloads', () => {
  const anchor = { type: 'timelineAnchor', id: 'turn:subagent-completed:child' }
  const done = { ...agent('child', 'completed'), afterItemId: anchor.id, turnId: 'turn' }
  const original = [message('turn:prompt', 100), anchor, message('turn:answer', 210)]
  const timeline = new SubagentCompletionTimeline()
  assert.equal(timeline.reconcile(original, [done], null, true).after.get(anchor.id).length, 1)
  const newer = [...original, message('later:prompt', 300), message('later:answer', 400)]
  assert.equal(timeline.reconcile(newer, [done], null, true).after.get('later:answer'), undefined)
  assert.equal(
    new SubagentCompletionTimeline().reconcile(newer, [done], null, true).after.get(anchor.id)
      .length,
    1
  )
  assert.equal(
    timeline.reconcile(newer, [{ ...done, status: 'running' }], null, true).after.get(anchor.id)
      .length,
    1
  )
})

test('unanchored completion pins its first placement instead of following the chat tail', () => {
  const timeline = new SubagentCompletionTimeline()
  const done = { ...agent('child', 'completed'), turnId: 'turn' }
  const first = [message('turn:prompt', 100), message('turn:answer', 150)]
  assert.equal(timeline.reconcile(first, [done], null, true).after.get('turn:answer').length, 1)
  assert.equal(
    timeline
      .reconcile([...first, message('next:prompt', 300)], [done], null, true)
      .after.get('turn:answer').length,
    1
  )
  assert.equal(
    placements(timeline.reconcile([message('unrelated:prompt', 300)], [done], null, false)).length,
    0
  )
})

test('nested completion belongs to the spawning subagent chat', () => {
  const done = agent('grandchild', 'completed', 'child')
  const items = [message('child-turn:reply', 100)]
  assert.equal(
    placements(new SubagentCompletionTimeline().reconcile(items, [done], null, true)).length,
    0
  )
  assert.equal(
    placements(new SubagentCompletionTimeline().reconcile(items, [done], 'child', true)).length,
    1
  )
})

test('a completed parent with running descendants waits to emit its latest completion bubble', () => {
  const anchor = { type: 'timelineAnchor', id: 'turn:subagent-completed:parent' }
  const parent = { ...agent('parent', 'completed'), afterItemId: anchor.id }
  const timeline = new SubagentCompletionTimeline()
  assert.equal(
    placements(
      timeline.reconcile([anchor], [parent, agent('child', 'running', 'parent')], null, true)
    ).length,
    0
  )
  assert.equal(
    placements(
      timeline.reconcile([anchor], [parent, agent('child', 'completed', 'parent')], null, true)
    ).length,
    1
  )
})

test('a late native marker replaces the interim completion instead of duplicating it', () => {
  const timeline = new SubagentCompletionTimeline()
  const done = { ...agent('child', 'completed'), turnId: 'turn' }
  const original = [message('turn:prompt', 100), message('turn:answer', 150)]
  timeline.reconcile(original, [done], null, true)
  const anchor = { type: 'timelineAnchor', id: 'turn:subagent-completed:child' }
  const result = timeline.reconcile(
    [...original, anchor],
    [{ ...done, afterItemId: anchor.id }],
    null,
    true
  )
  assert.equal(placements(result).length, 1)
  assert.equal(result.after.get(anchor.id).length, 1)
})

test('resumed agents retain their previous completion and add a separate later completion', () => {
  const timeline = new SubagentCompletionTimeline()
  const oldAnchor = { type: 'timelineAnchor', id: 'old:subagent-completed:child' }
  const old = { ...agent('child', 'completed'), turnId: 'old', afterItemId: oldAnchor.id }
  const items = [message('old:prompt', 100), oldAnchor, message('new:prompt', 300)]
  timeline.reconcile(items, [old], null, true)
  timeline.reconcile(
    items,
    [{ ...old, turnId: 'new', status: 'running', updatedAt: 350 }],
    null,
    true
  )
  const stopped = { ...old, turnId: 'new', status: 'stopped', updatedAt: 400 }
  const result = timeline.reconcile(items, [stopped], null, true)
  assert.equal(placements(result).length, 2)
  assert.equal(result.after.get(oldAnchor.id)[0].subagent.status, 'completed')
  assert.equal(result.after.get('new:prompt')[0].subagent.status, 'stopped')
})
