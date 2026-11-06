import assert from 'node:assert/strict'
import test from 'node:test'
import { createConversationViews } from './conversationViews.ts'
import {
  createConversationView,
  isConversationOpeningDetail,
  restoreConversationView
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
  assert.deepEqual(projected.items, input.items)
  assert.equal(projected.itemsStartTurnIndex, 5)
  const views = createConversationViews()
  views.install('codex', [projected])
  assert.equal(
    buildChatConversationModel(projected.items),
    buildChatConversationModel(views.get(chat()).items)
  )
})
test('a durable opening keeps the complete processed message list and full text', () => {
  const input = detail('many', {
    items: Array.from({ length: 30 }, (_, i) => [
      { id: `u-${i}`, type: 'message', role: 'user', content: `Question ${i}` },
      { id: `w-${i}`, type: 'working', status: 'worked', items: [{ id: `tool-${i}` }] },
      { id: `a-${i}`, type: 'message', role: 'assistant', content: 'Answer '.repeat(20000) }
    ]).flat(),
    turnCount: 30
  })
  const projected = createConversationView(input)
  assert.equal(projected.itemsStartTurnIndex, 0)
  assert.equal(projected.items.length, 90)
  const views = createConversationViews()
  views.install('codex', [projected])
  const opening = views.get(chat('many'))
  assert.equal(opening.items.length, 90)
  assert.equal(opening.items[0].id, 'u-0')
  assert.equal(opening.items.at(-1).id, 'a-29')
  assert.equal(opening.items.at(-1).content, input.items.at(-1).content)
  assert.equal(opening.openingPreview, undefined)
  assert.ok(
    opening.items.filter((item) => item.type === 'working').every((item) => !item.items.length)
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

for (const outcome of ['stopped', 'failed']) {
  test(`restart reconciles a saved working viewport with the sidebar's ${outcome} outcome`, () => {
    const views = createConversationViews()
    const work = { type: 'working', id: 'work', status: 'working', items: [] }
    const baseline = createConversationView(
      detail('one', {
        status: 'active',
        lastTurnOutcome: null,
        items: [detail().items[0], work]
      })
    )
    views.install('codex', [baseline])
    const restored = views.get(chat('one', { lastTurnOutcome: outcome, revision: 100 }))
    assert.equal(restored.status, null)
    assert.equal(restored.items.at(-1).status, outcome)
    assert.equal(baseline.items.at(-1), work, 'do not mutate the durable snapshot')
    assert.equal(work.status, 'working')
    assert.equal(restored.revision, -1, 'sidebar revisions must not grant live snapshot authority')
    assert.equal(restored.writeAccess, 'checking')
    assert.equal(restored.pendingApproval, null)
    assert.equal(restored.capabilities.activeMessages, false)

    // A fresh provider reply still replaces the reconciled preview after restart.
    views.install('codex', [detail('one', { revision: 1 })])
    assert.equal(views.get(chat()).items.at(-1).content, 'Answer')
  })
}

test('restored outcomes leave earlier turns and queued prompts intact', () => {
  const old = { type: 'working', id: 'old', status: 'worked', items: [] }
  const working = { type: 'working', id: 'work', status: 'working', items: [] }
  const pending = { type: 'pendingMessage', id: 'pending', content: 'Later' }
  const queued = { type: 'working', id: 'queued', status: 'queued', items: [] }
  const input = detail('one', {
    items: [old, detail().items[0], working, pending, queued]
  })
  const next = restoreConversationView(input, chat('one', { lastTurnOutcome: 'stopped' }))
  assert.equal(next.items[0], old)
  assert.equal(next.items[2].status, 'stopped')
  assert.equal(next.items[3], pending)
  assert.equal(next.items[4], queued)
})

test('active, stale and historical sidebar outcomes cannot stop a different viewport', () => {
  const input = detail('one', {
    items: [detail().items[0], { type: 'working', id: 'work', status: 'working', items: [] }]
  })
  for (const summary of [
    { status: 'active', lastTurnOutcome: 'stopped' },
    { status: 'waitingOnApproval', lastTurnOutcome: 'stopped' },
    { lastTurnOutcome: 'stopped', updatedAt: 0 },
    { lastTurnOutcome: undefined },
    { lastTurnOutcome: null }
  ]) {
    assert.equal(restoreConversationView(input, chat('one', summary)).items, input.items)
  }
  for (const pagination of [
    { turnPagination: { kind: 'cursor', newerCursor: 'newer' } },
    { itemsStartTurnIndex: 0, turnCount: 2 }
  ]) {
    const older = { ...input, ...pagination }
    assert.equal(
      restoreConversationView(older, chat('one', { lastTurnOutcome: 'stopped' })).items,
      input.items
    )
  }
})

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test('intent and selection share a local read, and the result is synchronous before selection', async () => {
  const views = createConversationViews()
  const disk = deferred()
  let reads = 0
  const load = () => {
    reads++
    return disk.promise
  }
  const hover = views.read(chat(), load, true)
  const selection = views.read(chat(), load)
  assert.equal(hover, selection)
  await Promise.resolve()
  assert.equal(reads, 1)
  disk.resolve(createConversationView(detail()))
  await hover
  assert.equal(views.get(chat()).items.at(-1).content, 'Answer')
  await views.read(chat(), load)
  assert.equal(reads, 1, 'warm views do not hit disk')
})

test('speculative reads are bounded, selected reads are not blocked, and failures can retry', async () => {
  const views = createConversationViews()
  const disks = [deferred(), deferred(), deferred()]
  const pending = disks
    .slice(0, 2)
    .map((disk, i) => views.read(chat(String(i)), () => disk.promise, true))
  let extraReads = 0
  const load = () => {
    extraReads++
    return disks[2].promise
  }
  assert.equal(await views.read(chat('2'), load, true), null)
  assert.equal(extraReads, 0)
  const selection = views.read(chat('2'), load)
  await Promise.resolve()
  assert.equal(extraReads, 1)
  disks[2].reject(new Error('Disk failed'))
  await assert.rejects(selection, /Disk failed/)
  assert.equal(await views.read(chat('2'), async () => null, true), null)
  disks[0].resolve(null)
  disks[1].resolve(null)
  await Promise.all(pending)
  await views.read(chat('2'), async () => createConversationView(detail('2')), true)
  assert.equal(views.has(chat('2')), true)
})

test('late speculative replies cannot cross an account reset or erase a newer pending read', async () => {
  const views = createConversationViews()
  const oldDisk = deferred(),
    newDisk = deferred()
  const oldRead = views.read(chat(), () => oldDisk.promise, true)
  views.clear()
  const newRead = views.read(chat(), () => newDisk.promise, true)
  oldDisk.resolve(createConversationView(detail('one', { title: 'Old account' })))
  assert.equal(await oldRead, null)
  assert.equal(views.has(chat()), false)
  assert.equal(
    views.read(chat(), () => {
      throw Error('Duplicated read')
    }),
    newRead
  )
  newDisk.resolve(createConversationView(detail('one', { title: 'New account' })))
  await newRead
  assert.equal(views.get(chat()).items.at(-1).content, 'Answer')
})

test('late local reads cannot roll back live data or install a different source', async () => {
  const views = createConversationViews(),
    disk = deferred()
  const read = views.read(chat(), () => disk.promise, true)
  views.install('codex', [
    detail('one', { items: [{ id: 'live', type: 'message', role: 'user', content: 'Live' }] })
  ])
  disk.resolve(createConversationView(detail()))
  await read
  assert.equal(views.get(chat()).items[0].content, 'Live')
  views.clear()
  assert.equal(await views.read(chat(), async () => createConversationView(detail('wrong'))), null)
  assert.equal(
    await views.read(chat(), async () =>
      createConversationView(
        detail('one', { container: { kind: 'container', tool: 'ssh', name: 'remote' } })
      )
    ),
    null
  )
  assert.equal(views.has(chat()), false)
})

test('the persistent renderer opening registry cannot retain complete large tool transcripts', () => {
  const views = createConversationViews()
  const input = detail('large', {
    items: [
      { id: 'prompt', type: 'message', role: 'user', content: 'Inspect' },
      {
        id: 'work',
        type: 'working',
        status: 'worked',
        items: [{ id: 'tool', type: 'tool', name: 'exec_command', output: 'output'.repeat(100000) }]
      },
      { id: 'answer', type: 'message', role: 'assistant', content: 'Answer '.repeat(100000) }
    ]
  })
  views.install('codex', [input])
  const opening = views.get(chat('large'))
  assert.ok(JSON.stringify(opening).length < 710000)
  assert.equal(opening.items[1].itemCount, 1)
  assert.deepEqual(opening.items[1].items, [])
  assert.equal(opening.items[2].content, input.items[2].content)
  assert.equal(opening.items[2].contentLoaded, undefined)
  assert.equal(
    input.items[1].items[0].output.length,
    600000,
    'full source remains available in the separate history cache'
  )
  assert.equal(input.items[2].content.length, 700000)
})
