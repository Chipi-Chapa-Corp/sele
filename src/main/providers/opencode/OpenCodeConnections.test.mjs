import assert from 'node:assert/strict'
import test from 'node:test'
import { listOpenCodeConnections, connectOpenCode } from './OpenCodeConnections.ts'
import { createOpenCodeV2Client } from './OpenCodeV2Client.ts'
import { isConnectionPromptVisible } from '../../../shared/providerConnections.ts'

test('native v2 connection errors never expose submitted keys or SDK request bodies', async () => {
  const secret = 'private-fixture-key'
  const client = createOpenCodeV2Client({
    baseUrl: 'http://fixture.test',
    fetch: async () => Response.json({ message: secret }, { status: 500 })
  })
  await assert.rejects(
    connectOpenCode(client, { integrationId: 'fixture', method: 'key', key: secret }),
    (error) => !error.message.includes(secret) && /Unable to connect/.test(error.message)
  )
  await assert.rejects(
    listOpenCodeConnections(client, async () => ({})),
    /Unable to load connections/
  )
})

test('conditional provider prompts support eq and neq', () => {
  const prompt = {
    type: 'text',
    key: 'domain',
    message: 'Domain',
    when: { key: 'enterprise', op: 'eq', value: 'yes' }
  }
  assert.equal(isConnectionPromptVisible(prompt, { enterprise: 'yes' }), true)
  assert.equal(isConnectionPromptVisible(prompt, { enterprise: 'no' }), false)
  assert.equal(
    isConnectionPromptVisible(
      { ...prompt, when: { ...prompt.when, op: 'neq' } },
      { enterprise: 'no' }
    ),
    true
  )
})
