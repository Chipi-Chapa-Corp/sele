import { getToolDisplayLabel } from '../../../renderer/src/toolDisplayLabel.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChatConversationModel } from '../../../renderer/src/chatConversationModel.ts'
import { getChatItems } from './CodexItemRenderers.ts'

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
})

test('projects the final response both while live and after completion', () => {
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

    assert.equal(finalMessage?.id, 'answer-turn:answer')
    assert.equal(finalMessage?.content, 'Here is the answer.')
    if (status === 'inProgress') assert.equal(working?.status, 'working')
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
