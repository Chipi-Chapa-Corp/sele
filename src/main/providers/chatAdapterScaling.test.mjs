import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import * as claude from './claude/ClaudeItemRenderers.ts'
import * as copilot from './copilot/CopilotItemRenderers.ts'
import * as opencode from './opencode/OpenCodeItemRenderers.ts'
import * as codex from './codex/CodexItemRenderers.ts'
import { getCodexTurnSubagents } from './codex/CodexSubagents.ts'
import { getProviderChatTurnCount, sliceProviderChatTurns } from '../../shared/chatTurns.ts'

// Execute the real adapter navigation/detail methods, isolating only session transport and
// unrelated metadata. This also tests the service's pre-existing getChat fallback on old code.
const harness = (provider, name, globals, state) => {
  const source = ts.createSourceFile(`${name}ProviderAdapter.ts`, readFileSync(new URL(`./${provider}/${name}ProviderAdapter.ts`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === `${name}ProviderAdapter`)
  const selected = new Set(['getChat', 'getChatWindow', 'createChatDetail', 'createChatDetailFromState'])
  const code = ts.transpileModule(`class Harness { ${declaration.members.filter(member => selected.has(member.name?.getText(source))).map(member => member.getText(source)).join('\n')} }; globalThis.Harness = Harness`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const context = vm.createContext({ ...globals, getPendingApproval: () => null, getPendingUserInput: () => null, getContextUsage: () => null })
  vm.runInContext(code, context)
  const instance = new context.Harness()
  Object.assign(instance, {
    ensureState: async () => state, ensureSession: async () => state,
    loadEvents: async () => {}, getClientEntry: async () => ({ client: {} }), refreshState: async () => {},
    getDrainingMessage: () => null, getPendingMessages: () => [],
    getTitle: () => 'Saved title', getCwd: () => '/tmp', getChatStatus: () => null,
    getPendingApproval: () => null, getPendingUserInput: () => null, getContextUsage: () => null,
    transcriptProjections: new Map(), eventStores: new WeakMap()
  })
  return instance
}
const state = () => ({ id: 'chat', revision: 0, createdAt: 0, active: false, stopped: false, failed: false, partialMessages: new Map(), pendingUserInputs: [], pendingApprovals: [], pendingPermissions: [], pendingQuestions: [], pendingMessages: [], queuedMessages: [], directory: '/tmp', session: { id: 'chat', title: 'Saved title', time: { created: 0 } } })
for (const [provider, name, globals] of [['claude', 'Claude', claude], ['copilot', 'Copilot', copilot], ['opencode', 'OpenCode', opencode]]) {
  test(`${provider}: actual adapter navigation reads only the requested assistant payloads`, async () => {
    let visits = 0
    const records = Array.from({ length: 2000 }, (_, i) => {
      if (provider === 'claude') return [
        { type: 'user', uuid: `u${i}`, message: { content: 'prompt' }, parent_tool_use_id: null },
        { type: 'assistant', uuid: `a${i}`, parent_tool_use_id: null, get message() { visits++; return { content: [{ type: 'text', text: 'answer' }] } } }
      ]
      if (provider === 'copilot') return [
        { type: 'user.message', id: `u${i}`, data: { content: 'prompt' } },
        { type: 'assistant.message', id: `a${i}`, data: { messageId: `a${i}`, get content() { visits++; return 'answer' } } }
      ]
      return [
        { info: { role: 'user', id: `u${i}`, time: { created: 0 } }, parts: [{ type: 'text', text: 'prompt' }] },
        { info: { role: 'assistant', id: `a${i}`, time: { created: 0 } }, get parts() { visits++; return [{ id: `p${i}`, type: 'text', text: 'answer' }] } }
      ]
    }).flat()
    const current = { ...state(), messages: records, events: records }
    const adapter = harness(provider, name, globals, current)
    for (const startIndex of [1990, 20]) {
      visits = 0
      const detail = adapter.getChatWindow
        ? await adapter.getChatWindow('chat', { startIndex, limit: 10 })
        : await adapter.getChat('chat')
      assert.ok(visits <= 100, `adapter read ${visits} assistant payloads for ten turns`)
      assert.equal(detail.itemsStartTurnIndex, startIndex)
      assert.equal(detail.turnCount, 2000)
      assert.equal(getProviderChatTurnCount(detail.items), 10)
      assert.equal(detail.items[0].id, `u${startIndex}`)
    }
  })
}

test('codex: actual detail construction reuses an unchanged active turn', () => {
  let visits = 0
  const turn = { id: 'turn', status: 'inProgress', items: [
    { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'prompt' }] },
    ...Array.from({ length: 2000 }, (_, i) => ({ id: `t${i}`, type: 'commandExecution', status: 'completed', aggregatedOutput: '', get command() { visits++; return 'ls' } }))
  ] }
  const thread = { id: 'chat', createdAt: 0, turns: [turn] }
  const adapter = harness('codex', 'Codex', {
    ...codex, getCodexTurnSubagents, assertReadableCodexHistory: () => {}, getThreadApiCwd: () => '/tmp',
    isLegacyCodexHistory: () => false, getThreadTitle: () => 'Saved title', getHydratedThreadStatus: () => 'active', codexCapabilities: {}
  }, thread)
  Object.assign(adapter, {
    getRenderableTurns: thread => thread.turns, getProviderPendingMessages: () => [], getProviderPendingApproval: () => null,
    externallyOwnedThreadIds: new Set(), writeAccessChecks: new Map(), threadRevisions: new Map(), pendingTurnStarts: new Set(), pendingTurnIds: new Map(), threadContainers: new Map(), contextUsageByThread: new Map(), goals: new Map()
  })
  const first = adapter.createChatDetail(thread)
  visits = 0
  const second = adapter.createChatDetail(thread)
  assert.equal(visits, 0, 'opening the same working section must reuse the native conversion')
  assert.deepEqual(second.items, first.items)
  assert.equal(sliceProviderChatTurns(second.items, 0, 1).length, first.items.length)
})
