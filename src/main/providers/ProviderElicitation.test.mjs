import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createProviderElicitation, getProviderElicitationResult } from './ProviderElicitation.ts'
const request = {
  serverName: 'Test service',
  message: 'Choose a limit',
  mode: 'form',
  requestedSchema: {
    type: 'object',
    properties: { limit: { type: 'integer', minimum: 1 } },
    required: ['limit'],
    additionalProperties: false
  }
}
function extract(provider, names, globals = {}) {
  const filename = `${provider}/${provider[0].toUpperCase() + provider.slice(1)}ProviderAdapter.ts`
  const source = ts.createSourceFile(
    filename,
    readFileSync(new URL(filename, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const declaration = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text.endsWith('ProviderAdapter')
  )
  return vm.runInNewContext(
    ts.transpile(
      `class Harness{${declaration.members
        .filter((node) => names.includes(node.name?.getText(source)))
        .map((node) => node.getText(source))
        .join('\n')}};new Harness()`,
      { target: ts.ScriptTarget.ES2022 }
    ),
    { createProviderElicitation, getProviderElicitationResult, randomUUID, console, ...globals }
  )
}

test('shared form validation rejects invalid answers and executable links', () => {
  const pending = createProviderElicitation('id', request)
  assert.throws(
    () =>
      getProviderElicitationResult(pending, {
        kind: 'elicitation',
        action: 'accept',
        content: { limit: 0 }
      }),
    />= 1/
  )
  assert.deepEqual(
    getProviderElicitationResult(pending, {
      kind: 'elicitation',
      action: 'accept',
      content: { limit: 3 }
    }),
    { action: 'accept', content: { limit: 3 } }
  )
  assert.throws(
    () => createProviderElicitation('id', { ...request, mode: 'url', url: 'javascript:alert(1)' }),
    /Invalid MCP/
  )
  assert.deepEqual(getProviderElicitationResult(pending, { kind: 'cancel' }), { action: 'cancel' })
})

test('Claude callbacks use the shared prompt, retain invalid answers and abort without stale prompts', async () => {
  const adapter = extract('claude', [
    'createElicitationHandler',
    'resolveUserInput',
    'cancelPendingOnAbort',
    'getPendingUserInput',
    'rejectPendingRequests'
  ])
  const state = { pendingUserInputs: [], pendingApprovals: [] }
  adapter.ensureState = async () => state
  adapter.emitUpdate = adapter.queueUpdate = () => {}
  adapter.createChatDetail = () => ({ pendingUserInput: adapter.getPendingUserInput(state) })
  const signal = new AbortController()
  const completion = adapter.createElicitationHandler(state)(request, {
    signal: signal.signal,
    requestId: 'one'
  })
  assert.equal(adapter.getPendingUserInput(state).elicitation.mode, 'form')
  await assert.rejects(
    adapter.resolveUserInput('chat', 'elicitation:one', {
      kind: 'elicitation',
      action: 'accept',
      content: { limit: 0 }
    }),
    />= 1/
  )
  assert.equal(state.pendingUserInputs.length, 1)
  await adapter.resolveUserInput('chat', 'elicitation:one', {
    kind: 'elicitation',
    action: 'accept',
    content: { limit: 2 }
  })
  assert.deepEqual(await completion, { action: 'accept', content: { limit: 2 } })
  const canceled = adapter.createElicitationHandler(state)(
    { ...request, mode: 'url', url: 'https://example.com/auth' },
    { signal: signal.signal, requestId: 'two' }
  )
  signal.abort()
  assert.deepEqual(await canceled, { action: 'cancel' })
  assert.equal(state.pendingUserInputs.length, 0)
  const stopped = adapter.createElicitationHandler(state)(request, {
    signal: new AbortController().signal,
    requestId: 'three'
  })
  adapter.rejectPendingRequests(state)
  assert.deepEqual(await stopped, { action: 'cancel' })
})

test('Copilot handles structured forms and URL completion without changing legacy questions', async () => {
  const adapter = extract(
    'copilot',
    [
      'createElicitationHandler',
      'resolveUserInput',
      'cancelPendingUserInputs',
      'getPendingUserInput'
    ],
    {
      getUserInputPresentation: (_state, request) => ({
        choices: request.choices ?? [],
        allowFreeform: true
      })
    }
  )
  const state = { pendingUserInputs: [] }
  adapter.createState = () => state
  adapter.ensureSession = async () => state
  adapter.emitUpdate = () => {}
  adapter.createChatDetail = () => ({ pendingUserInput: adapter.getPendingUserInput(state) })
  const completion = adapter.createElicitationHandler('chat')({
    ...request,
    sessionId: 'chat',
    elicitationSource: 'MCP server'
  })
  const id = state.pendingUserInputs[0].id
  assert.equal(adapter.getPendingUserInput(state).elicitation.serverName, 'MCP server')
  await assert.rejects(
    adapter.resolveUserInput('chat', id, {
      kind: 'elicitation',
      action: 'accept',
      content: { limit: 0 }
    }),
    />= 1/
  )
  assert.equal(state.pendingUserInputs.length, 1)
  await adapter.resolveUserInput('chat', id, {
    kind: 'elicitation',
    action: 'accept',
    content: { limit: 4 }
  })
  assert.deepEqual(await completion, { action: 'accept', content: { limit: 4 } })
  const url = adapter.createElicitationHandler('chat')({
    sessionId: 'chat',
    message: 'Connect',
    mode: 'url',
    url: 'https://example.com/connect'
  })
  await adapter.resolveUserInput('chat', state.pendingUserInputs[0].id, {
    kind: 'elicitation',
    action: 'accept'
  })
  assert.deepEqual(await url, { action: 'accept' })
  const canceled = adapter.createElicitationHandler('chat')({ ...request, sessionId: 'chat' })
  adapter.cancelPendingUserInputs(state)
  assert.deepEqual(await canceled, { action: 'cancel' })
})
