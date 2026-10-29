import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createOpenCodeV2Client,
  fromOpenCodeV2Session,
  readOpenCodeChatPreview,
  fromOpenCodeV2Message,
  toOpenCodeV2Permissions
} from './OpenCodeV2Client.ts'
import { isOpenCodeCredentialError, selectOpenCodeCheckModel } from './OpenCodeCredentialHealth.ts'
import { applyOpenCodeMessageEvent } from './OpenCodeEvents.ts'
import { isOpenCodeAbortError } from './OpenCodeItemRenderers.ts'
import {
  connectOpenCode,
  listOpenCodeConnections,
  getOpenCodeConnectionAttempt,
  completeOpenCodeConnection,
  cancelOpenCodeConnection,
  deleteOpenCodeConnection
} from './OpenCodeConnections.ts'

const tokens = { input: 11, output: 7, reasoning: 3, cache: { read: 5, write: 2 } }
const session = {
  id: 'ses_fixture',
  projectID: 'project',
  agent: 'build',
  model: { id: 'model', providerID: 'fixture' },
  title: 'Saved chat',
  location: { directory: '/fixture' },
  time: { created: 10, updated: 20 },
  cost: 1,
  tokens
}
const assistant = {
  id: 'msg_assistant',
  type: 'assistant',
  time: { created: 12, completed: 18 },
  agent: 'build',
  model: session.model,
  finish: 'stop',
  cost: 0.25,
  tokens,
  content: [{ type: 'text', text: 'Final answer' }]
}
const user = { id: 'msg_user', type: 'user', time: { created: 11 }, text: 'Question' }

function transport(handler) {
  const calls = []
  const client = createOpenCodeV2Client({
    baseUrl: 'http://fixture.test',
    fetch: async (url, init) => {
      const request = new Request(url, init)
      const body =
        request.method === 'GET' ? undefined : await request.json().catch(() => undefined)
      const call = {
        path: new URL(request.url).pathname,
        search: new URL(request.url).searchParams,
        method: request.method,
        body
      }
      calls.push(call)
      return handler(call, request)
    }
  })
  return { client, calls }
}
const json = (data) => Response.json(data)

test('v2 session creation translates both model shapes and preserves explicit access boundaries', async () => {
  const f = transport(() => json({ data: session }))
  await f.client.session.create({
    directory: '/fixture',
    model: { providerID: 'fixture', id: 'model', variant: 'high' },
    permission: [
      { permission: 'bash', pattern: 'git push *', action: 'ask' },
      { permission: 'external_directory', pattern: '*', action: 'deny' }
    ]
  })
  assert.equal(f.calls[0].path, '/api/session')
  assert.deepEqual(f.calls[0].body.model, { providerID: 'fixture', id: 'model', variant: 'high' })
  assert.deepEqual(f.calls[0].body.permissions, [
    { action: 'shell', resource: 'git push *', effect: 'ask' },
    { action: 'external_directory', resource: '*', effect: 'deny' }
  ])
  assert.deepEqual(
    toOpenCodeV2Permissions([{ permission: 'task', pattern: '*', action: 'deny' }]),
    [{ action: 'subagent', resource: '*', effect: 'deny' }]
  )
})

test('v2 model pricing tiers map to the catalog consumed by Sele', async () => {
  const pricing = { input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }
  const model = {
    id: 'model',
    providerID: 'fixture',
    modelID: 'model',
    name: 'Fixture',
    enabled: true,
    capabilities: { tools: true, input: ['text', 'image'], output: ['text'], temperature: true },
    cost: [pricing, { ...pricing, tier: { type: 'context', size: 200000 } }],
    variants: [{ id: 'high', settings: {} }],
    limit: { context: 400000, output: 1000 }
  }
  const f = transport((call) => {
    if (call.path === '/api/provider')
      return json({
        location: session.location,
        data: [{ id: 'fixture', name: 'Fixture', activation: 'enabled' }]
      })
    if (call.path === '/api/model') return json({ location: session.location, data: [model] })
    if (call.path === '/api/model/default') return json({ location: session.location, data: model })
    if (call.path === '/api/integration') return json({ location: session.location, data: [] })
    throw Error(call.path)
  })
  const result = (await f.client.config.providers({})).data
  assert.equal(result.providers[0].models.model.cost.cache.read, 0.1)
  assert.equal(result.providers[0].models.model.cost.tiers[0].tier.size, 200000)
  assert.deepEqual(result.providers[0].models.model.variants, { high: {} })
  assert.equal(result.providers[0].models.model.capabilities.input.image, true)
  assert.equal(
    selectOpenCodeCheckModel(result.providers[0]),
    'model',
    'native modality arrays must remain usable by connection verification'
  )
})

test('structural v2 records do not shrink visible history and cursor queries keep their original filters', async () => {
  let pages = 0
  const f = transport((call) => {
    if (call.path.endsWith('/inbox')) return json({ data: [] })
    if (call.path.endsWith('/message')) {
      pages++
      if (call.search.has('cursor')) assert.equal(call.search.has('order'), false)
      return pages === 1
        ? json({
            data: [
              { id: 'idle', type: 'idle', time: { created: 20 }, outcome: 'succeeded' },
              assistant
            ],
            cursor: { next: 'older' }
          })
        : json({ data: [user], cursor: {} })
    }
    return json({ data: session })
  })
  const records = (await f.client.session.messages({ sessionID: session.id, limit: 2 })).data
  assert.equal(pages, 2)
  assert.deepEqual(
    records.map((record) => record.info.role),
    ['user', 'assistant']
  )
})

test('v2 compaction summaries remain markers and pending imported exchanges keep their visible roles', async () => {
  const compact = fromOpenCodeV2Message(
    {
      id: 'summary',
      type: 'compaction',
      status: 'completed',
      reason: 'manual',
      time: { created: 20 },
      summary: 'Private summary',
      model: session.model,
      tokens,
      cost: 0.1
    },
    session,
    user.id
  )
  assert.equal(compact.info.summary, true)
  assert.equal(compact.parts[0].type, 'compaction')
  assert.ok(!JSON.stringify(compact).includes('Private summary'))
  const imported = fromOpenCodeV2Message(
    {
      id: 'imported',
      type: 'synthetic',
      time: { created: 21 },
      text: 'Imported assistant response: answer',
      metadata: { seleImport: { role: 'assistant', content: 'answer' } }
    },
    session,
    user.id
  )
  assert.equal(imported.info.role, 'assistant')
  assert.equal(imported.parts[0].text, 'answer')
})

test('v2 history keeps server pagination, usage, reasoning, tools, and image attachments', async () => {
  const f = transport((call) =>
    call.path.endsWith('/inbox')
      ? json({ data: [] })
      : call.path.endsWith('/message')
        ? json({ data: [assistant, user], cursor: { next: 'opaque-older' } })
        : json({ data: session })
  )
  const response = await f.client.session.messages({
    sessionID: session.id,
    directory: '/fixture',
    limit: 2,
    before: 'opaque-newer'
  })
  assert.equal(response.response.headers.get('x-next-cursor'), 'opaque-older')
  assert.equal(f.calls.at(-1).search.get('cursor'), 'opaque-newer')
  assert.deepEqual(
    response.data.map((record) => record.info.role),
    ['user', 'assistant']
  )
  assert.equal(response.data[1].info.parentID, user.id)
  assert.deepEqual(response.data[1].info.tokens, tokens)
  const record = fromOpenCodeV2Message(
    {
      ...assistant,
      content: [
        { type: 'reasoning', text: 'Reasoning' },
        {
          type: 'tool',
          id: 'call_browser',
          name: 'sele_browser_computer',
          time: { created: 12, ran: 13, completed: 14 },
          state: {
            status: 'completed',
            input: { action: 'screenshot' },
            metadata: { title: 'Screenshot' },
            content: [
              { type: 'text', text: 'Captured' },
              { type: 'file', mime: 'image/png', uri: 'data:image/png;base64,fixture' }
            ]
          }
        }
      ]
    },
    session,
    user.id
  )
  assert.equal(record.parts[0].type, 'reasoning')
  assert.equal(record.parts[1].state.output, 'Captured')
  assert.equal(record.parts[1].state.attachments[0].url, 'data:image/png;base64,fixture')
})

test('v2 permission replies retain their owning session and questions use native form IDs', async () => {
  const f = transport((call) => {
    if (call.path === '/api/permission/request')
      return json({
        location: session.location,
        data: [
          {
            id: 'permission',
            sessionID: session.id,
            action: 'shell',
            resources: ['git push'],
            metadata: { command: 'git push' }
          }
        ]
      })
    if (call.path === '/api/form')
      return json({
        location: session.location,
        data: [
          {
            id: 'form',
            sessionID: session.id,
            title: 'Select branch',
            fields: [
              {
                key: 'branch',
                type: 'string',
                title: 'Branch',
                options: [{ value: 'main', label: 'Main' }]
              }
            ]
          }
        ]
      })
    return new Response(null, { status: 204 })
  })
  const permissions = (await f.client.permission.list({ directory: '/fixture' })).data
  assert.equal(permissions[0].permission, 'bash')
  await f.client.permission.reply({ requestID: 'permission', reply: 'once' })
  assert.ok(
    f.calls.some((call) => call.path.includes(session.id) && call.body?.decision === 'once')
  )
  const questions = (await f.client.question.list({ directory: '/fixture' })).data
  assert.equal(questions[0].questions[0].options[0].label, 'Main')
  await f.client.question.reply({ requestID: 'form', answers: [['Main']] })
  assert.deepEqual(f.calls.at(-1).body, { answer: { branch: 'main' } })
})

test('v2 connections use native integration and credential identities without legacy-file reads', async () => {
  const f = transport((call) => {
    if (call.path === '/api/provider')
      return json({
        location: session.location,
        data: [
          {
            id: 'fixture',
            name: 'Fixture',
            activation: 'enabled',
            package: 'fixture',
            integrationID: 'integration'
          }
        ]
      })
    if (call.path === '/api/provider/fixture')
      return json({
        location: session.location,
        data: { id: 'fixture', name: 'Fixture', integrationID: 'integration' }
      })
    if (call.path === '/api/integration')
      return json({
        location: session.location,
        data: [
          {
            id: 'integration',
            name: 'Fixture',
            methods: [
              { type: 'key', label: 'Key' },
              { type: 'oauth', id: 'browser', label: 'Browser' }
            ],
            connections: [
              { type: 'credential', id: 'credential_uuid', label: 'Work', method: 'key' }
            ]
          }
        ]
      })
    if (call.path.endsWith('/connect/oauth'))
      return json({
        location: session.location,
        data: {
          attemptID: 'attempt',
          mode: 'code',
          url: 'https://fixture.test/authorize',
          instructions: 'Authorize',
          time: { created: 1, expires: 2 }
        }
      })
    if (call.method === 'GET' && call.path.endsWith('/oauth/attempt'))
      return json({
        location: session.location,
        data: { status: 'complete', time: { created: 1, expires: 2 } }
      })
    return new Response(null, { status: 204 })
  })
  const connections = await listOpenCodeConnections(f.client, async () => {
    throw Error('v1 auth.json must not be used')
  })
  assert.equal(connections[0].connections[0].id, 'credential_uuid')
  await connectOpenCode(f.client, {
    integrationId: 'fixture',
    method: 'key',
    key: 'dummy-fixture-key'
  })
  assert.ok(
    f.calls.some(
      (call) => call.body?.key === 'dummy-fixture-key' && call.path.includes('integration')
    )
  )
  const attempt = await connectOpenCode(f.client, {
    integrationId: 'fixture',
    method: 'oauth',
    methodId: 'browser'
  })
  assert.equal(attempt.attemptId, 'attempt')
  await completeOpenCodeConnection(f.client, 'attempt', 'fixture-code')
  assert.ok(f.calls.some((call) => call.body?.code === 'fixture-code'))
  await cancelOpenCodeConnection(f.client, 'attempt')
  await deleteOpenCodeConnection(f.client, 'credential_uuid')
  assert.ok(f.calls.at(-1).path.includes('credential_uuid'))
  assert.equal(f.calls.at(-1).method, 'DELETE')
})

test('v2 text deltas project into the existing transcript in order without history reads per token', async () => {
  const controller = new AbortController()
  const steps = [
    { type: 'session.execution.started', data: { sessionID: session.id } },
    {
      type: 'session.step.started',
      data: {
        sessionID: session.id,
        assistantMessageID: assistant.id,
        agent: 'build',
        model: session.model,
        started: 12
      }
    },
    {
      type: 'session.text.started',
      data: { sessionID: session.id, assistantMessageID: assistant.id, ordinal: 0 }
    },
    {
      type: 'session.text.delta',
      data: { sessionID: session.id, assistantMessageID: assistant.id, ordinal: 0, delta: 'Hello ' }
    },
    {
      type: 'session.text.delta',
      data: { sessionID: session.id, assistantMessageID: assistant.id, ordinal: 0, delta: 'world' }
    },
    {
      type: 'session.text.ended',
      data: {
        sessionID: session.id,
        assistantMessageID: assistant.id,
        ordinal: 0,
        text: 'Hello world'
      }
    },
    { type: 'session.execution.succeeded', data: { sessionID: session.id } },
    { type: 'session.idle', data: { sessionID: session.id } },
    { type: 'session.deleted', data: { sessionID: session.id } }
  ]
  const f = transport((call) =>
    call.path === '/api/event'
      ? new Response(
          new ReadableStream({
            start(stream) {
              for (const [index, event] of steps.entries())
                stream.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify({ id: String(index), created: 12, location: session.location, ...event })}\n\n`
                  )
                )
            }
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        )
      : json({ data: session })
  )
  let records = []
  let completions = 0
  const stream = await f.client.global.event({ signal: controller.signal })
  try {
    for await (const event of stream.stream) {
      const { type, properties } = event.payload
      records = applyOpenCodeMessageEvent(records, type, properties) ?? records
      if (type === 'session.idle') completions++
      if (type === 'session.deleted') break
    }
  } finally {
    controller.abort()
  }
  assert.equal(records[0].parts[0].text, 'Hello world')
  assert.equal(completions, 1, 'native completion drains once even if a compatibility idle follows')
  assert.equal(f.calls.filter((call) => call.path.includes('/message')).length, 0)
})

test('empty saved assistant records do not consume the visible history budget', async () => {
  let reads = 0
  const empty = Array.from({ length: 4 }, (_, i) => [
    { ...user, id: `user-${i}`, time: { created: 30 + i * 2 } },
    {
      ...assistant,
      id: `empty-${i}`,
      time: { created: 31 + i * 2, completed: 31 + i * 2 },
      content: []
    }
  ]).flat()
  const f = transport((call) => {
    if (call.path.endsWith('/inbox')) return json({ data: [] })
    if (call.path.endsWith('/message')) {
      reads++
      return reads === 1
        ? json({ data: [...empty].reverse(), cursor: { next: 'older' } })
        : json({ data: [assistant, user], cursor: {} })
    }
    return json({ data: session })
  })
  const history = (await f.client.session.messages({ sessionID: session.id, limit: 8 })).data
  assert.equal(reads, 2)
  assert.ok(
    history.some((record) =>
      record.parts.some((part) => part.type === 'text' && part.text === 'Final answer')
    )
  )
  assert.equal(
    history.filter((record) => record.info.role === 'user').length,
    5,
    'saved prompts are retained'
  )
})

test('sidebar previews query one user record and reuse it until the session changes', async () => {
  let reads = 0
  const f = transport((call) => {
    assert.equal(call.path, `/api/session/${session.id}/message`)
    assert.equal(call.search.get('type'), 'user', 'sidebar discovery must not fetch tool output')
    assert.equal(call.search.get('limit'), '1')
    reads++
    return json({ data: [user], cursor: { next: 'older' } })
  })
  const saved = fromOpenCodeV2Session(session)
  const [first, second] = await Promise.all([
    readOpenCodeChatPreview(f.client, saved),
    readOpenCodeChatPreview(f.client, saved)
  ])
  assert.equal(reads, 1)
  assert.equal(first, second)
  assert.equal(first.hasOlder, true)
  assert.equal(first.messages[0].info.role, 'user')
  await readOpenCodeChatPreview(f.client, { ...saved, time: { ...saved.time, updated: 99 } })
  assert.equal(reads, 2)
})

test('native errors retain HTTP status and free-limit retry information for connection checks', () => {
  const failed = fromOpenCodeV2Message(
    {
      ...assistant,
      error: {
        type: 'provider.authentication',
        message: 'Expired key',
        status: 401,
        response: { body: '{"error":{"type":"authentication_error"}}' }
      }
    },
    session
  )
  assert.equal(isOpenCodeCredentialError(failed.info.error), true)
  const limited = fromOpenCodeV2Message(
    {
      ...assistant,
      error: {
        type: 'provider.free-limit',
        message: 'Free usage limit reached',
        status: 429,
        retryAfterMs: 60000
      }
    },
    session
  )
  assert.equal(isOpenCodeCredentialError(limited.info.error), false)
  assert.equal(limited.info.error.data.statusCode, 429)
  assert.equal(limited.info.error.type, 'provider.free-limit')
  assert.equal(limited.info.error.retryAfterMs, 60000)
})

test('saved native interruptions remain stopped after reopening the conversation', () => {
  const record = fromOpenCodeV2Message(
    { ...assistant, error: { type: 'aborted', message: 'Step interrupted' } },
    session,
    user.id
  )
  assert.equal(isOpenCodeAbortError(record.info.error), true)
  assert.equal(record.info.error.type, 'aborted')
})
