import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = ts.createSourceFile(
  'application.ts',
  readFileSync(new URL('./application.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const beforeQuit = source.statements.find(
  (node) =>
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(source) === 'app.on' &&
    node.expression.arguments[0]?.text === 'before-quit'
)
assert.ok(beforeQuit)
const code = ts.transpileModule(
  `let finishingQuit = false; let quitReady = false; ${beforeQuit.getText(source)}`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText

test('a failed pending-message durability barrier still finishes every shutdown cleanup', async () => {
  const calls = []
  let handler
  vm.runInNewContext(code, {
    app: {
      on: (_event, listener) => {
        handler = listener
      },
      quit: () => calls.push('quit')
    },
    beginProviderIpcShutdown: () => calls.push('ipc'),
    disposeTerminalSessions: () => calls.push('terminals'),
    stopLocalAccess: async () => {
      calls.push('local')
    },
    disposeProviderAdapters: async () => {
      calls.push('providers')
      throw new Error('pending queue could not be saved')
    },
    stopPtys: async () => {
      calls.push('ptys')
    },
    stopModelPricingRefresh: async () => {
      calls.push('pricing')
    },
    flushTokenUsage: async () => {
      calls.push('usage')
    },
    bufferedCommands: {
      dispose: async () => {
        calls.push('commands')
      }
    },
    console: { error: (_message, error) => calls.push(error.message) }
  })
  let prevented = 0
  const event = {
    preventDefault: () => {
      prevented++
    }
  }
  handler(event)
  handler(event)
  await new Promise(setImmediate)
  assert.deepEqual(calls, [
    'ipc',
    'terminals',
    'local',
    'providers',
    'ptys',
    'pricing',
    'usage',
    'commands',
    'pending queue could not be saved',
    'quit'
  ])
  assert.equal(prevented, 2)
  handler(event)
  assert.equal(prevented, 2, 'final quit passes the completed shutdown barrier')
})

test('failed queue flush still saves final conversation views and releases history resources', async () => {
  const file = ts.createSourceFile(
    'providerService.ts',
    readFileSync(new URL('./providers/providerService.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  let operation
  const find = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'disposeProviderAdapters')
      operation = node.initializer.getText(file)
    ts.forEachChild(node, find)
  }
  find(file)
  assert.ok(operation)
  const calls = []
  const pending = new Map([['chat', { timer: 'timer', scope: 'scope', detail: 'detail' }]])
  const dispose = vm.runInNewContext(
    ts.transpileModule(`(${operation})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText,
    {
      backgroundChatRecovery: { dispose: () => calls.push('recovery') },
      limitResetQueue: {
        close: async () => {
          calls.push('reset')
        }
      },
      adapters: {
        codex: {
          dispose: async () => {
            calls.push('adapter')
          }
        }
      },
      flushPersistentPendingMessages: async () => {
        throw new Error('disk failure')
      },
      pendingConversationViews: pending,
      clearTimeout: (id) => calls.push(id),
      saveProviderConversationView: async (scope, detail) => {
        calls.push([scope, detail])
      },
      conversationViewWrites: [],
      persistentChatHistory: { dispose: () => calls.push('history') }
    }
  )
  await assert.rejects(dispose(), /disk failure/)
  assert.deepEqual(calls, ['recovery', 'reset', 'adapter', 'timer', ['scope', 'detail'], 'history'])
  assert.equal(pending.size, 0)
})
