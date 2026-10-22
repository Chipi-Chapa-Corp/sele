import assert from 'node:assert/strict'
import { getDatabase, disposeDatabase } from '../../../src/main/database/sqlite'
import { SqliteConversationViews } from '../../../src/main/database/conversationViews'
import { PersistentChatHistory } from '../../../src/main/providers/PersistentChatHistory'
import { createConversationView } from '../../../src/shared/conversationView'
import type { ProviderChatDetail } from '../../../src/shared/provider'

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
  assert.equal(page.views.length, 100)
  assert.equal(page.nextCursor, '100')
  assert.equal((await restarted.list(identity.viewScope('codex', '')!, 100, 100)).views.length, 50)
  assert.equal((await restarted.read([identity.viewScope('codex', 'unknown')!])).size, 0)
  const oldScope = scopes[0]
  identity.forgetAccount('codex')
  account('second-account')
  assert.equal(
    (await restarted.read([oldScope])).size,
    0,
    'in-flight old-account scopes cannot expose views'
  )
  assert.equal((await restarted.list(identity.viewScope('codex', '')!, 0, 100)).views.length, 0)
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
  await disposeDatabase()
  console.log(
    'PASS durable conversation views: restart, no age/LRU eviction, active/done/empty views, local pagination, unknown IDs, and account isolation'
  )
}
run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
