import assert from 'node:assert/strict'
import test from 'node:test'

import { getSubagentMarkerPlacements, getSubagentMarkerPresentation } from './subagentUi.ts'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const subagent = (status) => ({
  id: 'agent-1',
  parentId: null,
  title: 'Explorer',
  description: null,
  status,
  createdAt: null,
  updatedAt: null
})

test('presents subagents like the existing AI commit transcript markers', () => {
  assert.deepEqual(getSubagentMarkerPresentation(subagent('running')), {
    label: 'Explorer is working…',
    status: 'pending'
  })
  assert.deepEqual(getSubagentMarkerPresentation(subagent('completed')), {
    label: 'Explorer finished',
    status: 'finished'
  })
  assert.deepEqual(getSubagentMarkerPresentation(subagent('failed')), {
    label: 'Explorer failed',
    status: 'failed'
  })
})

test('places terminal and active subagents inside their working sections', () => {
  const items = [
    { type: 'message', id: 'user-1', role: 'user', content: 'one', createdAt: 100 },
    { type: 'working', id: 'working-1', status: 'worked', items: [] },
    { type: 'message', id: 'assistant-1', role: 'assistant', content: 'two', createdAt: 300 },
    { type: 'message', id: 'user-2', role: 'user', content: 'three', createdAt: 500 },
    { type: 'working', id: 'working-2', status: 'working', items: [] }
  ]
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const marker = (id, status, updatedAt) => ({
    id,
    parentId: null,
    title: id,
    description: null,
    status,
    createdAt: 50,
    updatedAt
  })

  const placements = getSubagentMarkerPlacements(
    [
      marker('running', 'running', 200),
      marker('late', 'completed', 600),
      marker('failed', 'failed', 450),
      marker('early', 'completed', 250)
    ],
    items
  )

  assert.deepEqual(
    placements.workingStepId.get('working-1')?.map((entry) => entry.id),
    ['early', 'failed']
  )
  assert.deepEqual(
    placements.workingStepId.get('working-2')?.map((entry) => entry.id),
    ['late', 'running']
  )
  assert.deepEqual(placements.unplaced, [])
})

test('prefers a durable provider transcript anchor after restart', () => {
  const anchored = {
    ...subagent('completed'),
    afterItemId: 'parent-turn:subagent-completed:agent-1',
    updatedAt: 1_000
  }
  const placements = getSubagentMarkerPlacements(
    [anchored],
    [
      { type: 'working', id: 'parent-turn:working', status: 'worked', items: [] },
      { type: 'timelineAnchor', id: 'parent-turn:subagent-completed:agent-1' }
    ]
  )

  assert.deepEqual(placements.workingStepId.get('parent-turn:working'), [anchored])
  assert.deepEqual(placements.unplaced, [])
})

test('does not move a durable marker to the bottom while its transcript page is unloaded', () => {
  const anchored = {
    ...subagent('completed'),
    afterItemId: 'older-turn:subagent-completed:agent-1',
    updatedAt: 1_000
  }
  const placements = getSubagentMarkerPlacements(
    [anchored],
    [{ type: 'message', id: 'latest-user', role: 'user', content: 'Latest', createdAt: 2_000 }]
  )

  assert.equal(placements.workingStepId.size, 0)
  assert.deepEqual(placements.unplaced, [anchored])
})
