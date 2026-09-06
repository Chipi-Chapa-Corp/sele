import assert from 'node:assert/strict'
import test from 'node:test'
import {
  selectChatPreferences,
  updateChatPreferences,
  selectionsEqual
} from './chatModelPreferences.ts'

const first = {
  agentMode: 'interactive',
  approvalMode: 'ask-user',
  sandboxMode: 'workspace-write',
  model: 'model-a',
  reasoningEffort: 'high',
  serviceTier: null
}
const second = { ...first, model: 'model-b', reasoningEffort: 'low', serviceTier: 'priority' }

test('running chats retain their selections when existing-chat updates are disabled', () => {
  let chats = updateChatPreferences({}, 'codex:first', first, [])
  const defaults = { codex: second }
  // Changing the new-chat draft must leave the first running chat alone.
  chats = updateChatPreferences(chats, null, second, [])
  chats = updateChatPreferences(chats, 'codex:second', second, [])
  assert.deepEqual(selectChatPreferences(chats, defaults, 'codex', 'codex:first'), first)
  assert.deepEqual(selectChatPreferences(chats, defaults, 'codex', 'codex:second'), second)
  assert.deepEqual(selectChatPreferences(chats, defaults, 'codex', null), second)
  const reopened = JSON.parse(JSON.stringify(chats))
  assert.deepEqual(selectChatPreferences(reopened, defaults, 'codex', 'codex:first'), first)
})

test('existing-chat propagation changes only the targeted provider chats', () => {
  const chats = { 'codex:first': first, 'claude:first': first }
  const next = updateChatPreferences(chats, null, second, ['codex:first', 'codex:second'])
  assert.deepEqual(next['codex:first'], second)
  assert.deepEqual(next['codex:second'], second)
  assert.deepEqual(next['claude:first'], first)
  assert.deepEqual(chats['codex:first'], first)
})

test('saved creation snapshot takes precedence over a draft changed during startup', () => {
  const chats = { 'codex:first': first }
  assert.deepEqual(
    selectChatPreferences(chats, { codex: second }, 'codex', 'codex:first', second),
    first
  )
})

test('provider defaults and draft inheritance apply only without saved chat preferences', () => {
  assert.deepEqual(selectChatPreferences({}, { codex: second }, 'codex', 'codex:new', first), first)
  assert.deepEqual(selectChatPreferences({}, { claude: second }, 'claude', 'claude:new'), second)
  assert.deepEqual(selectChatPreferences({}, { codex: first }, 'claude', null), {})
})

test('restoring a selection is not a dropdown change to propagate', () => {
  assert.equal(selectionsEqual(first, { ...first }), true)
  assert.equal(selectionsEqual(first, second), false)
  assert.equal(selectionsEqual(null, first), false)
  assert.equal(selectionsEqual(first, { ...first, serviceTier: 'priority' }), false)
})
