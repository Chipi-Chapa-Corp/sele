import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = ts.createSourceFile(
  'controller.tsx',
  readFileSync(new URL('./workspace/useChatMessagingController.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
const declarations = new Map()
const visit = (node) => {
  if (ts.isVariableDeclaration(node))
    declarations.set(node.name.getText(source), node.getText(source))
  ts.forEachChild(node, visit)
}
visit(source)
const code = (names) =>
  ts.transpile(names.map((name) => `const ${declarations.get(name)}`).join('\n'), {
    target: ts.ScriptTarget.ES2022
  })

for (const type of ['message', 'pending']) {
  for (const attachments of [
    [],
    [
      { kind: 'image', path: '/one.png' },
      { kind: 'image', path: '/two.png' }
    ]
  ]) {
    test(`${type} edits pass the exact ${attachments.length}-image replacement set through the controller`, async () => {
      let packet
      const providerApi = Object.fromEntries(
        ['editMessage', 'editPendingMessage'].map((method) => [
          method,
          async (...args) => {
            packet = { method, args }
            return { id: 'chat' }
          }
        ])
      )
      const globals = {
        providerUpdateInProgress: false,
        activeSubagentChatView: null,
        sendInFlightRef: { current: false },
        sendInFlightProjectKeyRef: { current: null },
        selectedChat: { id: 'chat', providerId: 'codex' },
        changesProjectCwd: '/repo',
        getChatCwdGroupKey: (cwd) => cwd,
        getChatProjectCwd: () => '/repo',
        setSendInFlightProjectKey() {},
        chatAutoScrollEnabledRef: { current: false },
        setChatAtConversationBottom() {},
        scrollToLatestTurnAfterRenderRef: { current: false },
        serializeComposerMessage: (message) => message,
        normalizeTurnOptionsForModels: (options) => options,
        getCurrentTurnOptions: () => ({ model: 'test' }),
        editingMessage: { type, id: 'pending-id', targetId: 'server-turn' },
        setSendState() {},
        providerApi,
        applyViewedChatDetail() {},
        setEditingMessage() {},
        handleSendFailure: (error) => {
          throw error
        },
        console
      }
      const send = vm.runInNewContext(`${code(['handleSendMessage'])}; handleSendMessage`, globals)
      assert.equal(await send(attachments.length ? '' : 'caption', undefined, attachments), true)
      assert.equal(packet.method, type === 'pending' ? 'editPendingMessage' : 'editMessage')
      assert.equal(packet.args[2], type === 'pending' ? 'pending-id' : 'server-turn')
      assert.deepEqual(
        Array.from(packet.args[4].images, (image) => image.path),
        attachments.map((image) => image.path)
      )
      assert.equal(packet.args[4].files.length, 0)
      assert.equal(globals.sendInFlightRef.current, false)
    })
  }
}

test('opening an edit prepares all transcript attachments and ignores a stale load after navigation', async () => {
  let finish
  let session
  const refs = { current: 'codex:chat' }
  const globals = {
    useCallback: (callback) => callback,
    editRequestRef: { current: 0 },
    selectedChatKeyRef: refs,
    changesContainer: null,
    changesCwd: '/repo',
    appApi: {
      prepareMessageAttachments: () =>
        new Promise((resolve) => {
          finish = resolve
        })
    },
    chatDetail: { capabilities: { editMessages: true } },
    sendInFlightRef: { current: false },
    setSendState() {},
    setEditingMessage: (next) => {
      session = next
    },
    handleSendFailure: (error) => {
      throw error
    },
    console
  }
  const edit = vm.runInNewContext(
    `${code(['prepareEditAttachments', 'handleEditMessage'])}; handleEditMessage`,
    globals
  )
  const original = [{ kind: 'image', path: '/one.png', dataUrl: 'data:image/png;base64,abc' }]
  const message = {
    id: 'rendered',
    role: 'user',
    editTargetId: 'turn',
    content: '',
    attachments: original
  }
  const opening = edit(message)
  finish(original)
  await opening
  assert.equal(session.attachments, original)
  assert.equal(session.targetId, 'turn')
  session = null
  const stale = edit(message)
  refs.current = 'codex:other'
  finish(original)
  await stale
  assert.equal(session, null)
})
