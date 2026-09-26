import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  getClaudePluginIdForSkillPath,
  getClaudePluginState,
  getClaudeSkillInvocation,
  parseClaudePluginInventory
} from './ClaudePluginSkills.ts'

const marketplacePath =
  '/home/user/.claude/plugins/marketplaces/claude-plugins-official/plugins/playground/skills/playground/SKILL.md'

test('marketplace skills stay off until their plugin is installed and enabled', () => {
  const available = { pluginId: 'playground@claude-plugins-official', name: 'playground' }
  const inventory = parseClaudePluginInventory(
    JSON.stringify({ installed: [], available: [available] })
  )
  assert.equal(getClaudePluginIdForSkillPath(marketplacePath), available.pluginId)
  assert.equal(getClaudePluginState(inventory, available.pluginId), 'available')
  assert.equal(
    getClaudePluginState({ ...inventory, installed: [{ ...available, enabled: false }] }, available.pluginId),
    'disabled'
  )
  assert.equal(
    getClaudePluginState({ ...inventory, installed: [{ ...available, enabled: true }] }, available.pluginId),
    'enabled'
  )
})

test('plugin skills use Claude plugin command names; standalone skills keep their names', () => {
  assert.equal(getClaudeSkillInvocation('playground', marketplacePath), '/playground:playground')
  assert.equal(
    getClaudeSkillInvocation(
      'review',
      '/home/user/.claude/plugins/cache/team/plugin/v1/skills/review/SKILL.md'
    ),
    '/plugin:review'
  )
  assert.equal(getClaudeSkillInvocation('review', '/home/user/.claude/skills/review/SKILL.md'), '/review')
})
