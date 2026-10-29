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
  const methods = new Set(['summarizeChatInFork', 'summarizeChatNativelyInFork'])
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
  const manualCalls = []
  const nativeText = 'Native summary'
  const turnOptions = { model: 'provider/model' }
  const source = {
    active: false,
    options: turnOptions,
    container: null,
    directory: '/fixture',
    messages: [{ info: { role: 'user', model: { providerID: 'provider', modelID: 'model' } } }]
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
  let manualDetail = {
    id: 'manual-fork',
    status: null,
    lastTurnOutcome: null,
    items: [
      { type: 'message', role: 'user', content: 'Earlier request' },
      { type: 'message', role: 'assistant', content: 'Earlier answer' },
      { type: 'message', role: 'user', content: 'Custom summary prompt' },
      { type: 'working', items: [{ type: 'message', content: 'Private reasoning' }] },
      { type: 'message', role: 'assistant', content: 'Manual summary' }
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
    getChat: async (id) => {
      assert.equal(id, 'manual-fork')
      return manualDetail
    },
    continueChatInFork: async (id, prompt, options, onCreated) => {
      assert.equal(id, 'source')
      if (prompt === '/compact') {
        await onCreated('native-fork')
        native()
        if (nativeOutcome === 'failed') updates.emit('native-fork', 'error')
        return { id: 'native-fork', status: null }
      }
      manualCalls.push({ prompt, options })
      await onCreated('manual-fork')
      // A fast provider may complete before continueChatInFork returns.
      updates.emit('manual-fork', 'active')
      updates.emit('manual-fork', null)
      return manualDetail
    }
  })
  return {
    adapter,
    updates,
    created,
    stopped,
    manualCalls,
    source,
    controller,
    setManualDetail: (detail) => {
      manualDetail = { ...manualDetail, ...detail }
    },
    run: () =>
      adapter.summarizeChatInFork(
        'source',
        { summaryPrompt: 'Custom summary prompt', signal: controller.signal },
        async (id) => {
          created.push(id)
        }
      )
  }
}

for (const provider of ['claude', 'copilot', 'opencode']) {
  test(`${provider}: successful native compression does not send a manual prompt`, async () => {
    const h = summaryHarness(provider, 'success')
    assert.equal(await h.run(), 'Native summary')
    assert.deepEqual(h.created, ['native-fork'])
    assert.equal(h.manualCalls.length, 0)
    assert.equal(h.updates.size, 0)
  })

  for (const outcome of [
    'throw',
    'empty',
    'failed',
    ...(provider === 'opencode' ? ['declined'] : [])
  ]) {
    test(`${provider}: ${outcome} native compression falls back to the configured prompt`, async () => {
      const h = summaryHarness(provider, outcome)
      assert.equal(await h.run(), 'Manual summary')
      assert.deepEqual(h.created, ['native-fork', 'manual-fork'])
      assert.equal(h.manualCalls.length, 1)
      assert.equal(h.manualCalls[0].prompt, 'Custom summary prompt')
      assert.equal(h.manualCalls[0].options.model, 'provider/model')
      assert.equal(h.updates.size, 0)
    })
  }

  test(`${provider}: cancelling native compression never starts manual compression`, async () => {
    const h = summaryHarness(provider, 'cancel')
    await assert.rejects(h.run(), isLinkedChatContextCancelled)
    assert.equal(h.manualCalls.length, 0)
    assert.equal(h.updates.size, 0)
  })

  test(`${provider}: an active source does not start either compression path`, async () => {
    const h = summaryHarness(provider, 'throw')
    h.source.active = true
    await assert.rejects(h.run(), /Wait for the current response/)
    assert.deepEqual(h.created, [])
  })

  test(`${provider}: an empty manual answer rejects instead of returning an older answer`, async () => {
    const h = summaryHarness(provider, 'throw')
    h.setManualDetail({
      items: [
        { type: 'message', role: 'assistant', content: 'Earlier answer' },
        { type: 'message', role: 'user', content: 'Custom summary prompt' }
      ]
    })
    await assert.rejects(h.run(), /did not return a summary/)
    assert.equal(h.updates.size, 0)
  })

  test(`${provider}: cancellation during the manual turn stops its fork`, async () => {
    const h = summaryHarness(provider, 'throw')
    let started
    const ready = new Promise((resolve) => {
      started = resolve
    })
    const createFork = h.adapter.continueChatInFork
    h.adapter.continueChatInFork = async (id, prompt, options, onCreated) => {
      if (prompt === '/compact') return createFork(id, prompt, options, onCreated)
      await onCreated('manual-fork')
      started()
      return { id: 'manual-fork', status: 'active' }
    }
    const result = h.run()
    await ready
    h.controller.abort()
    await assert.rejects(result, isLinkedChatContextCancelled)
    assert.ok(h.stopped.includes('manual-fork'))
    assert.equal(h.updates.size, 0)
  })

  test(`${provider}: a failed manual turn reports the failure and removes its watcher`, async () => {
    const h = summaryHarness(provider, 'throw')
    h.setManualDetail({ lastTurnOutcome: 'failed' })
    await assert.rejects(h.run(), /provider failed while summarizing/)
    assert.equal(h.manualCalls.length, 1)
    assert.equal(h.updates.size, 0)
  })
}
