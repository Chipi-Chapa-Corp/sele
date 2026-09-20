import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

// Execute the actual adapter method with only transport and state dependencies isolated.
const source = ts.createSourceFile('adapter.ts', readFileSync(new URL('./CodexProviderAdapter.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CodexProviderAdapter')
const method = declaration.members.find(node => node.name?.getText(source) === 'steerActiveChat')
const code = ts.transpile(`class Adapter { ${method.getText(source)} }; new Adapter()`, { target: ts.ScriptTarget.ES2022 })

test('steering reaches an active turn even after a completed final-tagged message', async () => {
  const adapter = vm.runInNewContext(code)
  const processed = []
  Object.assign(adapter, {
    ensureChatTailLoaded: async () => {},
    getActiveTurnId: () => 'turn',
    threads: new Map([['chat', { turns: [{ id: 'turn', items: [{ type: 'agentMessage', phase: 'final_answer', status: 'completed' }] }] }]]),
    hasPendingSteeringMessage: () => false,
    addWaitingSteeringMessage: (chat, turn, text) => ({ id: 'steer', text }),
    emitChatUpdated: () => {},
    processWaitingSteeringMessage: async (...args) => { processed.push(args) },
    getCachedChatDetail: () => ({ id: 'chat' }),
    queueChatMessage: () => assert.fail('active steering must not silently requeue')
  })
  await adapter.steerActiveChat('chat', 'The audit is done')
  assert.deepEqual(processed, [['chat', 'steer']])
})
