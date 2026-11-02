import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { mergeSeenUpdatedAt } from './chatMetadata.ts'

const load = (path, name, context) => {
  const file = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const declaration = file.statements
    .filter(ts.isVariableStatement)
    .flatMap((node) => [...node.declarationList.declarations])
    .find((node) => node.name.getText(file) === name)
  return vm.runInContext(
    ts.transpile(`(${declaration.initializer.getText(file)})`, { target: ts.ScriptTarget.ES2022 }),
    context
  )
}

test('delayed detail and metadata snapshots keep read chats read while new replies become unread', () => {
  const context = vm.createContext({
    getChatPreview: (detail) => detail.items.at(-1)?.content,
    mergeSeenUpdatedAt,
    getLastTurnOutcome: () => 'failed',
    getChatUpdateActivity: () => null,
    truncateChatUpdateText: (value) => value,
    chatUpdatePreviewLimit: 500,
    arePendingApprovalsEqual: (a, b) => a === b,
    areContainerTargetsEqual: (a, b) => a === b
  })
  const fromDetail = load('./workspace/chatControllerUtils.tsx', 'getChatFromDetail', context)
  const fromSummary = load(
    './workspace/chatControllerUtils.tsx',
    'getChatFromUpdateSummary',
    context
  )
  const summary = load('../../main/providers/providerService.ts', 'getChatUpdateSummary', context)
  const detail = {
    id: 'read-chat',
    createdAt: 1000,
    updatedAt: 3000,
    seenUpdatedAt: 4000,
    status: null,
    lastTurnOutcome: 'failed',
    items: [{ type: 'message', content: 'Already read reply' }]
  }
  let chat = fromDetail('codex', detail, null, 5000)
  assert.equal(chat.updatedAt, 3000)
  for (const receivedAt of [6000, 7000, 8000]) {
    // Metadata and read-marker responses can arrive after the user leaves the chat.
    const refreshed = { ...detail, pinned: true, seenUpdatedAt: 3500 }
    const update = summary(refreshed, receivedAt)
    assert.equal(update.updatedAt, 3000)
    chat = fromSummary('codex', update, chat, false)
    assert.equal(chat.seenUpdatedAt, 4000)
    assert.ok(chat.updatedAt <= chat.seenUpdatedAt)
    chat = fromDetail('codex', refreshed, chat, receivedAt)
    assert.equal(chat.seenUpdatedAt, 4000)
    assert.ok(chat.updatedAt <= chat.seenUpdatedAt)
  }
  chat = fromSummary('codex', summary({ ...detail, updatedAt: 9000 }, 10000), chat, true)
  assert.equal(chat.updatedAt, 9000)
  assert.ok(chat.updatedAt > chat.seenUpdatedAt)

  const { updatedAt: _updatedAt, ...legacyDetail } = detail
  assert.equal(summary(legacyDetail, 12000).updatedAt, 12000)
  assert.equal(fromDetail('claude', legacyDetail, null, 12000).updatedAt, 12000)
})

test('committed views save the viewing time; delayed older turns stay read and later turns are unread', () => {
  const path = './workspace/useWorkspaceSelection.tsx'
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const code = new Map()
  let effect
  let dependencyCode
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'renderedChatUpdatedAt')
      code.set(node.name.getText(source), node.initializer.getText(source))
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === 'useEffect' &&
      node.arguments[0]?.getText(source).includes('renderedChatUpdatedAt')
    ) {
      effect = node.arguments[0].getText(source)
      dependencyCode = node.arguments[1].getText(source)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.equal(code.size, 1)
  assert.ok(effect)
  const seen = []
  let now = 1000
  const context = vm.createContext({
    Date: class extends Date {
      static now() {
        return now
      }
    },
    selectedChat: { id: 'chat', providerId: 'codex', updatedAt: 100, seenUpdatedAt: null },
    selectedChatKey: 'codex:chat',
    selectedProviderId: 'codex',
    selectedChatId: 'chat',
    chatDetail: null,
    latestCommitFinishedAtByChatKey: new Map(),
    markChatSeenAt: (...args) => seen.push(args)
  })
  let previousDependencies
  const render = () => {
    for (const [name, initializer] of code)
      context[name] = vm.runInContext(
        ts.transpile(`(${initializer})`, { target: ts.ScriptTarget.ES2022 }),
        context
      )
    const dependencies = vm.runInContext(dependencyCode, context)
    if (previousDependencies?.every((value, index) => Object.is(value, dependencies[index])))
      return () => {}
    previousDependencies = dependencies
    return vm.runInContext(ts.transpile(`(${effect})`, { target: ts.ScriptTarget.ES2022 }), context)
  }
  render()()
  assert.deepEqual(seen, [], 'a loader has no readable transcript')
  context.chatDetail = { id: 'other', updatedAt: 200 }
  render()()
  assert.deepEqual(seen, [], 'a retained transcript for another chat does not count')
  context.chatDetail = { id: 'chat', updatedAt: 200 }
  const commit = render()
  assert.deepEqual(seen, [], 'rendering alone cannot persist before the effect commits')
  commit()
  assert.deepEqual(seen.pop(), ['codex', 'chat', 1000])
  context.selectedChat.seenUpdatedAt = 1000
  render()()
  assert.deepEqual(seen, [], 'read-marker feedback does not produce another write')
  now = 1100
  context.selectedChat.updatedAt = 300
  render()()
  assert.deepEqual(seen.pop(), ['codex', 'chat', 1100], 'a late sidebar update is seen')
  context.selectedChat.seenUpdatedAt = 1100
  now = 1200
  context.latestCommitFinishedAtByChatKey.set('claude:chat', 900)
  context.latestCommitFinishedAtByChatKey.set('codex:chat', 400)
  render()()
  assert.deepEqual(seen.pop(), ['codex', 'chat', 1200], 'viewed commit results are read')
  context.selectedChat.seenUpdatedAt = 1200
  context.selectedChat.title = 'Renamed'
  render()()
  assert.deepEqual(seen, [], 'unrelated renders do not keep writing the current time')

  const chat = context.selectedChat
  context.selectedChat = null
  context.selectedChatId = undefined
  context.selectedProviderId = undefined
  render()()
  for (const updatedAt of [300, 1100, 1200]) {
    assert.ok(updatedAt <= chat.seenUpdatedAt, 'delayed old turns remain read after departure')
  }
  assert.ok(1201 > chat.seenUpdatedAt, 'a turn completed after the last viewing is unread')
  assert.deepEqual(seen, [], 'departed views do not acknowledge new turns')
})
