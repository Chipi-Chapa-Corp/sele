import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { CodexTranscriptMetadataIndex } from './CodexTranscriptMetadataIndex.ts'

const source = ts.createSourceFile(
  'CodexProviderAdapter.ts',
  readFileSync(new URL('./CodexProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === 'CodexProviderAdapter'
)
const extract = (names, globals = {}) => {
  const members = declaration.members.filter((node) => names.includes(node.name?.getText(source)))
  return vm.runInNewContext(
    ts.transpile(
      `class Harness { ${members.map((node) => node.getText(source)).join('\n')} }; new Harness()`,
      {
        target: ts.ScriptTarget.ES2022
      }
    ),
    {
      Buffer,
      console,
      process,
      isCodexSubagentThread: () => false,
      rendererWorkingItemTailLimit: 10,
      rendererChatUpdateTurnLimit: 10,
      getContainerTargetKey: (container) => container?.id ?? 'host',
      isExpectedFileAbsenceError: (error) => error?.code === 'ENOENT',
      isExpectedCodexMetadataCapabilityError: (error) =>
        error?.code === 'ERR_UNSUPPORTED' || /method not found/i.test(error?.message ?? ''),
      CodexTranscriptMetadataIndex,
      ...globals
    }
  )
}

const goal = (turnId, text) =>
  [
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: turnId } }),
    JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'message',
        id: 'goal',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `<codex_internal_context source="goal">${text}</codex_internal_context>`
          }
        ]
      }
    })
  ].join('\n') + '\n'
const thread = (id = 'thread') => ({
  id,
  path: '/source/rollout.jsonl',
  turns: [
    {
      id: 'turn',
      status: 'inProgress',
      items: [{ id: 'answer', type: 'agentMessage', phase: 'final_answer' }]
    }
  ]
})
const setup = (globals, client) => {
  const adapter = extract(['loadTranscriptMetadata', 'loadTranscriptMetadataUnchecked'], globals)
  let applied = 0
  let metadata
  Object.assign(adapter, {
    transcriptMetadataGeneration: 0,
    transcriptMetadataIndex: new CodexTranscriptMetadataIndex(),
    transcriptRangeSupport: new Map(),
    transcriptMetadataStatSupport: new Map(),
    transcriptMetadataWarnings: new Set(),
    transcriptHostBridgeWarningShown: false,
    getThreadContainer: () => globals.container ?? null,
    getClient: () => client,
    goalPrompts: {
      shouldLoad: () => true,
      apply: (_thread, value) => {
        applied++
        metadata = value
        return Boolean(value.prompts.size)
      }
    },
    commandStartAnchors: { apply: () => false }
  })
  return { adapter, stats: () => ({ applied, metadata }) }
}

test('local source selection stays on the matching host and skips ordinary turns', async () => {
  let localCalls = 0
  const contents = Buffer.from(goal('turn', 'Local'))
  const { adapter, stats } = setup(
    {
      isRunningInFlatpak: () => false,
      getCurrentContainerHostBridge: async () => null,
      localTranscriptSource: (key, path, threadId) => {
        localCalls++
        assert.deepEqual([key, path, threadId], ['host', '/source/rollout.jsonl', 'thread'])
        return {
          key,
          path,
          threadId,
          stat: async () => ({ size: contents.length, modifiedAtMs: 1, identity: 'inode' }),
          read: async (offset, length) => contents.subarray(offset, offset + length)
        }
      }
    },
    { request: () => assert.fail('local rollout must not use app-server fs') }
  )
  assert.equal(await adapter.loadTranscriptMetadata(thread()), true)
  assert.equal(stats().metadata.prompts.get('turn').text, 'Local')
  assert.equal(localCalls, 1)
  adapter.goalPrompts.shouldLoad = () => false
  const ordinary = {
    ...thread(),
    turns: [{ id: 'user', items: [{ id: 'u', type: 'userMessage' }] }]
  }
  assert.equal(await adapter.loadTranscriptMetadata(ordinary), false)
  assert.equal(localCalls, 1)
})

test('remote command/exec reads bounded source ranges with argv paths', async () => {
  let contents = Buffer.from(goal('turn', 'Remote') + 'x'.repeat(300_000) + '\n')
  let modifiedAtMs = 1
  let readBytes = 0
  let fullReads = 0
  const client = {
    request: async (method, params) => {
      if (method === 'command/exec') {
        assert.equal(params.sandboxPolicy.type, 'readOnly')
        if (params.command[0] === 'stat') {
          assert.equal(params.command.at(-1), '/source/rollout.jsonl')
          return {
            exitCode: 0,
            stdout: `${contents.length}\n1\n1970-01-01 00:00:00.001000000 +0000\n7\n`
          }
        }
        assert.equal(params.command[0], 'sh')
        assert.equal(params.command[4], '/source/rollout.jsonl')
        const offset = Number(params.command[5])
        const length = Number(params.command[6])
        assert.ok(length <= 128 * 1024)
        const bytes = contents.subarray(offset, offset + length)
        readBytes += bytes.length
        return { exitCode: 0, stdout: bytes.toString('base64') }
      }
      if (method === 'fs/readFile') fullReads++
      assert.fail(`unexpected ${method}`)
    }
  }
  const { adapter, stats } = setup(
    {
      container: { id: 'ssh' },
      isRunningInFlatpak: () => false,
      getCurrentContainerHostBridge: async () => null
    },
    client
  )
  assert.equal(await adapter.loadTranscriptMetadata(thread()), true)
  const coldBytes = readBytes
  contents = Buffer.concat([contents, Buffer.from(goal('next', 'Appended'))])
  modifiedAtMs++
  assert.equal(await adapter.loadTranscriptMetadata(thread()), true)
  assert.equal(stats().metadata.prompts.get('next').text, 'Appended')
  assert.equal(fullReads, 0)
  assert.ok(readBytes - coldBytes < 2_000, `append read ${readBytes - coldBytes} bytes`)
  assert.equal(modifiedAtMs, 2)
})

test('unsupported ranged transport falls back to exact-source fs and caches unchanged content', async () => {
  const contents = Buffer.from(goal('turn', 'Fallback'))
  let fullReads = 0
  const client = {
    request: async (method, params) => {
      if (method === 'command/exec') throw new Error('Method not found')
      if (method === 'fs/getMetadata') return { modifiedAtMs: 2, createdAtMs: 1 }
      if (method === 'fs/readFile') {
        assert.equal(params.path, '/source/rollout.jsonl')
        fullReads++
        return { dataBase64: contents.toString('base64') }
      }
      assert.fail(method)
    }
  }
  const { adapter } = setup(
    {
      container: { id: 'ssh' },
      isRunningInFlatpak: () => false,
      getCurrentContainerHostBridge: async () => null
    },
    client
  )
  assert.equal(await adapter.loadTranscriptMetadata(thread()), true)
  assert.equal(await adapter.loadTranscriptMetadata(thread()), true)
  assert.equal(fullReads, 1)
  assert.equal(adapter.transcriptRangeSupport.get('ssh'), false)
})

test('host bridge uses the app-server source even without an explicit container target', async () => {
  let remoteReads = 0
  const client = {
    request: async (method) => {
    if (method === 'command/exec') throw new Error('Method not found')
      if (method === 'fs/getMetadata') return { modifiedAtMs: 1, createdAtMs: 1 }
      if (method === 'fs/readFile') {
        remoteReads++
        return { dataBase64: Buffer.from(goal('turn', 'Host rollout')).toString('base64') }
      }
      assert.fail(method)
    }
  }
  const { adapter } = setup(
    {
      isRunningInFlatpak: () => false,
      getCurrentContainerHostBridge: async () => ({ file: 'distrobox-host-exec' }),
      localTranscriptSource: () =>
        assert.fail('bridge source must not read a same-named local path')
    },
    client
  )
  assert.equal(await adapter.loadTranscriptMetadata(thread()), true)
  assert.equal(remoteReads, 1)
})

test('late optional loads do not apply after reset or republish a replaced source', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const { adapter, stats } = setup(
    {
      isRunningInFlatpak: () => false,
      getCurrentContainerHostBridge: async () => null,
      localTranscriptSource: () => ({
        key: 'host',
        path: '/source/rollout.jsonl',
        stat: async () => {
          await gate
          return { size: 0, modifiedAtMs: 1 }
        },
        read: async () => Buffer.alloc(0)
      })
    },
    { request: () => assert.fail('no remote request') }
  )
  const pending = adapter.loadTranscriptMetadata(thread())
  await Promise.resolve()
  adapter.transcriptMetadataGeneration++
  adapter.transcriptMetadataIndex.clear()
  release()
  assert.equal(await pending, false)
  assert.equal(stats().applied, 0)

  const published = []
  const live = extract(['emitChatUpdated'], { getContainerTargetKey: () => 'host' })
  const oldThread = thread()
  let finish
  Object.assign(live, {
    threads: new Map([['thread', oldThread]]),
    chatUpdatedListeners: new Set([() => published.push('initial')]),
    bumpThreadRevision: () => {},
    createChatDetail: () => ({}),
    getThreadContainer: () => null,
    loadTranscriptMetadata: () =>
      new Promise((resolve) => {
        finish = resolve
      }),
    scheduleChatUpdated: () => published.push('enriched')
  })
  live.emitChatUpdated('thread')
  live.threads.set('thread', { ...oldThread, path: '/different/rollout.jsonl' })
  finish(true)
  await Promise.resolve()
  assert.deepEqual(published, ['initial'])
})
