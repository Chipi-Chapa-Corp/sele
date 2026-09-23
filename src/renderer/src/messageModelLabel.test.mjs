import assert from 'node:assert/strict'
import test from 'node:test'
import { getMessageModelLabel } from './messageModelLabel.ts'
import { mapClaudeModels } from '../../main/providers/claude/ClaudeModels.ts'

const models = mapClaudeModels([
  { value: 'default', resolvedModel: 'claude-opus-5', displayName: 'Default', description: '' },
  { value: 'opus[1m]', resolvedModel: 'claude-opus-5[1m]', displayName: 'Opus', description: '' },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-4-6', displayName: 'Sonnet', description: '' }
])
const resolved = new Map(models.filter(m => m.resolvedModelId).map(m => [m.id, m.resolvedModelId]))
const label = (model, selected) => getMessageModelLabel({ model }, selected, undefined, resolved)

test('Claude catalog aliases match their concrete response model', () => {
  assert.equal(label('claude-opus-5', 'opus[1m]'), null)
  assert.equal(label('claude-sonnet-4-6-20260217', 'sonnet'), null)
  assert.equal(label('sonnet', 'sonnet'), null)
})

test('different Claude families and versions remain visible', () => {
  assert.ok(label('claude-sonnet-4-6', 'opus[1m]'))
  assert.ok(label('claude-opus-4-6', 'opus[1m]'))
})

test('Auto and unknown aliases retain the concrete model label', () => {
  assert.ok(label('claude-opus-5', 'default'))
  assert.ok(label('claude-opus-5', 'unknown'))
})

test('other provider IDs retain exact comparison and catalog labels', () => {
  assert.equal(label('gpt-5', 'gpt-5'), null)
  assert.equal(getMessageModelLabel({ model: 'gpt-5' }, 'gpt-6', new Map([['gpt-5', 'GPT 5']])), 'GPT 5')
  assert.ok(label('custom-20260101', 'custom'))
  assert.equal(label(null, 'sonnet'), null)
})
