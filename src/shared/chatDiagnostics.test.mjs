import assert from 'node:assert/strict'
import test from 'node:test'
import { getProviderChatDiagnostics } from './chatDiagnostics.ts'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const tool = (id, overrides = {}) => ({
  type: 'tool',
  id,
  toolId: id,
  status: 'finished',
  activity: 'command',
  icon: null,
  label: 'tool',
  command: null,
  cwd: null,
  stdout: null,
  diffs: [],
  backgroundSessionId: null,
  finishedBackgroundSessionId: null,
  rawInput: null,
  rawOutput: null,
  images: [],
  ...overrides
})

test('summarizes retained payload and nested tools by turn without retaining content', () => {
  const diagnostics = getProviderChatDiagnostics([
    {
      type: 'message',
      id: 'user-1',
      role: 'user',
      content: 'hello',
      attachments: [{ kind: 'file', name: 'a.ts', path: '/repo/a.ts' }]
    },
    {
      type: 'working',
      id: 'working-1',
      status: 'worked',
      items: [
        { type: 'message', id: 'reasoning-1', content: 'thinking' },
        tool('tool-1', {
          command: 'run',
          cwd: '/repo',
          stdout: 'output',
          diffs: [{ path: 'a.ts', kind: 'edit', diff: 'diff' }],
          rawInput: { query: 'find' },
          rawOutput: ['raw'],
          images: [{ name: 'image', dataUrl: 'data' }]
        }),
        {
          type: 'toolGroup',
          id: 'group-1',
          label: 'group',
          tools: [tool('tool-2'), tool('tool-3')]
        }
      ]
    },
    { type: 'message', id: 'assistant-1', role: 'assistant', content: 'done' },
    { type: 'message', id: 'user-2', role: 'user', content: 'next' },
    {
      type: 'working',
      id: 'working-2',
      status: 'worked',
      items: [],
      itemsLoaded: false,
      itemCount: 250
    }
  ])

  assert.deepEqual(diagnostics, {
    topLevelItemCount: 5,
    turnCount: 2,
    workingStepCount: 2,
    loadedWorkingStepCount: 1,
    retainedWorkingItemCount: 3,
    knownWorkingItemCount: 253,
    toolCount: 3,
    payloadCharacterCount: 77,
    payloadCharacters: {
      messageContent: 13,
      messageAttachments: 18,
      workingMessages: 8,
      toolCommands: 8,
      toolOutput: 6,
      toolDiffs: 8,
      rawToolValues: 7,
      toolImages: 9
    },
    maxTurnTopLevelItemCount: 3,
    maxTurnRetainedWorkingItemCount: 3,
    maxTurnKnownWorkingItemCount: 250,
    maxTurnToolCount: 3,
    maxTurnPayloadCharacterCount: 73
  })
})

test('does not double-count cyclic raw tool values', () => {
  const rawOutput = { value: 'kept' }
  rawOutput.self = rawOutput

  const diagnostics = getProviderChatDiagnostics([
    { type: 'message', id: 'user-1', role: 'user', content: '' },
    {
      type: 'working',
      id: 'working-1',
      status: 'worked',
      items: [tool('tool-1', { rawOutput })]
    }
  ])

  assert.equal(diagnostics.payloadCharacters.rawToolValues, 4)
})
