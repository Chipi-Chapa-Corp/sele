import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = ts.createSourceFile(
  'adapter.ts',
  readFileSync(new URL('./CodexProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)

test('edited turns send the selected model and the app-server effort field', () => {
  const declaration = source.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (entry) => entry.name.getText(source) === 'getTurnModelOptions'
      )
  )
  const options = vm.runInNewContext(
    ts.transpile(
      `${declaration.getText(source)}; getTurnModelOptions({ model: 'gpt-6-sol', reasoningEffort: 'high', serviceTier: null })`,
      {
        target: ts.ScriptTarget.ES2022
      }
    )
  )

  assert.deepEqual({ ...options }, { model: 'gpt-6-sol', effort: 'high', serviceTier: null })
})

test('resuming for an edit updates the thread model before the replacement turn starts', async () => {
  const adapterClass = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === 'CodexProviderAdapter'
  )
  const method = adapterClass.members.find((node) => node.name?.getText(source) === 'resumeThread')
  const adapter = vm.runInNewContext(
    ts.transpile(`class Adapter { ${method.getText(source)} }; new Adapter()`, {
      target: ts.ScriptTarget.ES2022
    }),
    {
      getRecommendedPluginsConfig: () => ({}),
      getThreadAccessOptions: () => ({}),
      assertSupportedCodexHistory: () => {},
      getThreadName: () => null
    }
  )
  let resumeParams
  const thread = { id: 'chat', historyMode: 'paginated', turns: [], createdAt: 1, cwd: null }
  Object.assign(adapter, {
    threads: new Map([['chat', thread]]),
    client: {
      request: async (_method, params) => {
        resumeParams = params
        return { thread }
      }
    },
    externallyOwnedThreadIds: new Set(),
    paginatedTurnCatalogs: new Map(),
    resolveThreadCwd: async () => null,
    resolveThreadName: async () => null,
    cacheThread: () => {}
  })

  await adapter.resumeThread('chat', { model: 'gpt-6-sol', serviceTier: null }, null, 'edit')
  assert.equal(resumeParams.model, 'gpt-6-sol')
  assert.equal(resumeParams.serviceTier, null)
})

test('editing a steering message replays the original prompt before revised steering', async () => {
  const adapterClass = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === 'CodexProviderAdapter'
  )
  const method = adapterClass.members.find(
    (node) => node.name?.getText(source) === 'editMessageInContext'
  )
  const requests = []
  const steering = []
  const originalInput = [{ type: 'text', text: 'Original prompt' }]
  const thread = {
    id: 'chat',
    historyMode: 'paginated',
    turns: [
      {
        id: 'turn',
        status: 'completed',
        items: [
          { id: 'initial', type: 'userMessage', content: originalInput },
          { id: 'steering', type: 'userMessage', content: [{ type: 'text', text: 'Old steering' }] }
        ]
      }
    ]
  }
  const adapter = vm.runInNewContext(
    ts.transpile(`class Adapter { ${method.getText(source)} }; new Adapter()`, {
      target: ts.ScriptTarget.ES2022
    }),
    {
      assertSupportedCodexHistory: () => {},
      hasAttachmentInput: () => false,
      hasCodexUserInputAttachments: () => false,
      getUserInputContent: (input) => input.map((item) => item.text).join('\n'),
      loadCodexTurnCatalog: async () => thread.turns,
      assertCodexTurnCatalogDidNotRegress: () => {},
      planCodexHistoryEdit: () => ({ retainedCatalog: [], rolledBackTurnIds: new Set(['turn']) }),
      rendererChatUpdateTurnLimit: 100,
      deleteCodexSubmittedMessagesForTurns: async () => {},
      createUserInput: (text) => [{ type: 'text', text }],
      getTurnModelOptions: (options) => ({ model: options.model }),
      getTurnAccessOptions: () => ({})
    }
  )
  Object.assign(adapter, {
    threads: new Map([['chat', thread]]),
    paginatedTurnCatalogs: new Map(),
    pausedQueuedTurnThreads: new Set(),
    rememberThreadContainer() {},
    resumeThread: async () => thread,
    stopActiveTurn: async () => {},
    filterRolledBackTurns: (_chat, turns) => turns,
    client: {
      request: async (method, params) => {
        requests.push({ method, params })
        return method === 'thread/revert' ? { thread } : { turn: { id: 'replacement' } }
      }
    },
    resolveThreadCwd: async () => null,
    resolveThreadName: async () => null,
    rememberRolledBackTurns() {},
    cacheThread() {},
    addSubmittedPendingTurn: async () => ({ id: 'pending' }),
    emitChatUpdated() {},
    startSubmittedCodexTurn: async (_chat, _pending, start) => start(),
    steerActiveChat: async (_chat, text) => {
      steering.push(text)
    },
    getCachedChatDetail: () => ({ id: 'chat' })
  })

  await adapter.editMessageInContext('chat', 'turn:steering', 'Revised steering', {
    model: 'gpt-6-sol'
  })

  assert.equal(requests[0].method, 'thread/revert')
  assert.equal(requests[1].method, 'turn/start')
  assert.equal(requests[1].params.input, originalInput)
  assert.equal(requests[1].params.model, 'gpt-6-sol')
  assert.deepEqual(steering, ['Revised steering'])
})
