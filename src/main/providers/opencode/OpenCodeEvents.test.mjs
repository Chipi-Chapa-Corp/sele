import assert from 'node:assert/strict'
import test from 'node:test'
import { parseOpenCodeSessionEvent } from './OpenCodeEvents.ts'

test('parses OpenCode session events from properties', () => {
  assert.deepEqual(
    parseOpenCodeSessionEvent({
      directory: '/workspace',
      payload: {
        id: 'evt_1',
        type: 'session.status',
        properties: { sessionID: 'ses_1', status: { type: 'busy' } }
      }
    }),
    {
      type: 'session.status',
      sessionID: 'ses_1',
      directory: '/workspace',
      properties: { sessionID: 'ses_1', status: { type: 'busy' } }
    }
  )
})

test('parses durable OpenCode session events from data', () => {
  assert.deepEqual(
    parseOpenCodeSessionEvent({
      directory: '/workspace',
      payload: {
        id: 'evt_2',
        type: 'message.updated',
        data: { sessionID: 'ses_2', info: { id: 'msg_1' } }
      }
    }),
    {
      type: 'message.updated',
      sessionID: 'ses_2',
      directory: '/workspace',
      properties: { sessionID: 'ses_2', info: { id: 'msg_1' } }
    }
  )
})

test('ignores non-session resource IDs', () => {
  assert.equal(
    parseOpenCodeSessionEvent({
      directory: '/workspace',
      payload: {
        id: 'evt_3',
        type: 'project.updated',
        properties: { id: 'project-hash', worktree: '/workspace' }
      }
    }),
    null
  )
  assert.equal(
    parseOpenCodeSessionEvent({
      directory: '/workspace',
      payload: { id: 'evt_4', type: 'server.connected', properties: { id: 'global' } }
    }),
    null
  )
})
