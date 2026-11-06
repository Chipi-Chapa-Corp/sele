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
  context.areChatsEqual = load('./workspace/chatControllerUtils.tsx', 'areChatsEqual', context)
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
    if (
      ts.isVariableDeclaration(node) &&
      ['renderedChatUpdatedAt', 'renderedChatReadRevision'].includes(node.name.getText(source))
    )
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
  assert.equal(code.size, 2)
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

  context.chatDetail = { id: 'chat', updatedAt: 1300, status: 'active' }
  now = 1300
  render()()
  assert.deepEqual(seen.pop(), ['codex', 'chat', 1300])
  for (let timestamp = 1400; timestamp < 2000; timestamp += 100) {
    now = timestamp
    context.chatDetail.updatedAt = timestamp
    render()()
  }
  assert.deepEqual(seen, [], 'active tokens do not write and republish read metadata every frame')
  now = 2001
  context.chatDetail.updatedAt = now
  render()()
  assert.deepEqual(seen.pop(), ['codex', 'chat', 2001])
  now = 2100
  context.chatDetail = { id: 'chat', updatedAt: now, status: null }
  render()()
  assert.deepEqual(
    seen.pop(),
    ['codex', 'chat', 2100],
    'completion immediately records the final activity'
  )

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

test('active transcript chunks preserve sidebar identity; status, title, account and completion publish immediately', () => {
  const context = vm.createContext({
    getChatPreview: (detail) => detail.items.at(-1)?.content,
    mergeSeenUpdatedAt,
    arePendingApprovalsEqual: (a, b) => a === b,
    areContainerTargetsEqual: (a, b) => a === b,
    isActiveChatStatus: (status) => status === 'active'
  })
  for (const name of ['getChatFromDetail', 'getChatFromUpdateSummary', 'areChatsEqual'])
    context[name] = load('./workspace/chatControllerUtils.tsx', name, context)
  const project = load('./workspace/chatControllerUtils.tsx', 'getChatSidebarMetadata', context)
  const detail = {
    id: 'chat',
    title: 'Chat',
    accountId: 'one',
    createdAt: 1,
    updatedAt: 100,
    status: 'active',
    pendingApproval: null,
    items: [{ type: 'message', content: 'First' }]
  }
  const initial = project('codex', detail, null, 100)
  for (let i = 0; i < 100; i++)
    assert.equal(
      project(
        'codex',
        { ...detail, updatedAt: 200 + i, items: [{ type: 'message', content: 'Chunk ' + i }] },
        initial,
        300 + i
      ),
      initial
    )
  assert.equal(project('codex', { ...detail, title: 'Renamed' }, initial, 400).title, 'Renamed')
  assert.equal(project('codex', { ...detail, accountId: 'two' }, initial, 400).accountId, 'two')
  assert.equal(
    project('codex', { ...detail, status: 'waitingOnApproval' }, initial, 400).status,
    'waitingOnApproval'
  )
  const finished = project(
    'codex',
    { ...detail, updatedAt: 500, status: null, items: [{ type: 'message', content: 'Final' }] },
    initial,
    500
  )
  assert.equal(finished.updatedAt, 500)
  assert.equal(finished.preview, 'Final')
})

test('stream summaries with delayed read markers and omitted fields do not advance sidebar activity', () => {
  const context = vm.createContext({
    getChatPreview: () => 'Existing preview',
    mergeSeenUpdatedAt,
    arePendingApprovalsEqual: (a, b) => (a == null && b == null) || a === b,
    areContainerTargetsEqual: (a, b) => a === b
  })
  for (const name of ['getChatFromDetail', 'areChatsEqual', 'getChatFromUpdateSummary'])
    context[name] = load('./workspace/chatControllerUtils.tsx', name, context)
  const detail = {
    id: 'chat',
    title: 'Chat',
    createdAt: 1,
    updatedAt: 100,
    status: 'active',
    seenUpdatedAt: 4000,
    items: []
  }
  const initial = context.getChatFromDetail('codex', detail, null, 100)
  const summary = { ...initial, doneAt: undefined }
  for (let updatedAt = 5000; updatedAt < 10000; updatedAt += 100) {
    const next = context.getChatFromUpdateSummary(
      'codex',
      { ...summary, updatedAt, seenUpdatedAt: 3000, preview: 'Token ' + updatedAt },
      initial,
      false
    )
    assert.equal(next.updatedAt, 100)
    assert.equal(next.seenUpdatedAt, 4000)
    assert.equal(context.areChatsEqual(initial, next), true)
  }
  const read = context.getChatFromUpdateSummary(
    'codex',
    { ...summary, updatedAt: 10000, seenUpdatedAt: 11000 },
    initial,
    false
  )
  assert.equal(read.updatedAt, 100, 'read acknowledgements do not reorder activity')
  assert.equal(read.seenUpdatedAt, 11000)
  for (const change of [
    { title: 'Renamed' },
    { status: 'waitingOnApproval' },
    { accountId: 'two' }
  ])
    assert.equal(
      context.getChatFromUpdateSummary(
        'codex',
        { ...summary, ...change, updatedAt: 12000 },
        initial,
        false
      ).updatedAt,
      12000
    )
  assert.equal(
    context.getChatFromUpdateSummary('codex', { ...summary, updatedAt: 13000 }, initial, true)
      .updatedAt,
    13000
  )
})

test('read-marker commits cannot overwrite a pending chat selection or its prepared detail', () => {
  const path = './workspace/features/useWorkspacePersistence.tsx'
  const file = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const callbacks = []
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(file) === 'useEffect' &&
      node.arguments[0]
    ) {
      const text = node.arguments[0].getText(file)
      if (
        text.includes('chatState.selectedChatRef.current') ||
        text.includes('chatState.chatDetailRef.current')
      )
        callbacks.push(text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.equal(callbacks.length, 2)
  const a = { id: 'a', providerId: 'codex', updatedAt: 1 },
    b = { id: 'b', providerId: 'codex', updatedAt: 2 }
  const aDetail = { id: 'a' },
    bDetail = { id: 'b' }
  const state = {
    selectedChat: a,
    chatDetail: aDetail,
    selectedChatRef: { current: a },
    selectedChatKeyRef: { current: 'codex:b' },
    selectedChatUpdatedAtRef: { current: 2 },
    chatDetailRef: { current: bDetail }
  }
  const context = vm.createContext({
    chatState: state,
    getChatKey: (chat) => chat.providerId + ':' + chat.id
  })
  const effects = callbacks.map((text) =>
    vm.runInContext(ts.transpile(`(${text})`, { target: ts.ScriptTarget.ES2022 }), context)
  )
  const commit = () => effects.forEach((effect) => effect())
  state.selectedChat = { ...a, seenUpdatedAt: 10 }
  commit()
  assert.equal(state.selectedChatKeyRef.current, 'codex:b')
  assert.equal(state.selectedChatUpdatedAtRef.current, 2)
  assert.equal(state.chatDetailRef.current, bDetail)
  state.selectedChat = b
  state.chatDetail = bDetail
  commit()
  assert.equal(state.selectedChatKeyRef.current, 'codex:b')
  assert.equal(state.chatDetailRef.current, bDetail)
  state.selectedChatKeyRef.current = null
  state.chatDetailRef.current = null
  state.selectedChat = { ...b, seenUpdatedAt: 20 }
  commit()
  assert.equal(
    state.selectedChatKeyRef.current,
    null,
    'a pending Back action also survives metadata commits'
  )
  assert.equal(state.chatDetailRef.current, null)
  state.selectedChat = null
  state.chatDetail = null
  commit()
  assert.equal(state.selectedChatRef.current, null)
  state.selectedChat = b
  state.chatDetail = bDetail
  commit()
  assert.equal(
    state.selectedChatKeyRef.current,
    'codex:b',
    'programmatic selection still publishes its committed key'
  )
  assert.equal(state.chatDetailRef.current, bDetail)
})
