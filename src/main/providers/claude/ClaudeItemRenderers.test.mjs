import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isClaudeInternalUserMessage,
  isClaudeSkillContextMessage,
  renderClaudeChatItems
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

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
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
