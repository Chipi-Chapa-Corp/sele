import assert from 'node:assert/strict'
import { getDatabase, getReadDatabase, disposeDatabase } from '../../../src/main/database/sqlite'
import { getChatMetadata, setChatPinned } from '../../../src/main/database/chat'
import { SqliteConversationViews } from '../../../src/main/database/conversationViews'
import { PersistentChatHistory } from '../../../src/main/providers/PersistentChatHistory'
import { createConversationView } from '../../../src/shared/conversationView'
import type { ProviderChatDetail } from '../../../src/shared/provider'
import { performance } from 'node:perf_hooks'

const run = async () => {
  const identity = new PersistentChatHistory({ read: async () => null, save: async () => true })
  const account = (id: string) =>
    identity.setAccount(
      'codex',
      null,
      {
        available: true,
        unavailableMessage: null,
        accounts: [{ id, displayName: id, active: true }]
      },
      identity.accountEpoch('codex')
    )
  account('first-account')
  const store = new SqliteConversationViews(getDatabase, getReadDatabase)
  const scopes = Array.from({ length: 150 }, (_, i) => identity.viewScope('codex', String(i))!)
  for (const [i, scope] of scopes.entries()) {
    const detail = {
      id: String(i),
      revision: i,
      container: null,
      title: 'Known ' + i,
      createdAt: 1,
      updatedAt: 2,
      status: i === 0 ? 'active' : null,
      done: i === 1,
      capabilities: { editMessages: true, activeMessages: true },
      pendingApproval: { id: 'old' },
      items:
        i === 2 ? [] : [{ type: 'message', id: 'u' + i, role: 'user', content: 'Persisted ' + i }],
      itemsStartTurnIndex: 0,
      turnCount: i === 2 ? 0 : 1
    } as ProviderChatDetail
    await store.write(scope, createConversationView(detail))
  }
  const db = await getDatabase()
  const readers = Array.from({ length: 20 }, () => getReadDatabase())
  assert.ok(
    readers.every((reader) => reader === readers[0]),
    'readers share one initialization'
  )
  const reader = await readers[0]
  await assert.rejects(
    reader.deleteFrom('conversation_view').execute(),
    /readonly/i,
    'the navigation connection cannot write'
  )
  let release!: () => void
  let started!: () => void
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const writer = db.transaction().execute(async (trx) => {
    await trx.updateTable('conversation_view').set({ updated_at: 123 }).execute()
    await trx.insertInto('chat').values({ id: 'background', pinned: 1 }).execute()
    started()
    await held
  })
  await entered
  const readStart = performance.now()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      Promise.all([store.read([scopes[0]]), getChatMetadata('background')]),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Navigation queued behind the writer')), 500)
      })
    ])
    assert.equal(result[0].get(scopes[0].key)!.items[0].content, 'Persisted 0')
    assert.equal(result[1].pinned, false, 'uncommitted metadata is never exposed')
    assert.equal(
      (
        await reader
          .selectFrom('conversation_view')
          .select('updated_at')
          .where('scope_key', '=', scopes[0].key)
          .executeTakeFirstOrThrow()
      ).updated_at === 123,
      false,
      'WAL reader sees only committed state while a writer is active'
    )
    console.log(
      'Saved view + metadata during held write transaction:',
      (performance.now() - readStart).toFixed(2),
      'ms'
    )
  } finally {
    clearTimeout(timeout)
    release()
    await writer
  }
  assert.equal(
    (await setChatPinned('background', true)).pinned,
    true,
    'committed writes invalidate metadata reads'
  )
  assert.equal(
    (
      await reader
        .selectFrom('conversation_view')
        .select('updated_at')
        .where('scope_key', '=', scopes[0].key)
        .executeTakeFirstOrThrow()
    ).updated_at,
    123,
    'subsequent reads observe committed changes without reopening'
  )
  await db.updateTable('conversation_view').set({ updated_at: 0 }).execute()
  await disposeDatabase()
  const restarted = new SqliteConversationViews(getDatabase, getReadDatabase)
  const known = await restarted.read(scopes)
  assert.equal(
    known.size,
    150,
    'processed chats survive restart, age and more than 100 other views'
  )
  assert.equal(known.get(scopes[0].key)!.items[0].content, 'Persisted 0')
  assert.equal(known.get(scopes[0].key)!.writeAccess, 'checking')
  assert.equal(known.get(scopes[0].key)!.pendingApproval, null)
  assert.equal(known.get(scopes[1].key)!.done, true, 'done chats stay known')
  assert.equal(known.get(scopes[2].key)!.items.length, 0, 'empty chats stay known')
  const page = await restarted.list(identity.viewScope('codex', '')!, 0, 100)
  assert.equal(page.summaries.length, 100)
  assert.ok(
    page.summaries.every((summary) => !('items' in summary)),
    'discovery is metadata only'
  )
  assert.equal(page.nextCursor, '100')
  assert.equal(
    (await restarted.list(identity.viewScope('codex', '')!, 100, 100)).summaries.length,
    50
  )
  assert.equal((await restarted.read([identity.viewScope('codex', 'unknown')!])).size, 0)
  const oldScope = scopes[0]
  identity.forgetAccount('codex')
  account('second-account')
  assert.equal(
    (await restarted.read([oldScope])).size,
    0,
    'in-flight old-account scopes cannot expose views'
  )
  assert.equal((await restarted.list(identity.viewScope('codex', '')!, 0, 100)).summaries.length, 0)
  await restarted.write(
    oldScope,
    createConversationView({ id: '0', revision: 999, items: [] } as ProviderChatDetail)
  )
  identity.forgetAccount('codex')
  account('first-account')
  const restored = await restarted.read([identity.viewScope('codex', '0')!])
  assert.equal(
    [...restored.values()][0].items[0].content,
    'Persisted 0',
    'late old-account writes cannot overwrite durable text'
  )
  const hugeScope = identity.viewScope('codex', 'huge')!
  const huge = createConversationView({
    id: 'huge',
    title: 'Large saved turn',
    revision: 1,
    createdAt: 1,
    updatedAt: 2,
    items: [
      { id: 'first-prompt', type: 'message', role: 'user', content: 'Earlier question' },
      { id: 'first-answer', type: 'message', role: 'assistant', content: 'Earlier answer' },
      { id: 'last-prompt', type: 'message', role: 'user', content: 'Large question' },
      {
        id: 'large-answer',
        type: 'message',
        role: 'assistant',
        content: 'large body '.repeat(600_000),
        attachments: [{ kind: 'file', path: '/fixture/result.txt', name: 'result.txt' }]
      }
    ],
    itemsStartTurnIndex: 3,
    turnCount: 5
  } as ProviderChatDetail)
  await restarted.write(hugeScope, huge)
  const currentDb = await getDatabase()
  // Include old rows without the summary column populated, as after an upgrade.
  await currentDb
    .updateTable('conversation_view')
    .set({ summary: null, opening: null })
    .where('scope_key', '=', hugeScope.key)
    .execute()
  const openingStart = performance.now()
  const opening = (await restarted.read([hugeScope], { opening: true })).get(hugeScope.key)!
  const openingBytes = Buffer.byteLength(JSON.stringify(opening))
  assert.deepEqual(opening.items, huge.items, 'openings preserve all saved messages and full text')
  assert.equal(opening.itemsStartTurnIndex, huge.itemsStartTurnIndex)
  assert.equal(opening.turnCount, huge.turnCount)
  assert.equal(opening.historyPreview, huge.historyPreview)
  console.log(
    'Full saved opening:',
    JSON.stringify({
      openingBytes,
      originalBytes: huge.items.at(-1)!.content.length,
      readMs: performance.now() - openingStart
    })
  )
  // Older versions saved a separate truncated opening. It must never replace
  // the complete payload after upgrading or reopening the database.
  await currentDb
    .updateTable('conversation_view')
    .set({ opening: JSON.stringify({ ...huge, items: [huge.items[0]], historyPreview: true }) })
    .where('scope_key', '=', hugeScope.key)
    .execute()
  await disposeDatabase()
  const secondOpening = (await restarted.read([hugeScope], { opening: true })).get(hugeScope.key)!
  assert.deepEqual(
    secondOpening,
    opening,
    'restarted openings ignore legacy truncated columns and preserve the saved view'
  )
  const reopenedDb = await getDatabase()
  const toolsScope = identity.viewScope('codex', 'large-tools')!
  const toolsView = createConversationView({
    ...huge,
    id: 'large-tools',
    items: [
      { id: 'prompt', type: 'message', role: 'user', content: 'Inspect this' },
      {
        id: 'work',
        type: 'working',
        status: 'working',
        items: Array.from({ length: 200 }, (_, i) => ({
          id: 'tool' + i,
          type: 'tool',
          name: 'exec_command',
          content: 'output'.repeat(2000)
        }))
      },
      { id: 'reply', type: 'message', role: 'assistant', content: 'Done' }
    ]
  } as ProviderChatDetail)
  await restarted.write(toolsScope, toolsView)
  const toolsOpening = (await restarted.read([toolsScope], { opening: true })).get(toolsScope.key)!
  assert.deepEqual(
    toolsOpening.items.map((item) => item.id),
    ['prompt', 'work', 'reply']
  )
  assert.deepEqual(toolsOpening.items[1].items, [])
  assert.equal(toolsOpening.items[1].itemsLoaded, false)
  assert.equal(toolsOpening.items[1].itemCount, 200)
  assert.equal(
    (await restarted.read([toolsScope])).get(toolsScope.key)!.items[1].items.length,
    0,
    'hidden tool bodies stay unloaded until expansion'
  )
  await reopenedDb.deleteFrom('conversation_view').where('scope_key', '=', toolsScope.key).execute()
  const start = performance.now()
  const metadataPage = await restarted.list(identity.viewScope('codex', '')!, 0, 200)
  const listMs = performance.now() - start
  const bytes = Buffer.byteLength(JSON.stringify(metadataPage))
  assert.equal(metadataPage.summaries.length, 151)
  assert.ok(bytes < 100_000, 'listing never returns megabytes of saved messages')
  assert.ok(metadataPage.summaries.every((summary) => !('items' in summary)))
  assert.equal(metadataPage.summaries.find((summary) => summary.id === 'huge')?.title, huge.title)
  assert.deepEqual(
    (await restarted.read([hugeScope])).get(hugeScope.key)!.items,
    huge.items,
    'metadata-only discovery preserves the complete on-demand opening view'
  )
  console.log(
    'Saved-view discovery:',
    JSON.stringify({
      chats: metadataPage.summaries.length,
      savedTurnBytes: huge.items.at(-1)!.content.length,
      metadataBytes: bytes,
      listMs
    })
  )
  await disposeDatabase()
  console.log(
    'PASS durable conversation views: restart, no age/LRU eviction, active/done/empty views, local pagination, unknown IDs, and account isolation'
  )
}
run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
