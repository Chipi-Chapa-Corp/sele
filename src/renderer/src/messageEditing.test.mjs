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

test('optimistic user messages have no editable provider identity', () => {
  const utils = ts.createSourceFile(
    'utils.tsx',
    readFileSync(new URL('./workspace/chatControllerUtils.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const statement = utils.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (entry) => entry.name.getText(utils) === 'getOptimisticItems'
      )
  )
  const items = vm.runInNewContext(
    ts.transpile(
      `${statement.getText(utils).replace('export ', '')}; getOptimisticItems([], 'Hello')`,
      {
        target: ts.ScriptTarget.ES2022
      }
    ),
    { optimisticChatItemIdPrefix: 'optimistic:' }
  )
  assert.equal(items[0].editTargetId, null)
  assert.equal(items[1].status, 'working')
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
        configProviderId: 'codex',
        authenticationRequired: false,
        chatDetailRef: { current: null },
        pendingEditRef: { current: null },
        providerUpdateInProgress: false,
        activeSubagentChatView: null,
        sendInFlightRef: { current: false },
        sendInFlightProjectKeyRef: { current: null },
        selectedChat: { id: 'chat', providerId: 'codex' },
        changesProjectCwd: '/repo',
        getChatCwdGroupKey: (cwd) => cwd,
        getChatGroupKey: () => '/repo',
        getChatProjectCwd: () => '/repo',
        setSendInFlightProjectKey() {},
        chatAutoScrollEnabledRef: { current: false },
        setChatAtConversationBottom() {},
        scrollToLatestTurnAfterRenderRef: { current: false },
        serializeComposerMessage: (message) => message,
        normalizeTurnOptionsForModels: (options) => options,
        getCurrentTurnOptions: () => ({ model: 'test' }),
        editingMessage: {
          type,
          id: 'pending-id',
          targetId: 'server-turn',
          editId: type === 'pending' ? 'edit' : undefined
        },
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
      if (type === 'pending') assert.equal(packet.args[5], 'edit')
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

const pendingEditFixture = () => {
  const calls = []
  let editingMessage = null
  const pending = { type: 'pendingMessage', id: 'pending', kind: 'steering', content: 'original' }
  const globals = {
    useCallback: (callback) => callback,
    crypto: { randomUUID: () => 'edit' },
    editOpeningRef: { current: false },
    editRequestRef: { current: 0 },
    pendingEditRef: { current: null },
    selectedChat: { id: 'chat', providerId: 'copilot' },
    selectedChatKeyRef: { current: 'copilot:chat' },
    changesContainer: null,
    changesCwd: '/repo',
    sendInFlightRef: { current: false },
    setSendState() {},
    applyViewedChatDetail() {},
    setEditingMessage: (message) => {
      editingMessage = message
    },
    handleSendFailure: (error) => calls.push(['error', error.message]),
    console,
    appApi: {
      prepareMessageAttachments: async () => {
        calls.push(['attachments'])
        return []
      }
    },
    providerApi: {
      beginPendingMessageEdit: async (...args) => {
        calls.push(['begin', ...args])
        return { id: 'chat', items: [pending] }
      },
      cancelPendingMessageEdit: async (...args) => {
        calls.push(['cancel', ...args])
        return { id: 'chat', items: [pending] }
      }
    }
  }
  const controller = vm.runInNewContext(
    `${code(['releasePendingEdit', 'prepareEditAttachments', 'handleEditPendingMessage', 'handleCancelEditMessage'])}; ({edit: handleEditPendingMessage, cancel: handleCancelEditMessage})`,
    globals
  )
  return {
    globals,
    calls,
    pending,
    controller,
    get editingMessage() {
      return editingMessage
    }
  }
}

test('pending edit acquires a hold before loading attachments and passes its token to cancel', async () => {
  const f = pendingEditFixture()
  await f.controller.edit(f.pending)
  assert.deepEqual(f.calls, [['begin', 'copilot', 'chat', 'pending', 'edit'], ['attachments']])
  assert.equal(f.editingMessage.id, 'pending')
  assert.equal(f.editingMessage.editId, 'edit')
  await f.controller.cancel()
  assert.deepEqual(f.calls[2], ['cancel', 'copilot', 'chat', 'pending', 'edit'])
  assert.equal(f.editingMessage, null)
  assert.equal(f.globals.pendingEditRef.current, null)
})

test('an edit that loses the race to provider acceptance never opens the editor', async () => {
  const f = pendingEditFixture()
  f.globals.providerApi.beginPendingMessageEdit = async () => {
    f.calls.push(['begin'])
    return { id: 'chat', items: [{ ...f.pending, editable: false }] }
  }
  await f.controller.edit(f.pending)
  assert.deepEqual(
    f.calls.map((call) => call[0]),
    ['begin', 'cancel'],
    'a doomed editor is released instead of shown'
  )
  assert.equal(f.editingMessage, null)
  assert.equal(f.globals.pendingEditRef.current, null)
})

test('attachment failure releases the backend hold and leaves the editor closed', async () => {
  const f = pendingEditFixture()
  f.globals.appApi.prepareMessageAttachments = async () => {
    throw new Error('attachment missing')
  }
  f.globals.console = { error() {} }
  await f.controller.edit(f.pending)
  assert.ok(f.calls.some((call) => call[0] === 'cancel'))
  assert.equal(f.editingMessage, null)
  assert.equal(f.globals.pendingEditRef.current, null)
})
