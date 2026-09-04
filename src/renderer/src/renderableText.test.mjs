import assert from 'node:assert/strict'
import test from 'node:test'
import { getOptionalRenderableText, getRenderableText } from './renderableText.ts'

test('keeps string values renderable', () => {
  assert.equal(getRenderableText('Codex', 'Unknown'), 'Codex')
  assert.equal(getRenderableText('', 'Unknown'), '')
  assert.equal(getOptionalRenderableText('Description'), 'Description')
})

test('does not pass objects through to React text children', () => {
  assert.equal(getRenderableText({}, 'Unknown'), 'Unknown')
  assert.equal(getRenderableText(new Error('Provider failed'), 'Unknown'), 'Unknown')
  assert.equal(getOptionalRenderableText({}), null)
})
