import assert from 'node:assert/strict'
import { getDatabase, disposeDatabase } from '../../../src/main/database/sqlite'
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
  const store = new SqliteConversationViews(getDatabase)
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
  await db.updateTable('conversation_view').set({ updated_at: 0 }).execute()
  await disposeDatabase()
  const restarted = new SqliteConversationViews(getDatabase)
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
      {
        id: 'large-answer',
        type: 'message',
        role: 'assistant',
        content: 'large body '.repeat(600_000)
      }
    ]
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
  assert.ok(openingBytes < 20_000, 'opening IPC is bounded even for multi-megabyte turns')
  assert.equal(opening.items[0].id, huge.items[0].id)
  assert.ok(opening.items[0].content.endsWith(huge.items[0].content.slice(-8192)))
  assert.equal(opening.items[0].contentLoaded, false)
  assert.equal(opening.items[0].contentCharacterCount, huge.items[0].content.length)
  assert.equal(opening.historyPreview, true)
  console.log(
    'Bounded saved opening:',
    JSON.stringify({
      openingBytes,
      originalBytes: huge.items[0].content.length,
      readMs: performance.now() - openingStart
    })
  )
  const secondOpeningStart = performance.now()
  const secondOpening = (await restarted.read([hugeScope], { opening: true })).get(hugeScope.key)!
  assert.equal(secondOpening.items[0].id, huge.items[0].id)
  const upgraded = await currentDb
    .selectFrom('conversation_view')
    .select('opening')
    .where('scope_key', '=', hugeScope.key)
    .executeTakeFirstOrThrow()
  assert.ok(
    upgraded.opening && upgraded.opening.length < 20_000,
    'legacy rows acquire a bounded opening without rewriting full history'
  )
  console.log(
    'Warm saved opening:',
    JSON.stringify({
      readMs: performance.now() - secondOpeningStart,
      bytes: upgraded.opening.length
    })
  )
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
    200,
    'the full stored tool history remains intact'
  )
  await currentDb.deleteFrom('conversation_view').where('scope_key', '=', toolsScope.key).execute()
  const start = performance.now()
  const metadataPage = await restarted.list(identity.viewScope('codex', '')!, 0, 200)
  const listMs = performance.now() - start
  const bytes = Buffer.byteLength(JSON.stringify(metadataPage))
  assert.equal(metadataPage.summaries.length, 151)
  assert.ok(bytes < 100_000, 'listing never returns megabytes of saved messages')
  assert.ok(metadataPage.summaries.every((summary) => !('items' in summary)))
  assert.equal(metadataPage.summaries.find((summary) => summary.id === 'huge')?.title, huge.title)
  assert.equal(
    (await restarted.read([hugeScope])).get(hugeScope.key)!.items[0].content,
    huge.items[0].content,
    'metadata-only discovery preserves the complete on-demand opening view'
  )
  console.log(
    'Saved-view discovery:',
    JSON.stringify({
      chats: metadataPage.summaries.length,
      savedTurnBytes: huge.items[0].content.length,
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
