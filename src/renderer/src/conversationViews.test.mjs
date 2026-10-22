import assert from 'node:assert/strict'
import test from 'node:test'
import { createConversationViews } from './conversationViews.ts'
import {
  createConversationView,
  isConversationOpeningDetail
} from '../../shared/conversationView.ts'
import { buildChatConversationModel } from './chatConversationModel.ts'

const chat = (id = 'one', extra = {}) => ({
  id,
  providerId: 'codex',
  container: null,
  updatedAt: 1,
  status: null,
  ...extra
})
const detail = (id = 'one', extra = {}) => ({
  ...chat(id),
  revision: 50,
  capabilities: { editMessages: true, activeMessages: true },
  items: [
    { id: id + ':u', type: 'message', role: 'user', content: 'Question' },
    { id: id + ':a', type: 'message', role: 'assistant', content: 'Answer' }
  ],
  ...extra
})

test('known views are synchronous mappings, independent of timestamp, status, done, and RAM cache limits', () => {
  const views = createConversationViews()
  views.install('codex', [detail()])
  const next = views.get(
    chat('one', { updatedAt: 999, status: 'active', done: true, title: 'Renamed' })
  )
  assert.equal(next.items.at(-1).content, 'Answer')
  assert.equal(next.title, 'Renamed')
  assert.equal(next.revision, -1)
  assert.equal(next.conversationView, true)
  assert.equal(next.writeAccess, 'checking')
  assert.equal(next.capabilities.editMessages, false)
  assert.equal(views.get(chat('unknown')), null)
})
test('processed views do not become unknown through LRU eviction and empty conversations are known', () => {
  const views = createConversationViews()
  views.install(
    'codex',
    Array.from({ length: 150 }, (_, i) => detail(String(i)))
  )
  views.install('codex', [detail('empty', { items: [], turnCount: 0 })])
  assert.equal(views.get(chat('0')).items.at(-1).content, 'Answer')
  assert.equal(views.get(chat('empty')).conversationView, true)
  assert.equal(views.get(chat('empty')).items.length, 0)
})
test('opening projection is one indexed viewport and is ready to map before selection', () => {
  const input = detail('one', {
    items: [{ id: 'old', type: 'message', role: 'user', content: 'Old' }, ...detail().items],
    itemsStartTurnIndex: 5,
    turnCount: 7
  })
  const projected = createConversationView(input)
  assert.deepEqual(projected.items, detail().items)
  assert.equal(projected.itemsStartTurnIndex, 6)
  const views = createConversationViews()
  views.install('codex', [projected])
  assert.equal(
    buildChatConversationModel(projected.items),
    buildChatConversationModel(views.get(chat()).items)
  )
})
test('provider, source and account resets isolate views, and older windows cannot replace the opening view', () => {
  const views = createConversationViews()
  views.install('codex', [detail()])
  assert.equal(views.get(chat('one', { providerId: 'claude' })), null)
  assert.equal(
    views.get(chat('one', { container: { kind: 'container', tool: 'ssh', name: 'remote' } })),
    null
  )
  const older = detail('one', {
    items: [{ id: 'old', type: 'message', role: 'user', content: 'Older' }],
    itemsStartTurnIndex: 0,
    turnCount: 20
  })
  assert.equal(isConversationOpeningDetail(older), false)
  views.install('codex', [older])
  assert.equal(views.get(chat()).items.at(-1).content, 'Answer')
  views.clear()
  assert.equal(views.get(chat()), null)
})

test('a low live revision after restart replaces its baseline and late list pages cannot roll it back', () => {
  const views = createConversationViews()
  const baseline = createConversationView(detail('one', { revision: 900 }))
  views.install('codex', [baseline])
  const live = detail('one', {
    revision: 1,
    items: [{ id: 'new', type: 'message', role: 'user', content: 'New process' }]
  })
  views.install('codex', [live])
  views.install('codex', [baseline])
  assert.equal(views.get(chat()).items[0].content, 'New process')
  views.install(
    'codex',
    [createConversationView({ ...live, revision: 0, conversationViewSourceRevision: 0 })],
    true
  )
  assert.equal(views.get(chat()).items[0].id, 'new')
})
