import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const method = (path, className) => {
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const declaration = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === className
  )
  const member = declaration.members.find(
    (node) => node.name?.getText(source) === 'enqueueLimitResetMessage'
  )
  return vm.runInNewContext(
    ts.transpile(`class Adapter {${member.getText(source)}};new Adapter()`, {
      target: ts.ScriptTarget.ES2022
    }),
    { console }
  )
}

for (const provider of ['codex', 'claude', 'copilot', 'opencode']) {
  test(`${provider} persists before draining and retries a failed handoff without adding a duplicate`, async () => {
    const className = {
      codex: 'CodexProviderAdapter',
      claude: 'ClaudeProviderAdapter',
      copilot: 'CopilotProviderAdapter',
      opencode: 'OpenCodeProviderAdapter'
    }[provider]
    const adapter = method(`./${provider}/${className}.ts`, className)
    const entries = [{ id: 'existing', content: 'existing' }]
    const state = {
      id: 'chat',
      queuedMessages: entries,
      pendingMessages: entries,
      queuePaused: false,
      queuedMessagesPaused: false,
      stopped: true,
      usageLimitReached: true
    }
    const pauses = new Set()
    let drains = 0
    let persisted = false
    Object.assign(adapter, {
      ensureState: async () => state,
      ensureSession: async () => state,
      runWithContainer: (_target, run) => run(),
      getThreadContainer: () => null,
      ensureChatTailLoaded: async () => {},
      pausedQueuedTurnThreads: pauses,
      queuedTurnsByThread: new Map([['chat', entries]]),
      pendingMessageStore: { invalidate: () => {} },
      addQueuedTurn: (_chat, content) => {
        const pending = { id: 'new', content }
        entries.push(pending)
        return pending
      },
      createQueuedMessage: (content, _options, id) => ({ id, content }),
      createPendingMessage: (content, _options, _kind, id) => ({ id, content }),
      queueMessage: async (_state, content, _options, _kind, id) => {
        entries.push({ id, content })
        persisted = true
      },
      persistPendingMessages: () => {
        persisted = true
      },
      emitUpdate: () => {
        persisted = true
      },
      emitChatUpdated: () => {
        persisted = true
      },
      scheduleQueueDrain: () => {
        drains++
      },
      drainNextQueuedMessage: async () => {
        drains++
      },
      drainQueue: async () => {
        drains++
      }
    })
    const paused = () =>
      provider === 'codex'
        ? pauses.has('chat')
        : provider === 'claude'
          ? state.queuedMessagesPaused
          : state.queuePaused
    await assert.rejects(
      adapter.enqueueLimitResetMessage('chat', 'reset prompt', 'reset-id', {}, async () => {
        assert.equal(persisted, true)
        assert.equal(paused(), true)
        assert.equal(drains, 0)
        throw new Error('disk full')
      }),
      /disk full/
    )
    assert.equal(paused(), true)
    assert.equal(entries.filter((entry) => entry.id === 'reset-id').length, 1)
    await adapter.enqueueLimitResetMessage('chat', 'reset prompt', 'reset-id', {}, async () => {
      assert.equal(paused(), true)
      assert.equal(drains, 0)
    })
    assert.equal(paused(), false)
    assert.equal(drains, 1)
    assert.deepEqual(
      entries.map((entry) => entry.id),
      ['existing', 'reset-id']
    )
    if (provider === 'opencode') {
      assert.equal(state.stopped, false)
      assert.equal(state.usageLimitReached, false)
    }
  })
}
