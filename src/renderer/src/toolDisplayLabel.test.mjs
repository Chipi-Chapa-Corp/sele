import assert from 'node:assert/strict'
import test from 'node:test'
import { getToolDisplayLabel, getToolSequenceDisplayLabel } from './toolDisplayLabel.ts'

test('unknown tools retain their names while running and after completion', () => {
  assert.equal(getToolDisplayLabel('inspect_runtime', 'other', true), 'Using inspect_runtime')
  assert.equal(getToolDisplayLabel('inspect_runtime', 'other', false), 'Used inspect_runtime')
  assert.equal(
    getToolDisplayLabel('Used mcp__example__run', 'other', true),
    'Using mcp__example__run'
  )
})

test('subagent rows show their task description without a Using/Used prefix', () => {
  const label = 'Explore chat switching code'
  assert.equal(getToolDisplayLabel(label, 'other', true, 'subagent'), label)
  assert.equal(getToolDisplayLabel(label, 'other', false, 'subagent'), label)
  assert.equal(
    getToolDisplayLabel('Started subagent', 'other', true, 'subagent'),
    'Starting subagent'
  )
  assert.equal(
    getToolDisplayLabel('Started subagent', 'other', false, 'subagent'),
    'Started subagent'
  )
  assert.equal(getToolDisplayLabel('Tool use', 'other', true, 'subagent'), 'Running subagent')
})

test('collapsed groups retain concrete actions and named fallbacks', () => {
  const labels = ['Fetched web pages', 'Updated plan', 'Used mcp__example__run']
  assert.equal(
    getToolSequenceDisplayLabel(['other'], false, labels),
    'Fetched web pages, Updated plan, Used mcp__example__run'
  )
  assert.equal(
    getToolSequenceDisplayLabel(['other'], true, labels),
    'Fetching web pages, Updating plan, Using mcp__example__run'
  )
  assert.equal(
    getToolSequenceDisplayLabel(['search', 'other', 'search'], false, ['Used custom_tool']),
    'Searched, Used custom_tool'
  )
})
