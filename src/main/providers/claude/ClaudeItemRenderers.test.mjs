import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ClaudeTranscriptProjection,
  isClaudeInternalUserMessage,
  isClaudeSkillContextMessage,
  renderClaudeChatItems,
  resolveClaudeAssistantMessageUuid
} from './ClaudeItemRenderers.ts'

const skillToolId = 'toolu_skill'
const skillBody = 'Base directory for this skill: /tmp/skills/dataviz\n\n# Data visualization\n'

const userPrompt = {
  type: 'user',
  uuid: 'user-1',
  session_id: 'session',
  message: { role: 'user', content: [{ type: 'text', text: 'Make a chart' }] },
  parent_tool_use_id: null
}

const skillToolUse = {
  type: 'assistant',
  uuid: 'assistant-1',
  session_id: 'session',
  message: {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: skillToolId,
        name: 'Skill',
        input: { skill: 'dataviz', args: 'bar chart' }
      }
    ]
  },
  parent_tool_use_id: null
}

const skillToolResult = {
  type: 'user',
  uuid: 'user-2',
  session_id: 'session',
  message: {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: skillToolId, content: 'Launching skill: dataviz' }
    ]
  },
  parent_tool_use_id: null,
  tool_use_result: { success: true, commandName: 'dataviz' }
}

const skillContextMessage = {
  type: 'user',
  uuid: 'user-3',
  session_id: 'session',
  message: { role: 'user', content: [{ type: 'text', text: skillBody }] },
  parent_tool_use_id: null
}

const getSkillTool = (items) => {
  const workingStep = items.find((item) => item.type === 'working')
  assert.ok(workingStep, 'expected a working step')
  const tools = workingStep.items.flatMap((item) =>
    item.type === 'toolGroup' ? item.tools : item.type === 'tool' ? [item] : []
  )
  const tool = tools.find((candidate) => candidate.toolId === skillToolId)
  assert.ok(tool, 'expected the skill tool')
  return tool
}

test('skill tool renders as a labeled step without an expandable payload', () => {
  const items = renderClaudeChatItems([userPrompt, skillToolUse, skillToolResult], {
    active: false,
    stopped: false
  })
  const tool = getSkillTool(items)
  assert.equal(tool.label, 'Use dataviz skill')
  assert.equal(tool.status, 'finished')
  assert.equal(tool.command, null)
  assert.equal(tool.stdout, null)
  assert.equal(tool.rawInput, null)
  assert.equal(tool.rawOutput, null)
  assert.deepEqual(tool.diffs, [])
})

test('skill body injected as a user message is not rendered as the person speaking', () => {
  const items = renderClaudeChatItems(
    [userPrompt, skillToolUse, skillToolResult, skillContextMessage],
    { active: false, stopped: false }
  )
  const userMessages = items.filter((item) => item.type === 'message' && item.role === 'user')
  assert.deepEqual(
    userMessages.map((item) => item.content),
    ['Make a chart']
  )
})

test('skill context is detected by content marker or live isMeta flag', () => {
  assert.equal(isClaudeSkillContextMessage(skillContextMessage), true)
  assert.equal(isClaudeInternalUserMessage(skillContextMessage), true)
  const metaMessage = {
    ...userPrompt,
    uuid: 'user-4',
    isMeta: true,
    message: { role: 'user', content: [{ type: 'text', text: 'Injected instructions' }] }
  }
  assert.equal(isClaudeSkillContextMessage(metaMessage), true)
  assert.equal(isClaudeSkillContextMessage(userPrompt), false)
  assert.equal(isClaudeSkillContextMessage(skillToolResult), false)
})

test('background task notifications stay hidden in history and live projection', () => {
  const text =
    '<task-notification>\n<task-id>background-1</task-id>\n<status>completed</status>\n<summary>Command completed (exit code 0)</summary>\n</task-notification>'
  const options = { active: false, stopped: false }
  for (const content of [
    text,
    `${text}\nRead the output file to retrieve the result: /tmp/task.output`
  ]) {
    const notification = {
      ...userPrompt,
      uuid: 'task-notification',
      message: { role: 'user', content: [{ type: 'text', text: content }] }
    }
    assert.equal(isClaudeInternalUserMessage(notification), true)
    const source = [userPrompt, skillToolUse, skillToolResult]
    const expected = renderClaudeChatItems(source, options)
    assert.deepEqual(renderClaudeChatItems([...source, notification], options), expected)
    const projection = new ClaudeTranscriptProjection()
    const before = structuredClone(projection.read(source, [], options))
    assert.deepEqual(projection.read(source, [notification], options), before)
    const updated = [...source, notification]
    projection.acceptSource(source, updated, source.length)
    assert.deepEqual(projection.read(updated, [], options), before)
  }
})

test('image sizing hints without SDK metadata stay hidden and do not split working groups', () => {
  const text =
    '[Image: original 2048x2048, displayed at 2000x2000. Multiply coordinates by 1.02 to map to original image.]'
  for (const active of [true, false]) {
    for (const content of [text, [{ type: 'text', text }]]) {
      const options = { active, stopped: false }
      // History loaded through the SDK may omit the original isMeta flag.
      const metadata = { ...userPrompt, uuid: 'image-metadata', message: { content } }
      assert.equal(isClaudeInternalUserMessage(metadata), true)
      const source = [userPrompt, skillToolUse]
      const expected = renderClaudeChatItems([...source, skillToolResult], options)
      assert.deepEqual(
        renderClaudeChatItems([...source, metadata, skillToolResult], options),
        expected
      )
      assert.equal(expected.filter((item) => item.type === 'working').length, 1)
      const projection = new ClaudeTranscriptProjection()
      const reference = new ClaudeTranscriptProjection()
      projection.read(source, [], options)
      assert.deepEqual(
        projection.read(source, [metadata, skillToolResult], options),
        reference.read([...source, skillToolResult], [], options)
      )
      const updated = [...source, metadata, skillToolResult]
      projection.acceptSource(source, updated, source.length)
      assert.deepEqual(
        projection.read(updated, [], options),
        reference.read([...source, skillToolResult], [], options)
      )
    }
  }
  assert.equal(
    isClaudeInternalUserMessage({ ...userPrompt, message: { content: `Explain ${text}` } }),
    false
  )
  assert.equal(
    isClaudeInternalUserMessage({
      ...userPrompt,
      message: { content: text },
      attachments: [{ kind: 'image', path: '/tmp/image.png' }]
    }),
    false
  )
})

test('mentions of task notifications and attached messages remain visible', () => {
  for (const text of [
    'What does <task-notification> mean?',
    'Example: <task-notification>completed</task-notification>',
    '<task-notification>incomplete'
  ]) {
    assert.equal(
      isClaudeInternalUserMessage({
        ...userPrompt,
        message: { content: text }
      }),
      false
    )
  }
  assert.equal(
    isClaudeInternalUserMessage({
      ...userPrompt,
      message: { content: '<task-notification>completed</task-notification>' },
      attachments: [{ id: 'attachment' }]
    }),
    false
  )
})

const streamedResponse = {
  type: 'assistant',
  uuid: 'msg_stream:partial',
  session_id: 'session',
  message: {
    id: 'msg_stream',
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'Plan the change' },
      { type: 'text', text: 'Checking the tree.' },
      { type: 'tool_use', id: 'toolu_git', name: 'Bash', input: { command: 'git status' } },
      { type: 'tool_use', id: 'toolu_grep', name: 'Bash', input: { command: 'grep -r x' } }
    ]
  },
  parent_tool_use_id: null
}

// Claude Code persists one API response as one transcript record per block, each with its own uuid.
const persistedResponse = streamedResponse.message.content.map((block, index) => ({
  type: 'assistant',
  uuid: `persisted-${index}`,
  session_id: 'session',
  message: { id: 'msg_stream', role: 'assistant', content: [block] },
  parent_tool_use_id: null
}))

const collectIds = (items) =>
  items.flatMap((item) =>
    item.type === 'working' ? item.items.map((workingItem) => workingItem.id) : [item.id]
  )

test('streamed blocks keep their ids once their transcript records arrive', () => {
  const options = { active: true, stopped: false }
  const streamedIds = collectIds(renderClaudeChatItems([userPrompt, streamedResponse], options))
  const persistedIds = collectIds(
    renderClaudeChatItems([userPrompt, ...persistedResponse], options)
  )

  assert.deepEqual(persistedIds, streamedIds)
  assert.deepEqual(streamedIds, [
    'user-1',
    'msg_stream:thinking:0',
    'msg_stream:text:0',
    'msg_stream:toolu_git',
    'msg_stream:toolu_grep'
  ])
  assert.equal(new Set(streamedIds).size, streamedIds.length)
})

test('records without an API message id fall back to their transcript uuid', () => {
  const items = renderClaudeChatItems([userPrompt, skillToolUse], { active: false, stopped: false })
  assert.equal(getSkillTool(items).id, `assistant-1:${skillToolId}`)
})

test('fork targets resolve a rendered assistant id back to its transcript uuid', () => {
  const messages = [userPrompt, ...persistedResponse]
  assert.equal(resolveClaudeAssistantMessageUuid(messages, 'msg_stream:text:0'), 'persisted-1')
  assert.equal(resolveClaudeAssistantMessageUuid(messages, 'msg_stream:text:1'), null)
  assert.equal(resolveClaudeAssistantMessageUuid(messages, 'persisted-1'), null)
})
