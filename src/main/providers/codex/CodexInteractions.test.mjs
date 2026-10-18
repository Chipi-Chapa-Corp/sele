import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createRequire } from 'node:module'
import { CodexUserQuestions } from './CodexUserQuestions.ts'
import { parseCodexPermissions } from './CodexPermissionRequests.ts'
import { isBrowserPermissionRequest } from './CodexBrowserPermissions.ts'
import { CodexDynamicTools } from './CodexDynamicTools.ts'
const require = createRequire(import.meta.url)
const {
  createInteractionHarness
} = require('../../../../scripts/tests/helpers/codex-interactions.cjs')
const { scenarios } = require('../../../../scripts/tests/fixtures/codex-interactions-data.cjs')
const fixture = (name) => {
  const harness = createInteractionHarness({
    CodexUserQuestions,
    parseCodexPermissions,
    isBrowserPermissionRequest
  })
  assert.equal(harness.adapter.handleServerRequest(structuredClone(scenarios[name])), true)
  return harness
}
const respond = (h, response) =>
  h.adapter.resolveUserInput('fixture', h.snapshot().pendingUserInput.id, response)

test('MCP forms validate structured answers and preserve the request on invalid input', async () => {
  const h = fixture('fields')
  assert.equal(h.snapshot().status, 'waitingOnUserInput')
  const content = { name: 'Report', count: 3, enabled: false, region: 'eu', tags: ['summary'] }
  for (const changes of [
    { count: 0 },
    { count: 1.5 },
    { tags: ['missing'] },
    { email: 'invalid' },
    { unknown: 'ignored?' }
  ]) {
    await assert.rejects(
      respond(h, { kind: 'elicitation', action: 'accept', content: { ...content, ...changes } })
    )
    assert.ok(h.snapshot().pendingUserInput)
    assert.equal(h.sent.length, 0)
  }
  await respond(h, { kind: 'elicitation', action: 'accept', content })
  assert.deepEqual(h.sent, [{ id: 101, result: { action: 'accept', content } }])
  assert.equal(h.snapshot().pendingUserInput, null)
})

test('custom schemas remain authoritative, including nested constraints and absent remote references', async () => {
  const h = fixture('json')
  await assert.rejects(
    respond(h, { kind: 'elicitation', action: 'accept', content: { filter: { limit: 30 } } }),
    /<= 20/
  )
  await respond(h, { kind: 'elicitation', action: 'accept', content: { filter: { limit: 5 } } })
  assert.equal(h.sent[0].result.content.filter.limit, 5)
  const invalid = fixture('invalidSchema')
  await assert.rejects(
    respond(invalid, { kind: 'elicitation', action: 'accept', content: {} }),
    /unsupported or invalid schema/
  )
  await respond(invalid, { kind: 'cancel' })
  assert.deepEqual(invalid.sent[0].result, { action: 'cancel', content: null })
})

test('all form spellings route correctly and decline, cancel and verification never fabricate answers', async () => {
  for (const mode of ['form', 'openai/form', 'openaiForm']) {
    const h = createInteractionHarness({
      CodexUserQuestions,
      parseCodexPermissions,
      isBrowserPermissionRequest
    })
    h.adapter.handleServerRequest({
      ...scenarios.fields,
      params: { ...scenarios.fields.params, mode, turnId: null }
    })
    assert.equal(h.snapshot().pendingUserInput.elicitation.mode, 'form')
    await respond(h, { kind: 'elicitation', action: 'decline' })
    assert.deepEqual(h.sent[0].result, { action: 'decline', content: null })
  }
  const h = fixture('verification')
  await assert.rejects(respond(h, { kind: 'elicitation', action: 'accept' }), /unavailable/)
  await respond(h, { kind: 'cancel' })
  assert.equal(h.sent[0].result.action, 'cancel')
})

test('specialized automated-review requests cannot be accepted through general forms', async () => {
  for (const _meta of [
    { codex_strict_auto_review: true },
    { codex_approval_kind: 'browser_auth' }
  ]) {
    const h = createInteractionHarness({
      CodexUserQuestions,
      parseCodexPermissions,
      isBrowserPermissionRequest
    })
    h.adapter.handleServerRequest({
      ...scenarios.fields,
      params: {
        ...scenarios.fields.params,
        _meta,
        ...(_meta.codex_approval_kind === 'browser_auth'
          ? { requestedSchema: { type: 'object', properties: {} } }
          : {})
      }
    })
    assert.equal(h.snapshot().pendingUserInput.elicitation.mode, 'unsupported')
    await assert.rejects(
      respond(h, { kind: 'elicitation', action: 'accept', content: {} }),
      /cannot be accepted/
    )
  }
})

test('URL interactions support explicit completion and reject executable URL schemes', async () => {
  const h = fixture('url')
  assert.equal(h.snapshot().pendingUserInput.elicitation.url, scenarios.url.params.url)
  await respond(h, { kind: 'elicitation', action: 'accept' })
  assert.deepEqual(h.sent[0], { id: 102, result: { action: 'accept', content: null } })
  assert.throws(
    () =>
      h.adapter.handleServerRequest({
        ...scenarios.url,
        params: { ...scenarios.url.params, url: 'javascript:alert(1)' }
      }),
    /Invalid MCP interaction URL/
  )
})

test('permission approvals preserve requested access, distinguish scopes, and deny with no permissions', async () => {
  for (const decision of ['allow', 'allowSession', 'deny']) {
    const h = fixture('permissions')
    assert.equal(h.snapshot().status, 'waitingOnApproval')
    assert.ok(h.snapshot().pendingApproval.permissionDetails.includes('read: /demo/reference'))
    await h.adapter.resolveApproval('fixture', decision)
    assert.deepEqual(JSON.parse(JSON.stringify(h.sent[0].result)), {
      permissions: decision === 'deny' ? {} : scenarios.permissions.params.permissions,
      scope: decision === 'allowSession' ? 'session' : 'turn'
    })
    assert.equal(h.snapshot().pendingApproval, null)
  }
  const h = fixture('command')
  await assert.rejects(h.adapter.resolveApproval('fixture', 'allowSession'), /not supported/)
  assert.equal(h.sent.length, 0)
  assert.throws(() => parseCodexPermissions({ network: { unrestricted: true } }), /unsupported/)
})

test('failed delivery keeps answers pending and external resolution removes the right request', async () => {
  const h = fixture('url')
  h.adapter.client.resolveServerRequest = () => {
    throw new Error('disconnected')
  }
  await assert.rejects(respond(h, { kind: 'cancel' }), /disconnected/)
  assert.ok(h.snapshot().pendingUserInput)
  const threadId = h.adapter.userQuestions.removeResolved(102, (container) => container === null)
  assert.equal(threadId, 'fixture')
  assert.equal(h.snapshot().pendingUserInput, null)
})

test('dynamic tools execute only registered and advertised handlers with validated arguments', async () => {
  const tools = new CodexDynamicTools()
  let calls = 0
  tools.register(
    {
      type: 'function',
      name: 'echo',
      description: 'Echo text',
      inputSchema: {
        type: 'object',
        required: ['text'],
        properties: { text: { type: 'string' } },
        additionalProperties: false
      }
    },
    (args) => {
      calls++
      return { success: true, contentItems: [{ type: 'inputText', text: args.text }] }
    },
    'demo'
  )
  const params = {
    threadId: 'thread',
    turnId: 'turn',
    callId: 'call',
    namespace: 'demo',
    tool: 'echo',
    arguments: { text: 'hello' }
  }
  assert.equal((await tools.call(params)).success, false)
  tools.bind('thread', tools.specs)
  assert.deepEqual(await tools.call(params), {
    success: true,
    contentItems: [{ type: 'inputText', text: 'hello' }]
  })
  assert.equal((await tools.call({ ...params, arguments: {} })).success, false)
  assert.equal((await tools.call({ ...params, namespace: null })).success, false)
  assert.equal((await tools.call({ ...params, tool: 'missing' })).success, false)
  assert.equal(calls, 1)
  tools.clear()
  assert.equal((await tools.call(params)).success, false)
})

test('app-server transport advertises and dispatches host tools and answers the clock callback', async () => {
  const source = ts.createSourceFile(
    'CodexAppServerClient.ts',
    readFileSync(new URL('./CodexAppServerClient.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const declaration = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === 'CodexAppServerClient'
  )
  const names = [
    'request',
    'dynamicTools',
    'ownedThreadIds',
    'browserSessionCwds',
    'serverRequestListeners',
    'handleLine',
    'handleServerRequest',
    'write',
    'resolveServerRequest',
    'rejectServerRequest'
  ]
  const client = vm.runInNewContext(
    ts.transpile(
      `class Harness { ${declaration.members
        .filter((node) => names.includes(node.name?.getText(source)))
        .map((node) => node.getText(source))
        .join('\n')} }; new Harness()`,
      { target: ts.ScriptTarget.ES2022 }
    ),
    {
      CodexDynamicTools,
      registerBrowserUseSession: () => {},
      Date: { now: () => 1792234567899 },
      console
    }
  )
  const output = []
  const requests = []
  client.process = { stdin: { writable: true, write: (value) => output.push(JSON.parse(value)) } }
  client.start = async () => {}
  client.sendRequest = async (method, params) => {
    requests.push({ method, params })
    return { thread: { id: method === 'thread/fork' ? 'fork' : 'thread' } }
  }
  client.dynamicTools.register(
    { type: 'function', name: 'echo', description: 'Echo', inputSchema: { type: 'object' } },
    () => ({ success: true, contentItems: [{ type: 'inputText', text: 'executed' }] })
  )
  await client.request('thread/start', { cwd: '/demo' })
  assert.equal(requests[0].params.dynamicTools[0].name, 'echo')
  await client.request('thread/fork', { threadId: 'thread' })
  client.handleLine(
    JSON.stringify({ id: 20, method: 'currentTime/read', params: { threadId: 'thread' } })
  )
  assert.deepEqual(output.pop(), { id: 20, result: { currentTimeAt: 1792234567 } })
  client.handleLine(
    JSON.stringify({
      id: 21,
      method: 'item/tool/call',
      params: { threadId: 'fork', turnId: 'turn', callId: 'call', tool: 'echo', arguments: {} }
    })
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(output.pop(), {
    id: 21,
    result: { success: true, contentItems: [{ type: 'inputText', text: 'executed' }] }
  })
  client.handleLine(JSON.stringify({ id: 22, method: 'unknown/method', params: {} }))
  assert.equal(output.pop().error.code, -32601)
})

test('read-only turns block dynamic tools, including inherited forks', async () => {
  const tools = new CodexDynamicTools()
  let executed = false
  tools.register(
    { type: 'function', name: 'control', description: 'Fixture', inputSchema: { type: 'object' } },
    () => {
      executed = true
      return { success: true, contentItems: [] }
    }
  )
  tools.bind('thread', tools.specs)
  tools.setReadOnly('thread', true)
  tools.inherit('fork', 'thread')
  const call = { threadId: 'fork', turnId: 'turn', callId: 'call', tool: 'control', arguments: {} }
  assert.equal((await tools.call(call)).success, false)
  assert.equal(executed, false)
  tools.setReadOnly('fork', false)
  assert.equal((await tools.call(call)).success, true)
})

test('native verification cancellation targets the original RPC request ID', async () => {
  const source = ts.createSourceFile(
    'CodexAppServerClient.ts',
    readFileSync(new URL('./CodexAppServerClient.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const declaration = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === 'CodexAppServerClient'
  )
  const names = ['sendRequest', 'pendingRequests', 'nextRequestId']
  const client = vm.runInNewContext(
    ts.transpile(
      `class Harness {${declaration.members
        .filter((node) => names.includes(node.name?.getText(source)))
        .map((node) => node.getText(source))
        .join('\n')}};new Harness()`,
      { target: ts.ScriptTarget.ES2022 }
    ),
    { setTimeout, clearTimeout, requestTimeoutMs: 1000, console }
  )
  const output = []
  client.write = (message) => {
    output.push(message)
    if (message.method === 'userVerification/cancel')
      queueMicrotask(() => {
        const pending = client.pendingRequests.get(message.id)
        clearTimeout(pending.timeout)
        pending.resolve({})
        client.pendingRequests.delete(message.id)
      })
  }
  const controller = new AbortController()
  const pending = client.sendRequest(
    'userVerification/verify',
    { challenge: 'challenge' },
    { signal: controller.signal }
  )
  controller.abort()
  await assert.rejects(pending, /canceled/)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(output[1].method, 'userVerification/cancel')
  assert.equal(output[1].params.requestId, output[0].id)
  assert.equal(client.pendingRequests.size, 0)
})
