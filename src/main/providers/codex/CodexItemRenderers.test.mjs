import { getToolDisplayLabel } from '../../../renderer/src/toolDisplayLabel.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChatConversationModel } from '../../../renderer/src/chatConversationModel.ts'
import { CodexTranscriptProjection, getChatItems } from './CodexItemRenderers.ts'

const imageSizingMetadata =
  '[Image: original 2380x292, displayed at 2000x245. Multiply coordinates by 1.19 to map to original image.]'

test('image sizing metadata keeps one working segment in full and incremental history', () => {
  for (const status of ['inProgress', 'completed']) {
    const projection = new CodexTranscriptProjection()
    let turn = {
      id: 'image-turn',
      status,
      items: [
        { type: 'userMessage', id: 'question', content: [{ type: 'text', text: 'Inspect it' }] },
        { type: 'agentMessage', id: 'before', text: 'Before screenshot', phase: 'commentary' }
      ]
    }
    getChatItems([turn], null, {}, projection)
    for (const item of [
      { type: 'userMessage', id: 'metadata', content: [{ type: 'text', text: imageSizingMetadata }] },
      { type: 'agentMessage', id: 'after', text: 'After screenshot', phase: 'commentary' }
    ]) {
      turn = { ...turn, items: [...turn.items, item] }
      const items = getChatItems([turn], null, {}, projection)
      assert.deepEqual(items, getChatItems([turn]))
      assert.equal(items.filter((entry) => entry.type === 'message').length, 1)
      const working = items.filter((entry) => entry.type === 'working')
      assert.equal(working.length, 1)
      assert.equal(working[0].status, status === 'inProgress' ? 'working' : 'worked')
      assert.equal(working[0].items.length, item.id === 'after' ? 2 : 1)
    }
  }
})

test('preserves user text discussing image metadata and messages with actual attachments', () => {
  for (const content of [
    [{ type: 'text', text: `What does this mean? ${imageSizingMetadata}` }],
    [{ type: 'text', text: imageSizingMetadata }, { type: 'localImage', path: '/tmp/screenshot.png' }]
  ]) {
    const items = getChatItems([
      {
        id: 'turn',
        status: 'completed',
        items: [{ type: 'userMessage', id: 'message', content }]
      }
    ])
    assert.equal(items[0]?.role, 'user')
    assert.equal(items[0]?.content, content[0].text)
  }
})

test('tool output preserves non-JSON text without warning and unwraps JSON envelopes', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const mixedOutput = '{\n  "value": true\n}\nCommand completed'
  for (const [output, expected] of [
    [mixedOutput, mixedOutput],
    ['[info] Command completed', '[info] Command completed'],
    ['{"incomplete":', '{"incomplete":'],
    ['{"value":true}\n{"value":false}', '{"value":true}\n{"value":false}'],
    ['{"value":true}', '{"value":true}'],
    [JSON.stringify({ output: mixedOutput }), mixedOutput],
    [
      JSON.stringify({ result: { content: [{ text: JSON.stringify({ stdout: 'done' }) }] } }),
      'done'
    ]
  ]) {
    const items = getChatItems([
      {
        id: 'turn',
        status: 'completed',
        items: [
          {
            id: 'tool',
            type: 'customToolCall',
            customToolName: 'apply_patch',
            customToolOutput: output,
            status: 'completed'
          }
        ]
      }
    ])
    assert.equal(items.find((item) => item.type === 'working')?.items[0]?.stdout, expected)
  }
  assert.equal(warn.mock.callCount(), 0)
})

// Test fixtures intentionally omit production-only Codex fields.
const renderFailedWorkingStep = (codexErrorInfo) => {
  const items = getChatItems([
    {
      id: `turn-${codexErrorInfo}`,
      status: 'failed',
      error: {
        message: 'Provider request failed',
        additionalDetails: null,
        codexErrorInfo
      },
      items: [
        {
          type: 'userMessage',
          id: 'user-message',
          content: [{ type: 'text', text: 'Try this' }]
        }
      ]
    }
  ])

  return items.find((item) => item.type === 'working')
}

test('marks Codex usage and rate-limit failures as resettable rate-limit turns', () => {
  assert.equal(renderFailedWorkingStep('usageLimitExceeded')?.failureReason, 'rateLimit')
  assert.equal(renderFailedWorkingStep('rateLimitExceeded')?.failureReason, 'rateLimit')
})

test('renders one timeline anchor when Codex repeats a subagent completion event', () => {
  const items = getChatItems([
    {
      id: 'parent-turn',
      status: 'completed',
      items: [
        { type: 'userMessage', id: 'question', content: [{ type: 'text', text: 'Delegate' }] },
        {
          type: 'subAgentActivity',
          id: 'completed-one',
          kind: 'completed',
          agentThreadId: 'child-thread'
        },
        {
          type: 'subAgentActivity',
          id: 'completed-two',
          kind: 'completed',
          agentThreadId: 'child-thread'
        }
      ]
    }
  ])
  const anchors = items.filter((item) => item.type === 'timelineAnchor')

  assert.deepEqual(anchors, [
    { type: 'timelineAnchor', id: 'parent-turn:subagent-completed:child-thread' }
  ])
})

test('incremental projection does not reinsert a repeated subagent completion anchor', async () => {
  const { CodexTranscriptProjection } = await import('./CodexItemRenderers.ts')
  const projection = new CodexTranscriptProjection()
  const turn = {
    id: 'parent-turn',
    status: 'inProgress',
    items: [
      { type: 'userMessage', id: 'question', content: [{ type: 'text', text: 'Delegate' }] },
      {
        type: 'subAgentActivity',
        id: 'completed-one',
        kind: 'completed',
        agentThreadId: 'child-thread'
      },
      { type: 'reasoning', id: 'working', summary: ['Continuing'] }
    ]
  }

  getChatItems([turn], null, {}, projection)
  turn.items.push({
    type: 'subAgentActivity',
    id: 'completed-two',
    kind: 'completed',
    agentThreadId: 'child-thread'
  })
  const items = getChatItems([turn], null, {}, projection)

  assert.equal(items.filter((item) => item.type === 'timelineAnchor').length, 1)
})

test('keeps the failed turn user message available for retry after a limit reset', () => {
  const userMessage = {
    type: 'message',
    id: 'user-message',
    editTargetId: 'turn-id',
    role: 'user',
    content: 'Try this'
  }
  const rateLimitedStep = {
    type: 'working',
    id: 'working-step',
    status: 'failed',
    failureReason: 'rateLimit',
    items: []
  }
  const model = buildChatConversationModel([userMessage, rateLimitedStep])

  assert.equal(model.stoppedTurnRetryMessages.get(rateLimitedStep.id), userMessage)
})

test('does not mark unrelated Codex failures as rate-limit turns', () => {
  assert.equal(renderFailedWorkingStep('serverOverloaded')?.failureReason, undefined)
})

test('does not render an orphan stopped marker for an interrupted turn with no items', () => {
  assert.deepEqual(
    getChatItems([
      {
        id: 'orphan-interrupted-turn',
        status: 'interrupted',
        items: []
      }
    ]),
    []
  )
})

test('renders a stopped marker after the submitted user message', () => {
  const items = getChatItems([
    {
      id: 'interrupted-turn',
      status: 'interrupted',
      items: [
        {
          type: 'userMessage',
          id: 'submitted-message',
          content: [{ type: 'text', text: 'Keep this message' }]
        }
      ]
    }
  ])

  assert.deepEqual(
    items.map((item) => (item.type === 'message' ? `${item.role}:${item.content}` : item.status)),
    ['user:Keep this message', 'stopped']
  )
})

test('marks an inline follow-up as a steering message', () => {
  const items = getChatItems([
    {
      id: 'steered-turn',
      status: 'completed',
      items: [
        {
          type: 'userMessage',
          id: 'initial-message',
          content: [{ type: 'text', text: 'Start here' }]
        },
        {
          type: 'userMessage',
          id: 'steering-message',
          content: [{ type: 'text', text: 'Change direction' }]
        }
      ]
    }
  ])
  const steeringMessage = items.find(
    (item) => item.type === 'message' && item.content === 'Change direction'
  )

  assert.equal(steeringMessage?.kind, 'steering')
  assert.equal(steeringMessage?.label, 'Steered with')
})

test('promotes the final response only after the turn finishes', () => {
  const createTurn = (status) => ({
    id: 'answer-turn',
    status,
    items: [
      {
        type: 'userMessage',
        id: 'question',
        content: [{ type: 'text', text: 'Answer this' }]
      },
      {
        type: 'reasoning',
        id: 'reasoning',
        summary: ['Checking the details']
      },
      {
        type: 'agentMessage',
        id: 'answer',
        text: 'Here is the answer.',
        phase: 'final_answer'
      }
    ]
  })

  for (const status of ['inProgress', 'completed']) {
    const items = getChatItems([createTurn(status)])
    const working = items.find((item) => item.type === 'working')
    const finalMessage = items.find((item) => item.type === 'message' && item.role === 'assistant')

    if (status === 'inProgress') {
      assert.equal(finalMessage, undefined)
      assert.equal(working?.status, 'working')
      assert.ok(
        working.items.some(
          (item) => item.type === 'message' && item.content === 'Here is the answer.'
        )
      )
    } else {
      assert.equal(finalMessage?.id, 'answer-turn:answer')
      assert.equal(finalMessage?.content, 'Here is the answer.')
    }
  }
})

test('renders CUA browser actions with readable compact labels without protocol payloads', () => {
  const cases = [
    ['cua.getBrowser({ url: "https://www.wikipedia.org" })', 'Opened browser'],
    [
      'cua.createBrowserTab(browser.browserId, "https://www.wikipedia.org", { visible: true }); await tab.markDeliverable()',
      'Opened a new tab'
    ],
    ['tab.goto("https://www.wikipedia.org")', 'Navigated to webpage'],
    ['tab.click(12); await tab.getAXState()', 'Clicked on webpage'],
    ['tab.getScreenshot()', 'Took browser screenshot'],
    ['tab.typeText("example")', 'Typed on webpage'],
    ['tab.scroll(1, "down")', 'Scrolled webpage'],
    ['tab.markHandoff()', 'Handed over browser'],
    ['nodeRepl.write("tab.close()"); /* tab.goto() */ await tab.getAXState()', 'Read webpage']
  ]
  for (const [code, label] of cases) {
    for (const type of ['mcpToolCall', 'dynamicToolCall', 'customToolCall']) {
      const args = { code, title: 'User supplied title' }
      const items = getChatItems([
        {
          id: 'browser-turn',
          status: 'inProgress',
          items: [
            {
              id: 'browser-call',
              type,
              status: 'inProgress',
              server: type === 'mcpToolCall' ? 'cua_repl' : undefined,
              namespace: type === 'dynamicToolCall' ? 'mcp__cua_repl' : undefined,
              tool: type === 'customToolCall' ? undefined : 'js',
              customToolName: type === 'customToolCall' ? 'mcp__cua_repl__js' : undefined,
              customToolInput: type === 'customToolCall' ? JSON.stringify(args) : undefined,
              arguments: args
            }
          ]
        }
      ])
      const tool = items.find((item) => item.type === 'working')?.items[0]
      assert.equal(tool?.label, label)
      assert.equal(tool?.icon, 'browser')
      assert.equal(tool?.compact, true)
      assert.equal(tool?.rawInput, null)
      assert.equal(tool?.rawOutput, null)
    }
  }
})

test('stores canonical browser labels independently of provider status', () => {
  for (const [status, error, label] of [
    ['completed', null, 'Opened a new tab'],
    ['failed', 'Browser unavailable', 'Opened a new tab'],
    ['completed', 'Browser unavailable', 'Opened a new tab']
  ]) {
    const items = getChatItems([
      {
        id: 'turn',
        status: 'completed',
        items: [
          {
            id: 'call',
            type: 'mcpToolCall',
            server: 'cua_repl',
            tool: 'js',
            status,
            error,
            arguments: { code: 'await cua.createBrowserTab("iab")' }
          }
        ]
      }
    ])
    assert.equal(items.find((item) => item.type === 'working')?.items[0]?.label, label)
  }
})

test('browser labels use the same active-to-finished display flow as other tools', () => {
  for (const [finished, active, activity] of [
    ['Opened a new tab', 'Opening a new tab', 'other'],
    ['Opened browser', 'Opening browser', 'other'],
    ['Navigated to webpage', 'Navigating to webpage', 'other'],
    ['Took browser screenshot', 'Taking browser screenshot', 'other'],
    ['Read webpage', 'Reading webpage', 'other'],
    ['Read file', 'Reading file', 'read'],
    ['Create network.gd', 'Creating network.gd', 'create'],
    ['Created network.gd', 'Creating network.gd', 'create'],
    ['Edit network.gd', 'Changing network.gd', 'edit'],
    ['Delete network.gd', 'Deleting network.gd', 'delete'],
    ['Search scripts', 'Searching scripts', 'search'],
    ['Ran a command', 'Running a command', 'command'],
    ['Applied patch', 'Applying patch', 'edit']
  ]) {
    assert.equal(getToolDisplayLabel(finished, activity, true), active)
    assert.equal(getToolDisplayLabel(finished, activity, false), finished)
  }
})

test('bounded live rendering retains compact actions between tool sequences', () => {
  const command = (id) => ({
    id,
    type: 'commandExecution',
    command: 'rg needle src',
    status: 'completed',
    aggregatedOutput: 'match'
  })
  const turn = {
    id: 'bounded-tools',
    status: 'inProgress',
    items: [
      command('search-1'),
      command('search-2'),
      {
        id: 'browser',
        type: 'mcpToolCall',
        server: 'cua_repl',
        tool: 'js',
        arguments: { code: 'tab.click(12)' },
        status: 'inProgress'
      },
      command('search-3')
    ]
  }
  const flatten = (items) =>
    items.flatMap((item) => (item.type === 'toolGroup' ? item.tools : [item]))
  const full = getChatItems([turn]).find((item) => item.type === 'working')
  const bounded = getChatItems([turn], null, {
    workingItemTailTurnId: turn.id,
    workingItemTailLimit: 50
  }).find((item) => item.type === 'working')
  assert.deepEqual(flatten(bounded.items), flatten(full.items))
  assert.deepEqual(
    bounded.items.map((item) => item.type),
    ['toolGroup', 'tool', 'tool']
  )
  assert.equal(bounded.items[1].icon, 'browser')
  assert.equal(bounded.itemCount, 3)
})

test('mixed tool headings name both reading and searching while active', async () => {
  const { getToolSequenceDisplayLabel } = await import('../../../renderer/src/toolDisplayLabel.ts')
  assert.equal(
    getToolSequenceDisplayLabel(['read', 'search', 'read'], true),
    'Reading files, Searching'
  )
  assert.equal(getToolSequenceDisplayLabel(['read', 'search'], false), 'Read files, searched')
})
