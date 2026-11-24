import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as linkedChatContext from './linkedChatContext.ts'
import {
  cleanClaudeCompactSummary,
  isLinkedChatContextCancelled,
  raceLinkedChatCancellation,
  summarizeLinkedChatWithFallback,
  watchLinkedChatForkTurn
} from './linkedChatContext.ts'
import { getClaudeLinkedChatSummary } from './claude/ClaudeLinkedChatSummary.ts'

const createUpdates = () => {
  const listeners = new Set()
  return {
    onChatUpdated: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit: (id, status) => listeners.forEach((listener) => listener({ id, status })),
    get size() {
      return listeners.size
    }
  }
}

test('waits for the tracked fork to become idle after its turn starts', async () => {
  const updates = createUpdates()
  const watcher = watchLinkedChatForkTurn(updates.onChatUpdated, new AbortController().signal)
  updates.emit('fork', 'active')
  watcher.track('fork')
  let finished = false
  const done = watcher.finished({ id: 'fork', status: 'active' }).then(() => {
    finished = true
  })
  updates.emit('other', null)
  await Promise.resolve()
  assert.equal(finished, false)
  updates.emit('fork', null)
  await done
  assert.equal(finished, true)
  watcher.dispose()
  assert.equal(updates.size, 0)
})

test('a turn that finished while the fork was being created resolves at once', async () => {
  const updates = createUpdates()
  const watcher = watchLinkedChatForkTurn(updates.onChatUpdated, new AbortController().signal)
  updates.emit('fork', 'active')
  updates.emit('fork', null)
  watcher.track('fork')
  await watcher.finished({ id: 'fork', status: null })
  watcher.dispose()
})

test('fails when the hidden fork waits for approval', async () => {
  const updates = createUpdates()
  const watcher = watchLinkedChatForkTurn(updates.onChatUpdated, new AbortController().signal)
  watcher.track('fork')
  const done = watcher.finished({ id: 'fork', status: 'active' })
  updates.emit('fork', 'waitingOnApproval')
  await assert.rejects(done, /waiting for approval or input/)
  watcher.dispose()
})

test('cancellation interrupts waiting and racing', async () => {
  const updates = createUpdates()
  const controller = new AbortController()
  const watcher = watchLinkedChatForkTurn(updates.onChatUpdated, controller.signal)
  watcher.track('fork')
  const done = watcher.finished({ id: 'fork', status: 'active' })
  const raced = raceLinkedChatCancellation(controller.signal, new Promise(() => {}))
  controller.abort()
  await assert.rejects(done, (error) => isLinkedChatContextCancelled(error))
  await assert.rejects(raced, (error) => isLinkedChatContextCancelled(error))
  watcher.dispose()
})

const claudeSummary = [
  'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.',
  '',
  '<tools-used-before-summary>Bash, Edit</tools-used-before-summary>',
  'Summary:',
  '1. Primary Request and Intent:',
  '   - Migrate the app.',
  '',
  'If you need specific details from before compaction, read the full transcript at: /tmp/a.jsonl',
  'Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary.',
  '',
  'The messages after this summary are the most recent messages from before compaction, kept verbatim. The summary was written without seeing them.'
].join('\n')

test('removes Claude resume instructions but keeps the summary body', () => {
  assert.equal(
    cleanClaudeCompactSummary(claudeSummary),
    [
      '1. Primary Request and Intent:',
      '   - Migrate the app.',
      '',
      'If you need specific details from before compaction, read the full transcript at: /tmp/a.jsonl'
    ].join('\n')
  )
})

test('Claude linked context includes the messages kept verbatim after compaction', () => {
  const messages = [
    { type: 'user', uuid: 'old', message: { role: 'user', content: 'Old prompt' } },
    {
      type: 'assistant',
      uuid: 'kept-answer',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Latest answer' },
          { type: 'tool_use', id: 't', name: 'Bash', input: {} }
        ]
      }
    },
    {
      type: 'user',
      uuid: 'kept-tool-result',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't' }] }
    },
    {
      type: 'system',
      uuid: 'boundary',
      message: {
        type: 'system',
        subtype: 'compact_boundary',
        compactMetadata: {
          preservedMessages: { uuids: ['kept-answer', 'kept-tool-result', 'kept-prompt'] }
        }
      }
    },
    {
      type: 'user',
      uuid: 'summary',
      isCompactSummary: true,
      message: { role: 'user', content: claudeSummary }
    },
    { type: 'user', uuid: 'kept-prompt', message: { role: 'user', content: 'Latest prompt' } }
  ]
  assert.equal(
    getClaudeLinkedChatSummary(messages),
    [
      '1. Primary Request and Intent:',
      '   - Migrate the app.',
      '',
      'If you need specific details from before compaction, read the full transcript at: /tmp/a.jsonl',
      '',
      '## Most recent messages',
      '',
      '**Assistant:**',
      '',
      'Latest answer',
      '',
      '**User:**',
      '',
      'Latest prompt'
    ].join('\n')
  )
})

test('Claude transcripts without a compact summary have no linked context', () => {
  assert.equal(
    getClaudeLinkedChatSummary([
      { type: 'user', uuid: 'a', message: { role: 'user', content: 'Hello' } }
    ]),
    null
  )
})

// Run the real summary methods with transport/history fixtures. No provider process starts.
const summaryHarness = (provider, nativeOutcome) => {
  const name = { claude: 'Claude', copilot: 'Copilot', opencode: 'OpenCode' }[provider]
  const sourceFile = ts.createSourceFile(
    `${name}ProviderAdapter.ts`,
    readFileSync(new URL(`./${provider}/${name}ProviderAdapter.ts`, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const declaration = sourceFile.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name.text === `${name}ProviderAdapter`
  )
  const methods = new Set(['summarizeChatInFork', 'forkSession'])
  const code = ts.transpileModule(
    `class Harness { ${declaration.members
      .filter((member) => methods.has(member.name?.getText(sourceFile)))
      .map((member) => member.getText(sourceFile))
      .join('\n')} }; globalThis.Harness = Harness`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
  ).outputText
  const updates = createUpdates()
  const controller = new AbortController()
  const created = []
  const stopped = []
  const historyReads = []
  const container = { kind: 'container', tool: 'toolbox', name: 'dev' }
  const nativeText = 'Native summary'
  const turnOptions = { model: 'provider/model' }
  const source = {
    active: false,
    options: turnOptions,
    container,
    directory: '/fixture'
  }
  const native = () => {
    if (nativeOutcome === 'cancel') controller.abort()
    if (nativeOutcome === 'throw' || nativeOutcome === 'cancel') {
      throw new Error('Native compression failed')
    }
    return nativeOutcome === 'empty' ? '' : nativeText
  }
  const client = {
    session: {
      fork: async () => ({ data: { id: 'native-fork', directory: '/fixture' } }),
      summarize: async () => {
        native()
        return { data: nativeOutcome !== 'declined' }
      },
      abort: async () => {
        stopped.push('native-fork')
      }
    }
  }
  const nativeState = {
    session: {
      rpc: {
        history: {
          compact: async () => ({
            success: nativeOutcome !== 'failed',
            summaryContent: native()
          }),
          abortManualCompaction: async () => {
            stopped.push('native-fork')
          }
        }
      }
    }
  }
  source.client = { rpc: { sessions: { fork: async () => ({ sessionId: 'native-fork' }) } } }
  const context = vm.createContext({
    ...linkedChatContext,
    console,
    setTimeout,
    linkedChatSummaryTailLimit: 20,
    linkedChatSummaryPollMs: 0,
    getClaudeSessionStore: async () => ({}),
    loadClaudeHistory: async () => [],
    getClaudeLinkedChatSummary: native,
    requireData: (result) => result.data,
    loadOpenCodeMessages: async () => [
      {
        info: {
          role: 'assistant',
          summary: true,
          time: { completed: 1 },
          error: nativeOutcome === 'failed' ? { message: 'Failed' } : undefined
        },
        parts: [{ type: 'text', text: native() }]
      }
    ]
  })
  vm.runInContext(code, context)
  const adapter = new context.Harness()
  let sourceDetail = {
    status: null,
    lastTurnOutcome: null,
    items: [
      { type: 'message', role: 'user', content: 'Earlier request' },
      { type: 'working', items: [{ type: 'message', content: 'Private reasoning' }] },
      { type: 'message', role: 'assistant', content: 'Earlier answer' },
      { type: 'pendingMessage', content: 'Unsent prompt' }
    ]
  }
  Object.assign(adapter, {
    ensureState: async () => source,
    ensureSession: async (id) => (id === 'source' ? source : nativeState),
    getClientEntry: async () => ({ client, container: null }),
    rememberSession() {},
    states: new Map(),
    sessionContainers: new Map(),
    onChatUpdated: updates.onChatUpdated,
    stopChat: async (id) => {
      stopped.push(id)
    },
    getChatWindow: async (id, window, options) => {
      historyReads.push({ id, window, options })
      return sourceDetail
    },
    continueChatInFork: async (id, prompt, options, onCreated) => {
      assert.equal(id, 'source')
      assert.equal(prompt, '/compact')
      assert.equal(options, turnOptions)
      await onCreated('native-fork')
      native()
      if (nativeOutcome === 'failed') updates.emit('native-fork', 'error')
      return { id: 'native-fork', status: null }
    }
  })
  return {
    adapter,
    updates,
    created,
    stopped,
    historyReads,
    source,
    controller,
    setSourceDetail: (detail) => {
      sourceDetail = { ...sourceDetail, ...detail }
    },
    run: () =>
      summarizeLinkedChatWithFallback(
        adapter,
        'source',
        { summaryPrompt: 'Custom summary prompt', signal: controller.signal, container },
        async (id) => {
          created.push(id)
        }
      )
  }
}

const transcriptSummary = [
  '## Most recent messages',
  '**User:**\n\nEarlier request',
  '**Assistant:**\n\nEarlier answer'
].join('\n\n')

for (const provider of ['claude', 'copilot', 'opencode']) {
  test(`${provider}: uses successful native compression directly`, async () => {
    const h = summaryHarness(provider, 'success')
    assert.equal(await h.run(), 'Native summary')
    assert.deepEqual(h.created, ['native-fork'])
    assert.equal(h.historyReads.length, 0)
    assert.equal(h.updates.size, 0)
  })

  for (const outcome of [
    'throw',
    'empty',
    'failed',
    ...(provider === 'opencode' ? ['declined'] : [])
  ]) {
    test(`${provider}: ${outcome} native compression falls back to source messages`, async () => {
      const h = summaryHarness(provider, outcome)
      assert.equal(await h.run(), transcriptSummary)
      assert.deepEqual(h.created, ['native-fork'])
      assert.deepEqual(h.historyReads, [
        {
          id: 'source',
          window: { startIndex: null, limit: 20 },
          options: { container: h.source.container }
        }
      ])
      assert.equal(h.updates.size, 0)
    })
  }

  test(`${provider}: cancelling native compression skips the transcript fallback`, async () => {
    const h = summaryHarness(provider, 'cancel')
    await assert.rejects(h.run(), isLinkedChatContextCancelled)
    assert.deepEqual(h.stopped, ['native-fork'])
    assert.equal(h.historyReads.length, 0)
    assert.equal(h.updates.size, 0)
  })

  test(`${provider}: an active source uses transcript text without starting a fork`, async () => {
    const h = summaryHarness(provider, 'throw')
    h.source.active = true
    assert.equal(await h.run(), transcriptSummary)
    assert.deepEqual(h.created, [])
    assert.equal(h.historyReads.length, 1)
  })
}

test('the transcript summary omits a streaming answer and pending messages', async () => {
  const h = summaryHarness('claude', 'throw')
  h.setSourceDetail({
    status: 'active',
    items: [
      { type: 'message', role: 'user', content: 'Earlier request' },
      { type: 'message', role: 'assistant', content: 'Earlier answer' },
      { type: 'message', role: 'user', content: 'Current request' },
      { type: 'message', role: 'assistant', content: 'Streaming answer' },
      { type: 'pendingMessage', content: 'Unsent prompt' }
    ]
  })
  assert.equal(await h.run(), `${transcriptSummary}\n\n**User:**\n\nCurrent request`)
})

test('the transcript summary limits large messages and prioritizes the latest exchanges', async () => {
  const h = summaryHarness('claude', 'throw')
  h.setSourceDetail({
    items: Array.from({ length: 20 }, (_, index) => ({
      type: 'message',
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${index + 1}: ${'x'.repeat(3_000)}`
    }))
  })
  const result = await h.run()
  assert.doesNotMatch(result, /Message 1:/)
  assert.match(result, /Message 19: x+…\n\n\*\*Assistant:\*\*\n\nMessage 20: x+…$/)
  assert.ok(result.length < 12_200)
})

test('an empty source transcript reports that there is no text to attach', async () => {
  const h = summaryHarness('claude', 'throw')
  h.setSourceDetail({ items: [{ type: 'message', role: 'user', content: ' ' }] })
  await assert.rejects(h.run(), /no user messages or final replies/)
})

test('cancelling a pending transcript read discards the fallback', async () => {
  const h = summaryHarness('claude', 'throw')
  let reading
  const started = new Promise((resolve) => {
    reading = resolve
  })
  h.adapter.getChatWindow = () => {
    reading()
    return new Promise(() => {})
  }
  const result = h.run()
  await started
  h.controller.abort()
  await assert.rejects(result, isLinkedChatContextCancelled)
})
