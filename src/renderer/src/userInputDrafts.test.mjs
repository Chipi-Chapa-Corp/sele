import assert from 'node:assert/strict'
import test from 'node:test'
import { createPreferenceClient } from '../../preload/preferenceClient.ts'
import { clearUserInputDraft, readUserInputDraft, writeUserInputDraft } from './userInputDrafts.ts'

test('question drafts survive a fresh preference client and stay scoped to their chat and request', async () => {
  const disk = {}
  const connect = async () => {
    const client = createPreferenceClient({
      initialize: async () => ({ ok: true, value: { ...disk } }),
      write: async (values) => {
        for (const [key, value] of Object.entries(values)) {
          if (value === null) delete disk[key]
          else disk[key] = value
        }
        return { ok: true, value: null }
      },
      commit: () => assert.fail('typing must not require a synchronous disk write')
    })
    await client.initialize()
    globalThis.window = { preferencesApi: client }
    return client
  }
  const request = { id: 'question' }
  const next = { id: 'next-question' }
  const draft = '  unfinished answer\nwith a second line\n'
  let client = await connect()
  writeUserInputDraft('codex:chat', request, draft)
  writeUserInputDraft('codex:other-chat', request, 'Other answer')
  await client.flush()
  client = await connect()
  assert.equal(readUserInputDraft('codex:chat', request), draft)
  assert.equal(readUserInputDraft('codex:other-chat', request), 'Other answer')
  assert.equal(readUserInputDraft('claude:chat', request), '')
  assert.equal(readUserInputDraft('codex:chat', next), '')

  writeUserInputDraft('codex:chat', next, 'New answer')
  clearUserInputDraft('codex:chat', request)
  assert.equal(readUserInputDraft('codex:chat', next), 'New answer')
  clearUserInputDraft('codex:chat', next)
  assert.equal(readUserInputDraft('codex:chat', next), '')
  assert.equal(readUserInputDraft('codex:other-chat', request), 'Other answer')
  writeUserInputDraft('codex:other-chat', request, '')
  await client.flush()
  assert.deepEqual(disk, {})

  const secret = { id: 'secret', isSecret: true }
  writeUserInputDraft('codex:chat', secret, 'Private answer')
  assert.equal(readUserInputDraft('codex:chat', secret), '')
  await client.flush()
  assert.deepEqual(disk, {})
})
