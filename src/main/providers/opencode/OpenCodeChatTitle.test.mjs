import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import {
  generateOpenCodeChatTitle,
  isDefaultOpenCodeTitle,
  selectOpenCodeTitleModels
} from './OpenCodeChatTitle.ts'
import { getOpenCodeDisplayTitle } from './OpenCodeItemRenderers.ts'

const defaultTitle = 'New session - 2026-10-14T12:00:00.000Z'
const model = (id, cost = 0, overrides = {}) => ({
  id,
  status: 'active',
  capabilities: { input: { text: true }, output: { text: true } },
  cost: { input: cost, output: cost, cache: { read: 0, write: 0 } },
  ...overrides
})
const provider = (id, models) => ({ id, models: Object.fromEntries(models.map((m) => [m.id, m])) })
const catalog = [
  provider('connected', [
    model('paid', 1),
    model('free'),
    model('other-free'),
    model('retired', 0, { status: 'deprecated' }),
    model('image', 0, { capabilities: { input: { text: true }, output: { text: false } } })
  ]),
  provider('offline', [model('free')])
]

test('uses available preferences, then free models; skips retired and disconnected models', () => {
  assert.deepEqual(
    selectOpenCodeTitleModels(catalog, ['connected'], 'connected/paid', 'connected/free'),
    ['connected/paid', 'connected/free', 'connected/other-free']
  )
  assert.deepEqual(
    selectOpenCodeTitleModels(catalog, ['connected'], 'connected/missing', 'connected/retired'),
    ['connected/free', 'connected/other-free']
  )
  assert.deepEqual(selectOpenCodeTitleModels(catalog, [], 'connected/paid', undefined), [])
  assert.deepEqual(selectOpenCodeTitleModels(catalog, ['connected'], 'offline/free', undefined), [
    'connected/free',
    'connected/other-free'
  ])
})

test('deduplicates candidates and caps recovery at three models', () => {
  const providers = [
    provider(
      'p',
      ['a', 'b', 'c', 'd'].map((id) => model(id))
    )
  ]
  assert.deepEqual(selectOpenCodeTitleModels(providers, ['p'], 'p/b', 'p/b'), ['p/b', 'p/a', 'p/c'])
})

test('only default titles use message previews', () => {
  const messages = [{ info: { role: 'user' }, parts: [{ type: 'text', text: 'First message' }] }]
  assert.equal(isDefaultOpenCodeTitle(defaultTitle), true)
  assert.equal(getOpenCodeDisplayTitle(defaultTitle, messages), 'First message')
  assert.equal(getOpenCodeDisplayTitle('Generated title', messages), 'Generated title')
  assert.equal(isDefaultOpenCodeTitle('My custom name'), false)
})

const transport = (responses) => {
  const calls = { created: [], prompted: [], aborted: [], deleted: [], usage: [] }
  const client = {
    session: {
      create: async (args, options) => {
        assert.ok(options.signal instanceof AbortSignal)
        calls.created.push(args)
        return { data: { id: `temporary-${calls.created.length}` } }
      },
      prompt: async (args, options) => {
        assert.ok(options.signal instanceof AbortSignal)
        calls.prompted.push(args)
        const response = responses.shift()
        if (response instanceof Error) throw response
        return { data: response }
      },
      abort: async ({ sessionID }) => {
        calls.aborted.push(sessionID)
      },
      delete: async ({ sessionID }) => {
        calls.deleted.push(sessionID)
      }
    }
  }
  return { client, calls }
}
const answer = (text) => ({ info: { role: 'assistant' }, parts: [{ type: 'text', text }] })

test('retries rejected and empty responses, reports usage, and removes all temporary sessions', async (t) => {
  const errors = t.mock.method(console, 'error', () => {})
  const { client, calls } = transport([
    new Error('No billing access'),
    answer(''),
    answer('Title: "Library organization"')
  ])
  const title = await generateOpenCodeChatTitle(
    client,
    '/project',
    'Organize books',
    ['p/paid', 'p/free', 'p/next-free'],
    () => true,
    (...args) => calls.usage.push(args)
  )
  assert.equal(title, 'Library organization')
  assert.deepEqual(
    calls.prompted.map((p) => p.model.modelID),
    ['paid', 'free', 'next-free']
  )
  assert.equal(errors.mock.callCount(), 2)
  assert.equal(calls.usage.length, 2)
  assert.deepEqual(calls.deleted, ['temporary-1', 'temporary-2', 'temporary-3'])
  assert.deepEqual(calls.aborted, calls.deleted)
  for (const created of calls.created) {
    assert.equal(created.metadata.sele.purpose, 'oneShot')
    assert.deepEqual(created.permission, [{ permission: '*', pattern: '*', action: 'deny' }])
  }
})

test('retries model errors in successful HTTP responses and returns null after exhaustion', async (t) => {
  t.mock.method(console, 'error', () => {})
  const { client, calls } = transport([{ info: { error: { message: 'Rate limited' } }, parts: [] }])
  assert.equal(
    await generateOpenCodeChatTitle(
      client,
      '/project',
      'Prompt',
      ['p/model'],
      () => true,
      () => {}
    ),
    null
  )
  assert.deepEqual(calls.deleted, ['temporary-1'])
})

test('cancellation after session creation prevents generation and still cleans up', async () => {
  const { client, calls } = transport([])
  let checks = 0
  assert.equal(
    await generateOpenCodeChatTitle(
      client,
      '/project',
      'Prompt',
      ['p/model'],
      () => ++checks === 1,
      () => {}
    ),
    null
  )
  assert.equal(calls.prompted.length, 0)
  assert.deepEqual(calls.deleted, ['temporary-1'])
})

// Execute actual adapter methods with only the network and title model mocked.
const adapterHarness = (generate, config = {}) => {
  const source = ts.createSourceFile(
    'OpenCodeProviderAdapter.ts',
    readFileSync(new URL('./OpenCodeProviderAdapter.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const declaration = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name.text === 'OpenCodeProviderAdapter'
  )
  const selected = new Set(['recoverChatTitle', 'setChatTitle', 'completeTurn'])
  const code = ts.transpileModule(
    `class Harness { ${declaration.members
      .filter((member) => selected.has(member.name?.getText(source)))
      .map((member) => member.getText(source))
      .join('\n')}
  }; globalThis.Harness = Harness`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
  ).outputText
  const context = vm.createContext({
    AbortSignal,
    setTimeout,
    updateDelayMs: 0,
    console,
    isDefaultOpenCodeTitle,
    selectOpenCodeTitleModels,
    generateOpenCodeChatTitle: generate,
    requireData: (result) => result.data
  })
  vm.runInContext(code, context)
  const state = {
    id: 'chat',
    directory: '/project',
    session: { title: defaultTitle },
    messages: [
      {
        info: { role: 'user', model: { providerID: 'connected', modelID: 'free' } },
        parts: [{ type: 'text', text: 'First prompt' }]
      }
    ]
  }
  let persisted = { ...state.session }
  const writes = []
  const client = {
    provider: { list: async () => ({ data: { all: catalog, connected: ['connected'] } }) },
    config: { get: async () => ({ data: config }) },
    session: {
      get: async () => ({ data: persisted }),
      update: async ({ title }) => {
        writes.push(title)
        persisted = { title }
        return { data: persisted }
      }
    }
  }
  const adapter = Object.assign(new context.Harness(), {
    states: new Map([['chat', state]]),
    titleGenerations: new WeakSet(),
    manualTitles: new WeakSet(),
    titleWrites: new WeakMap(),
    completionCoordinator: {
      complete: async (_, callbacks) => {
        await callbacks.reconcile()
        await callbacks.publishReconciled()
        return true
      }
    },
    refreshState: async () => {},
    emitUpdateNow: async () => {},
    reportMessageTokenUsage: () => {},
    scheduleUpdate: () => {},
    ensureState: async () => state,
    getClientEntry: async () => ({ client }),
    createChatDetail: async () => state.session
  })
  const settle = async () => {
    for (let i = 0; i < 100 && adapter.titleGenerations.has(state); i++)
      await new Promise(setImmediate)
    assert.equal(adapter.titleGenerations.has(state), false)
  }
  return { adapter, state, client, writes, settle }
}

test('completed turns start recovery without waiting for the title model', async () => {
  let resolve
  const h = adapterHarness(
    () =>
      new Promise((r) => {
        resolve = r
      })
  )
  assert.equal(await h.adapter.completeTurn(h.state), true)
  assert.equal(h.adapter.titleGenerations.has(h.state), true)
  await new Promise(setImmediate)
  resolve('Recovered title')
  await h.settle()
  assert.deepEqual(h.writes, ['Recovered title'])
})

test('adapter recovers a default name once and persists the generated title', async () => {
  let calls = 0
  const h = adapterHarness(async () => {
    calls++
    return 'Generated title'
  })
  h.adapter.recoverChatTitle(h.state, h.client)
  h.adapter.recoverChatTitle(h.state, h.client)
  await h.settle()
  assert.equal(calls, 1)
  assert.deepEqual(h.writes, ['Generated title'])
  h.adapter.recoverChatTitle(h.state, h.client)
  assert.equal(calls, 1)
})

test('manual rename while generation is pending wins', async () => {
  let resolve
  const h = adapterHarness(
    () =>
      new Promise((r) => {
        resolve = r
      })
  )
  h.adapter.recoverChatTitle(h.state, h.client)
  await new Promise(setImmediate)
  await h.adapter.setChatTitle('chat', 'My name')
  resolve('Generated title')
  await h.settle()
  assert.deepEqual(h.writes, ['My name'])
})

test('manual rename waits for an automatic write already in flight, then wins', async () => {
  const h = adapterHarness(async () => 'Automatic title')
  const update = h.client.session.update
  let resolve
  h.client.session.update = async (args) => {
    if (args.title === 'Automatic title')
      await new Promise((r) => {
        resolve = r
      })
    return update(args)
  }
  h.adapter.recoverChatTitle(h.state, h.client)
  await new Promise(setImmediate)
  const rename = h.adapter.setChatTitle('chat', 'My name')
  await new Promise(setImmediate)
  resolve()
  await rename
  await h.settle()
  assert.deepEqual(h.writes, ['Automatic title', 'My name'])
  assert.equal(h.state.session.title, 'My name')
})

test('preserves native titles and skips disabled generation and subagent chats', async () => {
  const native = adapterHarness(async () => 'Fallback title')
  native.client.session.get = async () => ({ data: { title: 'Native title' } })
  native.adapter.recoverChatTitle(native.state, native.client)
  await native.settle()
  assert.deepEqual(native.writes, [])
  const disabled = adapterHarness(() => assert.fail('disabled'), {
    agent: { title: { disable: true } }
  })
  disabled.adapter.recoverChatTitle(disabled.state, disabled.client)
  await disabled.settle()
  const child = adapterHarness(() => assert.fail('subagent'))
  child.state.session.parentID = 'parent'
  child.adapter.recoverChatTitle(child.state, child.client)
  await child.settle()
})
