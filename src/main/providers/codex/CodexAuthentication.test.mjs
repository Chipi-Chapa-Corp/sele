import assert from 'node:assert/strict'
import test from 'node:test'
import { isCodexAuthenticationFailure } from './CodexAuthentication.ts'
import { CodexUserQuestions } from './CodexUserQuestions.ts'

test('recognizes managed account refresh failure without misclassifying connector authorization', () => {
  for (const error of [
    {
      message:
        'Your access token could not be refreshed because your refresh token has expired. Please sign in again.'
    },
    { codexErrorInfo: 'unauthorized' },
    { data: { codexErrorInfo: 'unauthorized' } }
  ])
    assert.equal(isCodexAuthenticationFailure(error), true)
  for (const error of [
    { message: 'GitHub tool returned 401 Unauthorized' },
    { message: 'Rate limit reached' },
    { message: 'Permission denied' }
  ])
    assert.equal(isCodexAuthenticationFailure(error), false)
})

const request = {
  id: 1,
  method: 'mcpServer/elicitation/request',
  params: {
    mode: 'openai/userVerification',
    serverName: 'Demo',
    threadId: 'thread',
    challenge: 'Y2hhbGxlbmdl',
    title: 'Approve action',
    description: 'Confirm this request.'
  }
}
test('verification returns only the native proof and cancellation drops late results', async () => {
  const questions = new CodexUserQuestions()
  questions.addElicitation(request, null)
  questions.setVerificationAvailability('thread', 1, { available: true })
  const id = questions.getPending('thread').id
  const sent = []
  const handlers = {
    server: (_request, result) => sent.push(result),
    asynchronous: () => assert.fail(),
    verification: async () => ({ credentialId: 'device', signature: 'c2lnbmF0dXJl' })
  }
  await questions.resolve('thread', id, { kind: 'elicitation', action: 'accept' }, handlers)
  assert.deepEqual(sent, [
    { action: 'accept', content: { credentialId: 'device', signature: 'c2lnbmF0dXJl' } }
  ])
  questions.addElicitation({ ...request, id: 2 }, null)
  questions.setVerificationAvailability('thread', 2, { available: true })
  const next = questions.getPending('thread').id
  let complete
  let signal
  const pending = questions.resolve(
    'thread',
    next,
    { kind: 'elicitation', action: 'accept' },
    {
      ...handlers,
      verification: async (_request, value) => {
        signal = value
        return new Promise((resolve) => {
          complete = resolve
        })
      }
    }
  )
  await questions.resolve('thread', next, { kind: 'cancel' }, handlers)
  assert.equal(signal.aborted, true)
  complete({ credentialId: 'device', signature: 'bGF0ZQ' })
  await assert.rejects(pending, /canceled or resolved/)
  assert.equal(sent.at(-1).action, 'cancel')
  assert.equal(sent.length, 2)
})

test('clearing, stopping, and disconnecting abort native verification prompts', async () => {
  for (const cleanup of [
    (q) => q.clear(),
    (q) => q.cancel('thread', () => {}),
    (q) => q.removeContainer(() => true),
    (q) => q.clearServerTurn('thread', 'turn')
  ]) {
    const q = new CodexUserQuestions()
    q.addElicitation({ ...request, params: { ...request.params, turnId: 'turn' } }, null)
    q.setVerificationAvailability('thread', 1, { available: true })
    let aborted = false
    const pending = q.resolve(
      'thread',
      q.getPending('thread').id,
      { kind: 'elicitation', action: 'accept' },
      {
        server: () => assert.fail('canceled proof must never be submitted'),
        asynchronous: () => assert.fail(),
        verification: async (_request, signal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => {
              aborted = true
              reject(new Error('aborted'))
            })
          )
      }
    )
    cleanup(q)
    await assert.rejects(pending, /aborted/)
    assert.equal(aborted, true)
    assert.equal(q.getPending('thread'), null)
  }
})
