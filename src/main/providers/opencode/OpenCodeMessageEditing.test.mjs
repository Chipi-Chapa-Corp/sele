import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const source = ts.createSourceFile(
  'adapter.ts',
  readFileSync(new URL('./OpenCodeProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (n) => ts.isClassDeclaration(n) && n.name.text === 'OpenCodeProviderAdapter'
)
const method = declaration.members.find((n) => n.name?.getText(source) === 'editMessage')
const code = ts.transpileModule(
  `class Harness {${method.getText(source)}};globalThis.Harness=Harness`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText
const user = (id) => ({ info: { id, role: 'user' }, parts: [{ type: 'text', text: id }] })
function fixture() {
  const calls = []
  const context = vm.createContext({ requireData: (r) => r.data })
  vm.runInContext(code, context)
  const state = {
    id: 'chat',
    container: null,
    directory: '/fixture',
    session: { id: 'chat' },
    messages: [user('first'), user('last')],
    queuePaused: false,
    historyPagination: { kind: 'cursor', olderCursor: 'older', newerCursor: null },
    historyInvalidationRevision: 0
  }
  const client = {
    session: {
      message: async (p) => {
        calls.push(['message', p.messageID])
        return { data: user(p.messageID) }
      },
      revert: async (p) => {
        calls.push(['revert', p.messageID])
        assert.equal(state.queuePaused, true)
      }
    }
  }
  const adapter = Object.assign(new context.Harness(), {
    ensureState: async () => state,
    getClientEntry: async () => ({ client }),
    loadMessages: async () => {
      throw Error('Editing must not read all history')
    },
    abortState: async () => {
      calls.push(['abort'])
      assert.equal(state.queuePaused, true)
    },
    sendPrompt: async (_s, text) => {
      calls.push(['send', text])
      state.queuePaused = false
    },
    createChatDetail: () => ({ id: state.id, items: state.messages })
  })
  return { adapter, state, client, calls }
}
test('editing a visible message keeps its prefix, resets history boundaries and never loads the full transcript', async () => {
  const f = fixture()
  await f.adapter.editMessage('chat', 'last', 'replacement')
  assert.deepEqual(f.calls, [['abort'], ['revert', 'last'], ['send', 'replacement']])
  assert.deepEqual(
    f.state.messages.map((m) => m.info.id),
    ['first']
  )
  assert.equal(f.state.messagesDirty, true)
  assert.equal(f.state.historyPagination.olderCursor, null)
})
test('editing an older paginated message fetches exactly that message', async () => {
  const f = fixture()
  await f.adapter.editMessage('chat', 'older-message', 'replacement')
  assert.deepEqual(f.calls, [
    ['message', 'older-message'],
    ['abort'],
    ['revert', 'older-message'],
    ['send', 'replacement']
  ])
  assert.equal(
    f.state.messages.length,
    0,
    'discard the old branch before accepting streamed replacements'
  )
})
test('failed edits restore the queue pause state and leave the retained branch intact', async () => {
  const f = fixture()
  f.client.session.revert = async () => {
    throw Error('Fixture conflict')
  }
  const messages = f.state.messages
  await assert.rejects(f.adapter.editMessage('chat', 'last', 'replacement'), /Fixture conflict/)
  assert.equal(f.state.queuePaused, false)
  assert.equal(f.state.messages, messages)
  assert.equal(
    f.calls.some((c) => c[0] === 'send'),
    false
  )
})
