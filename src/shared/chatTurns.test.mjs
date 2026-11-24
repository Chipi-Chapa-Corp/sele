import assert from 'node:assert/strict'
import test from 'node:test'
import { getWorkingStepVisualizations, unloadWorkingStepItems } from './chatTurns.ts'

const tool = (id, visualization) => ({
  type: 'tool',
  id,
  toolId: id,
  status: 'finished',
  activity: 'other',
  icon: visualization ? 'visualization' : null,
  label: 'Tool',
  command: null,
  cwd: null,
  stdout: null,
  diffs: [],
  backgroundSessionId: null,
  finishedBackgroundSessionId: null,
  rawInput: null,
  rawOutput: null,
  images: [],
  ...(visualization ? { visualization } : {})
})

const chart = { path: '/tmp/chart.html', location: 'host', title: 'Chart' }
const report = { path: '/work/report.html', location: 'workspace', url: 'https://claude.ai/a' }

test('unloaded working steps keep their visualizations visible', () => {
  const step = {
    type: 'working',
    id: 'step',
    status: 'worked',
    items: [
      tool('plain'),
      { type: 'message', id: 'note', content: 'Drawing' },
      tool('chart', chart),
      { type: 'toolGroup', id: 'group', label: '', tools: [tool('bash'), tool('report', report)] }
    ]
  }
  const expected = [
    { id: 'chart', visualization: chart },
    { id: 'report', visualization: report }
  ]
  assert.deepEqual(getWorkingStepVisualizations(step), expected)
  const unloaded = unloadWorkingStepItems(step)
  assert.equal(unloaded.itemsLoaded, false)
  assert.deepEqual(unloaded.items, [])
  assert.deepEqual(getWorkingStepVisualizations(unloaded), expected)
  // Unloading again, or loading only one page, never drops a retained document.
  assert.deepEqual(unloadWorkingStepItems(unloaded).visualizations, expected)
  const partial = { ...unloaded, itemsLoaded: true, items: [tool('report', report)] }
  assert.deepEqual(getWorkingStepVisualizations(partial), expected)
  assert.equal(
    'visualizations' in unloadWorkingStepItems({ ...step, items: [tool('plain')] }),
    false
  )
})
