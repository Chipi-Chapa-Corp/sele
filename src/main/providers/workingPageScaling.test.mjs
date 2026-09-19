import assert from 'node:assert/strict'
import test from 'node:test'
import { groupWorkingStepItems, prepareWorkingStepPage } from './workingStepLazy.ts'

test('reopening a grouped tool sequence does not recount every hidden tool payload', () => {
  let reads = 0
  const step = groupWorkingStepItems({
    type: 'working', id: 'step', status: 'worked',
    items: Array.from({ length: 20000 }, (_, i) => ({
      type: 'tool', id: `tool${i}`, toolId: `tool${i}`, activity: 'command', status: 'finished', label: 'Run',
      command: 'true', get stdout() { reads++; return 'output' }, cwd: null, diffs: [], images: [], rawInput: null, rawOutput: null
    }))
  })
  const first = prepareWorkingStepPage(step, 0, 50)
  reads = 0
  const second = prepareWorkingStepPage(step, 0, 50)
  assert.ok(reads <= 200, `reopening inspected ${reads} hidden payloads for one row with 50 loaded children`)
  assert.deepEqual(second, first)
  assert.equal(second.totalCount, 1)
  assert.equal(second.items[0].toolCount, 20000)
  assert.equal(second.items[0].tools.length, 50)
})
