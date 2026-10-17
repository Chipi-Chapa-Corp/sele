import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createOpenCodeSubagentSummary,
  getOpenCodeSubagentPromptSettings
} from './OpenCodeSubagents.ts'

const session = {
  id: 'child',
  parentID: 'root',
  agent: 'explore',
  title: 'Explore repo',
  time: { created: 1, updated: 2 }
}

test('OpenCode subagents can be messaged directly', () => {
  assert.equal(createOpenCodeSubagentSummary(session, 'root').canMessage, true)
})

test('follow-ups reuse the agent, model and tool limits the task tool gave the child', () => {
  const messages = [
    {
      info: {
        id: 'm1',
        role: 'user',
        agent: 'explore',
        model: { providerID: 'openai', modelID: 'gpt-x', variant: 'high' },
        tools: { task: false, todowrite: false }
      },
      parts: []
    },
    { info: { id: 'm2', role: 'assistant' }, parts: [] }
  ]
  assert.deepEqual(getOpenCodeSubagentPromptSettings(session, messages), {
    agent: 'explore',
    model: { providerID: 'openai', modelID: 'gpt-x' },
    variant: 'high',
    tools: { task: false, todowrite: false }
  })
  assert.deepEqual(getOpenCodeSubagentPromptSettings(session, []), { agent: 'explore' })
})
