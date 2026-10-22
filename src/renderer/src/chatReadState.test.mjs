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
