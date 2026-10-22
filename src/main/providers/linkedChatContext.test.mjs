import assert from 'node:assert/strict'
import test from 'node:test'
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
