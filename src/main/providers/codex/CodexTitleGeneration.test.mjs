import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { isTransientNetworkFailure } from '../ProviderNetworkRetry.ts'

const source = ts.createSourceFile(
  'CodexProviderAdapter.ts',
  readFileSync(new URL('./CodexProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === 'CodexProviderAdapter'
)
const constants = new Set([
  'titleGenerationAttempts',
  'titleGenerationRetryDelayMs',
  'isRetryableTitleGenerationFailure'
])
const code = ts.transpile(
  `${source.statements
    .filter(
      (node) =>
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.some((item) => constants.has(item.name.getText(source)))
    )
    .map((node) => node.getText(source))
    .join('\n')}
  class Adapter { ${declaration.members
    .filter((node) =>
      ['generateAndSetThreadTitle', 'setThreadNameIfUntitled'].includes(node.name?.getText(source))
    )
    .map((node) => node.getText(source))
    .join('\n')} }; new Adapter()`,
  { target: ts.ScriptTarget.ES2022 }
)

const fixture = () => {
  const delays = []
  const names = []
  const updates = []
  const adapter = vm.runInNewContext(code, {
    Error,
    isTransientNetworkFailure,
    getThreadName: (thread) => thread.name,
    normalizeGeneratedTitle: (title) => title.trim() || null,
    console: { warn() {} },
    setTimeout: (resolve, delay) => {
      delays.push(delay)
      resolve()
    }
  })
  Object.assign(adapter, {
    threads: new Map([['chat', { name: null }]]),
    client: {
      request: async (method, params) => {
        assert.equal(method, 'thread/name/set')
        names.push(params.name)
      }
    },
    commitThreadAction: (id, action) => {
      adapter.threads.get(id).name = action.name
    },
    emitChatUpdated: (id) => updates.push(id)
  })
  return { adapter, delays, names, updates }
}

for (const message of [
  'thread title generation failed: Selected model is at capacity. Please try a different model.',
  'thread title generation failed: serverOverloaded',
  'fetch failed',
  'Timed out waiting for thread title generation'
]) {
  test(`retries temporary title failure: ${message}`, async () => {
    const { adapter, delays, names, updates } = fixture()
    let attempts = 0
    adapter.generateThreadTitle = async (prompt, cwd) => {
      assert.equal(prompt, 'Clone Firefox for benchmarks')
      assert.equal(cwd, '/home/user')
      if (++attempts === 1) throw new Error(message)
      return 'Benchmark Firefox downloads'
    }
    await adapter.generateAndSetThreadTitle('chat', 'Clone Firefox for benchmarks', '/home/user')
    assert.equal(attempts, 2)
    assert.deepEqual(delays, [2000])
    assert.deepEqual(names, ['Benchmark Firefox downloads'])
    assert.deepEqual(updates, ['chat'])
  })
}

test('stops after three failed attempts with increasing backoff', async () => {
  const { adapter, delays, names } = fixture()
  let attempts = 0
  adapter.generateThreadTitle = async () => {
    attempts++
    throw new Error('Selected model is at capacity')
  }
  await adapter.generateAndSetThreadTitle('chat', 'Prompt', null)
  assert.equal(attempts, 3)
  assert.deepEqual(delays, [2000, 4000])
  assert.deepEqual(names, [])
})

for (const message of [
  'Authentication required',
  'Usage limit exceeded',
  '429 rate limit exceeded',
  'Invalid model',
  'Invalid output schema'
]) {
  test(`does not retry permanent failure: ${message}`, async () => {
    const { adapter, delays } = fixture()
    let attempts = 0
    adapter.generateThreadTitle = async () => {
      attempts++
      throw new Error(message)
    }
    await adapter.generateAndSetThreadTitle('chat', 'Prompt', null)
    assert.equal(attempts, 1)
    assert.deepEqual(delays, [])
  })
}

for (const change of ['rename', 'remove']) {
  test(`stops retrying when the chat changes during backoff: ${change}`, async () => {
    const { adapter, names } = fixture()
    let attempts = 0
    adapter.generateThreadTitle = async () => {
      attempts++
      // Complete this change in a microtask before the next attempt starts.
      queueMicrotask(() => {
        if (change === 'rename') adapter.threads.get('chat').name = 'My title'
        else adapter.threads.clear()
      })
      throw new Error('Selected model is at capacity')
    }
    await adapter.generateAndSetThreadTitle('chat', 'Prompt', null)
    assert.equal(attempts, 1)
    assert.deepEqual(names, [])
  })

  test(`does not save a generated title after an in-flight ${change}`, async () => {
    const { adapter, names } = fixture()
    adapter.generateThreadTitle = async () => {
      if (change === 'rename') adapter.threads.get('chat').name = 'My title'
      else adapter.threads.clear()
      return 'Generated title'
    }
    await adapter.generateAndSetThreadTitle('chat', 'Prompt', null)
    assert.deepEqual(names, [])
  })
}

test('does not repeat generation when persisting the name fails', async () => {
  const { adapter, delays } = fixture()
  let attempts = 0
  adapter.generateThreadTitle = async () => {
    attempts++
    return 'Generated title'
  }
  adapter.client.request = async () => {
    throw new Error('fetch failed')
  }
  await assert.rejects(adapter.generateAndSetThreadTitle('chat', 'Prompt', null), /fetch failed/)
  assert.equal(attempts, 1)
  assert.deepEqual(delays, [])
})
