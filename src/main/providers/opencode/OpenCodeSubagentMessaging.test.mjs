import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createOpenCodeSubagentSummary,
  getOpenCodeSubagentPromptSettings,
  readOpenCodeSubagentPromptSettings
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

test('OpenCode subagent titles drop the task tool agent suffix', () => {
  const session = (title) => ({
    id: 'child',
    parentID: 'root',
    agent: 'explore',
    title,
    time: { created: 1, updated: 2 }
  })
  assert.equal(
    createOpenCodeSubagentSummary(session('Map the repo (@explore subagent)'), 'root').title,
    'Map the repo'
  )
  assert.equal(createOpenCodeSubagentSummary(session('Plain title'), 'root').title, 'Plain title')
  assert.equal(createOpenCodeSubagentSummary(session(''), 'root').title, 'explore')
})

test('a tool-only child page recovers native model and tool limits with one prompt lookup', async () => {
  let reads = 0
  const client = {
    session: {
      message: async (input) => {
        reads++
        assert.equal(input.messageID, 'original-prompt')
        return {
          data: {
            info: {
              role: 'user',
              id: 'original-prompt',
              agent: 'explore',
              model: { providerID: 'provider', modelID: 'model', variant: 'high' },
              tools: { task: false }
            },
            parts: []
          }
        }
      }
    }
  }
  const settings = await readOpenCodeSubagentPromptSettings(
    client,
    { ...session, directory: '/fixture' },
    [{ info: { role: 'assistant', id: 'latest', parentID: 'original-prompt' }, parts: [] }]
  )
  assert.equal(reads, 1)
  assert.deepEqual(settings, {
    agent: 'explore',
    model: { providerID: 'provider', modelID: 'model' },
    variant: 'high',
    tools: { task: false }
  })
})
