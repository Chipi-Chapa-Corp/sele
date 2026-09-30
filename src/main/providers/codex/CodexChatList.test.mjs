import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = ts.createSourceFile(
  'CodexProviderAdapter.ts',
  readFileSync(new URL('./CodexProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === 'CodexProviderAdapter'
)
const code = ts.transpile(
  `class Harness { ${declaration.members
    .filter((node) =>
      ['threadListScanClients', 'getChatsInContext'].includes(node.name?.getText(source))
    )
    .map((node) => node.getText(source))
    .join('\n')} }; new Harness()`,
  { target: ts.ScriptTarget.ES2022 }
)

const thread = (id) => ({
  id,
  preview: `Preview ${id}`,
  createdAt: 10,
  updatedAt: 20
})
const fixture = () => {
  const adapter = vm.runInNewContext(code, {
    isCodexSubagentThread: (value) => value.subagent,
    loadSessionThreadNames: async () => new Map(),
    getThreadTitle: (value) => value.id,
    getThreadApiCwd: () => '/repo',
    getThreadMetadataStatus: () => 'idle'
  })
  Object.assign(adapter, {
    id: 'codex',
    withResolvedThreadName: (value) => value,
    rememberThreadContainer: () => {},
    getProviderPendingApproval: () => null,
    getCurrentContainer: () => null
  })
  return adapter
}

test('sidebar pages load from the DB without entering the slow rollout scan', async () => {
  const adapter = fixture()
  const requests = []
  adapter.client = {
    request: async (method, params) => {
      requests.push({ method, ...params })
      if (!params.useStateDbOnly) throw new Error('rollout scan would time out')
      return params.cursor
        ? { data: [thread('second')], nextCursor: null }
        : { data: [thread('first'), { ...thread('child'), subagent: true }], nextCursor: 'next' }
    }
  }

  const first = await adapter.getChatsInContext({ limit: 2 })
  const second = await adapter.getChatsInContext({ cursor: first.nextCursor, limit: 2 })
  assert.deepEqual(
    Array.from(first.chats, (chat) => chat.id),
    ['first']
  )
  assert.deepEqual(
    Array.from(second.chats, (chat) => chat.id),
    ['second']
  )
  assert.equal(second.nextCursor, null)
  assert.deepEqual(
    requests.map((request) => request.cursor),
    [null, 'next']
  )
  assert.ok(requests.every((request) => request.method === 'thread/list' && request.limit === 2))
})

test('unindexed history falls back to scanning and preserves that mode across pages', async () => {
  const adapter = fixture()
  const modes = []
  adapter.client = {
    request: async (_method, params) => {
      modes.push(params.useStateDbOnly)
      if (params.useStateDbOnly) return { data: [], nextCursor: null }
      return params.cursor
        ? { data: [thread('older')], nextCursor: null }
        : { data: [thread('legacy')], nextCursor: 'scan-next' }
    }
  }

  const first = await adapter.getChatsInContext()
  const next = await adapter.getChatsInContext({ cursor: first.nextCursor })
  assert.deepEqual(
    Array.from(first.chats, (chat) => chat.id),
    ['legacy']
  )
  assert.deepEqual(
    Array.from(next.chats, (chat) => chat.id),
    ['older']
  )
  assert.deepEqual(modes, [true, undefined, false])

  // A different source or replacement app server must still use the fast listing mode.
  adapter.client = {
    request: async (_method, params) => {
      assert.equal(params.useStateDbOnly, true)
      return { data: [thread('other-source')], nextCursor: null }
    }
  }
  assert.equal((await adapter.getChatsInContext()).chats[0].id, 'other-source')
})

test('an empty final DB page does not restart the scan', async () => {
  const adapter = fixture()
  let requests = 0
  adapter.client = {
    request: async (_method, params) => {
      requests++
      assert.equal(params.cursor, 'last')
      assert.equal(params.useStateDbOnly, true)
      return { data: [], nextCursor: null }
    }
  }
  const page = await adapter.getChatsInContext({ cursor: 'last' })
  assert.equal(page.chats.length, 0)
  assert.equal(page.nextCursor, null)
  assert.equal(requests, 1)
})

test('a failed DB request remains visible without starting another expensive request', async () => {
  const adapter = fixture()
  let requests = 0
  adapter.client = {
    request: async () => {
      requests++
      throw new Error('Codex app-server stopped')
    }
  }
  await assert.rejects(adapter.getChatsInContext(), /Codex app-server stopped/)
  assert.equal(requests, 1)
})
