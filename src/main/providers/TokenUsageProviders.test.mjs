import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { addTokenUsage, emptyTokenUsage, normalizeTokenUsage } from '../../shared/tokenUsage.ts'
import { TokenUsageReporter } from './TokenUsageReporter.ts'

const loadMethod = (provider, className, method, globals = {}) => {
  const source = ts.createSourceFile(
    className,
    readFileSync(new URL(`./${provider}/${className}.ts`, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const declaration = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name.text === className
  )
  const member = declaration.members.find((node) => node.name?.getText(source) === method)
  const code = ts.transpileModule(`class Harness { ${member.getText(source)} }; new Harness()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
  const records = []
  const instance = vm.runInNewContext(code, {
    normalizeTokenUsage,
    addTokenUsage,
    emptyTokenUsage,
    getContainerTargetKey: () => 'host',
    ...globals
  })
  instance.tokenUsageReporter = { report: (record) => records.push(record), linkChat() {} }
  instance.threads = new Map()
  return { instance, records }
}

test('Codex reports cumulative thread counters with native turn identity and an initial delta', () => {
  const { instance, records } = loadMethod(
    'codex',
    'CodexProviderAdapter',
    'handleThreadTokenUsage',
    {
      getThreadId: (params) => params.threadId,
      getOptionalStringValue: (value) => value ?? null,
      normalizeChatContextUsage: (value) => value
    }
  )
  Object.assign(instance, {
    rememberThreadContainer() {},
    getActiveTurnId: () => 'active',
    threadContainers: new Map(),
    threads: new Map([['chat', { turns: [{ id: 'turn', model: 'gpt-5.3-codex' }] }]]),
    contextUsageByThread: new Map(),
    scheduleChatUpdated() {}
  })
  instance.handleThreadTokenUsage({
    threadId: 'chat',
    turnId: 'turn',
    tokenUsage: {
      total: {
        inputTokens: 1000,
        cachedInputTokens: 700,
        outputTokens: 100,
        reasoningOutputTokens: 40
      },
      last: { inputTokens: 100, cachedInputTokens: 70, outputTokens: 10, reasoningOutputTokens: 5 }
    }
  })
  assert.deepEqual(records[0].usage, normalizeTokenUsage(300, 700, 100))
  assert.deepEqual(records[0].initialUsage, normalizeTokenUsage(30, 70, 10))
  assert.equal(records[0].turnId, 'turn')
  assert.equal(records[0].cumulative, true)
  assert.equal(records[0].models[0].modelId, 'gpt-5.3-codex')
  assert.equal(records[0].models[0].contextTokens, 100)
})

test('Claude records the full model pipeline and reuses the query counter identity across turns', () => {
  const { instance, records } = loadMethod(
    'claude',
    'ClaudeProviderAdapter',
    'reportResultTokenUsage',
    {
      randomUUID: () => 'query-id',
      isRecord: (value) => typeof value === 'object' && value != null,
      isClaudeInternalUserMessage: () => false
    }
  )
  instance.getUsageQueryId = () => 'query-id'
  const control = {}
  const state = {
    id: 'chat',
    messages: [
      { type: 'user', uuid: 'user', message: { content: 'hello' } },
      { type: 'user', uuid: 'tool-result', message: { content: [{ type: 'tool_result' }] } }
    ]
  }
  const result = {
    modelUsage: {
      main: {
        inputTokens: 100,
        cacheCreationInputTokens: 20,
        cacheReadInputTokens: 200,
        outputTokens: 40,
        costUSD: 1.5
      },
      child: {
        inputTokens: 50,
        cacheCreationInputTokens: 10,
        cacheReadInputTokens: 30,
        outputTokens: 20,
        costUSD: 0.5
      }
    }
  }
  instance.reportResultTokenUsage(state, control, result)
  instance.reportResultTokenUsage(state, control, { ...result, user_message_uuid: 'next' })
  assert.deepEqual(records[0].usage, normalizeTokenUsage(180, 230, 60))
  assert.equal(records[0].turnId, 'user')
  assert.equal(records[1].turnId, 'next')
  assert.equal(records[0].recordId, records[1].recordId)
  assert.equal(records[0].cumulative, true)
  assert.equal(records[0].models[0].totalUSD, 1.5)
  assert.equal(records[0].models[1].totalUSD, 0.5)
})

test('Copilot attributes delayed subagent usage to its initiating user turn, not a later turn', () => {
  const { instance, records } = loadMethod(
    'copilot',
    'CopilotProviderAdapter',
    'reportEventTokenUsage',
    {
      isCopilotSystemContextMessage: () => false,
      toMilliseconds: (timestamp) => Date.parse(timestamp)
    }
  )
  const time = (seconds) => new Date(1000 * seconds).toISOString()
  const state = {
    id: 'chat',
    events: [
      { type: 'user.message', id: 'first', timestamp: time(1) },
      { type: 'subagent.started', agentId: 'child', timestamp: time(2) },
      { type: 'user.message', id: 'second', timestamp: time(3) },
      { type: 'user.message', id: 'child-prompt', agentId: 'child', timestamp: time(4) }
    ]
  }
  instance.reportEventTokenUsage(state, {
    type: 'assistant.usage',
    id: 'event',
    agentId: 'child',
    timestamp: time(5),
    data: {
      model: 'model',
      copilotUsage: { totalNanoAiu: 100000000000 },
      inputTokens: 100,
      cacheReadTokens: 80,
      outputTokens: 30,
      reasoningTokens: 10,
      providerCallId: 'request'
    }
  })
  assert.equal(records[0].turnId, 'first')
  assert.equal(records[0].recordId, 'request')
  assert.equal(records[0].models[0].totalUSD, 1)
  assert.deepEqual(
    records[0].usage,
    normalizeTokenUsage(20, 80, 30),
    'reasoning is an output subset'
  )
  instance.reportEventTokenUsage(state, {
    type: 'assistant.usage',
    id: 'missing',
    timestamp: time(6),
    data: { model: 'model' }
  })
  assert.equal(records.length, 1, 'missing counters are not reported as zero usage')
})

test('OpenCode includes cache writes and separate reasoning, retaining request time and parent ID', () => {
  const { instance, records } = loadMethod(
    'opencode',
    'OpenCodeProviderAdapter',
    'reportMessageTokenUsage'
  )
  instance.states = new Map()
  instance.reportMessageTokenUsage(
    { id: 'chat' },
    {
      role: 'assistant',
      providerID: 'provider',
      modelID: 'model',
      cost: 2,
      id: 'request',
      parentID: 'user',
      time: { created: 123 },
      tokens: { input: 100, output: 20, reasoning: 10, cache: { read: 80, write: 30 } }
    }
  )
  assert.deepEqual(records[0].usage, normalizeTokenUsage(130, 80, 30))
  assert.equal(records[0].turnId, 'user')
  assert.equal(records[0].timestamp, 123)
  assert.equal(records[0].models[0].modelId, 'provider/model')
  assert.equal(records[0].models[0].totalUSD, 2)
})

test('the common reporter deduplicates repeated native snapshots but publishes growing usage', () => {
  const reporter = new TokenUsageReporter()
  const records = []
  reporter.subscribe((record) => records.push(record))
  const observation = {
    chatId: 'chat',
    sourceKey: 'host',
    turnId: 'turn',
    recordId: 'request',
    timestamp: 1,
    usage: normalizeTokenUsage(10, 0, 1)
  }
  reporter.report(observation)
  reporter.report({ ...observation, timestamp: 2 })
  reporter.report({ ...observation, usage: normalizeTokenUsage(10, 0, 2) })
  assert.equal(records.length, 2)
})
