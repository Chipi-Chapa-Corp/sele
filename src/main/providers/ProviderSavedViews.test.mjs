import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { restoreConversationView } from '../../shared/conversationView.ts'

const source = ts.createSourceFile(
  'providerService.ts',
  readFileSync(new URL('./providerService.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements
  .filter(ts.isVariableStatement)
  .flatMap((statement) => [...statement.declarationList.declarations])
  .find((node) => node.name.getText(source) === 'getProviderCachedChat')

const fixture = () => {
  let current = true
  let metadata = { done: false, purpose: null, pinned: true, container: { kind: 'host' } }
  const reads = []
  const scope = { key: 'saved', current: () => current }
  const view = {
    id: 'chat',
    title: 'Saved',
    createdAt: 1,
    updatedAt: 2,
    revision: -1,
    conversationView: true,
    capabilities: { editMessages: false, activeMessages: false },
    items: [{ id: 'answer', type: 'message', role: 'assistant', content: 'Saved response' }]
  }
  const context = vm.createContext({
    getChatMetadata: async () => metadata,
    restoreConversationView,
    knownConversationScopes: new Set(),
    persistentChatHistory: {
      viewScope: (_provider, _id, container) => {
        reads.push(container)
        return scope
      },
      preview: async () => null
    },
    durableConversationViews: {
      read: async (scopes) => {
        assert.equal(scopes.length, 1)
        return new Map([['saved', view]])
      }
    }
  })
  const read = vm.runInContext(
    ts.transpile(`(${declaration.initializer.getText(source)})`, {
      target: ts.ScriptTarget.ES2022
    }),
    context
  )
  return {
    read,
    reads,
    invalidate: () => {
      current = false
    },
    setMetadata: (value) => {
      metadata = { ...metadata, ...value }
    }
  }
}

test('opening reads only the selected durable view without hydrating provider history', async () => {
  const h = fixture()
  const container = { kind: 'container', tool: 'ssh', name: 'remote' }
  const preview = await h.read('codex', 'chat', { container })
  assert.equal(h.reads[0], container)
  assert.equal(preview.items[0].content, 'Saved response')
  assert.equal(preview.historyPreview, true)
  assert.equal(preview.conversationView, true)
  assert.equal(preview.pinned, true, 'apply the current local metadata')
  assert.equal(preview.writeAccess, 'checking', 'a saved view cannot grant provider ownership')
})

test('archived chats and invalidated account scopes cannot revive a saved view', async () => {
  const h = fixture()
  h.setMetadata({ done: true })
  assert.equal(await h.read('codex', 'chat'), null)
  assert.equal(h.reads.length, 0)
  h.setMetadata({ done: false })
  h.invalidate()
  assert.equal(await h.read('codex', 'chat'), null)
})
