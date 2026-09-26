import assert from 'node:assert/strict'
import test from 'node:test'
import { getClaudeSessionTitle } from './ClaudeSessionTitle.ts'

test('later Claude prompts do not replace an automatic chat title', () => {
  const firstPrompt = 'Build a small counter playground'
  assert.equal(getClaudeSessionTitle({ firstPrompt }), firstPrompt)
  assert.equal(
    getClaudeSessionTitle({ firstPrompt, summary: "erm... can't you embed it in here?" }),
    firstPrompt
  )
})

test('custom titles take priority and slash commands get readable stable names', () => {
  assert.equal(
    getClaudeSessionTitle({ customTitle: 'Counter demo', firstPrompt: '/playground:playground' }),
    'Counter demo'
  )
  assert.equal(getClaudeSessionTitle({ firstPrompt: '/playground:playground' }), 'Playground')
  assert.equal(
    getClaudeSessionTitle(
      null,
      '<command-message>playground</command-message>\n<command-name>/playground:playground</command-name>'
    ),
    'Playground'
  )
})
