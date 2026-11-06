import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { assertUniqueProviderChatItemIds } from '../../shared/chatTurns.ts'
import { getConversationViewSummary } from '../../shared/conversationView.ts'

const source = ts.createSourceFile(
  'conversationViews.ts',
  readFileSync(new URL('./conversationViews.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find((node) => ts.isClassDeclaration(node))
const context = vm.createContext({
  assertUniqueProviderChatItemIds,
  getConversationViewSummary,
  console
})
vm.runInContext(
  ts.transpileModule(
    `${declaration.getText(source).replace('export class', 'class')}; globalThis.Views = SqliteConversationViews`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
  ).outputText,
  context
)
const SqliteConversationViews = context.Views

test('native prompt predictions remain ephemeral when conversation views are saved', async () => {
  let saved
  const query = {
    values(row) {
      saved = row
      return this
    },
    onConflict() {
      return this
    },
    async execute() {}
  }
  const views = new SqliteConversationViews(async () => ({ insertInto: () => query }))
  const view = {
    id: 'chat',
    conversationView: true,
    items: [],
    promptSuggestion: { id: 'turn', text: 'Try this next' }
  }
  const scope = { key: 'fixture', current: () => true }
  assert.equal(await views.write(scope, view), true)
  assert.equal('promptSuggestion' in JSON.parse(saved.payload), false)
  assert.equal(view.promptSuggestion.text, 'Try this next', 'saving must not mutate the live view')
})

test('reading an older persisted prediction cannot revive it after restart', async () => {
  const query = {
    select() {
      return this
    },
    where() {
      return this
    },
    async execute() {
      return [
        {
          scope_key: 'fixture',
          format_version: 1,
          payload: JSON.stringify({
            id: 'chat',
            conversationView: true,
            items: [],
            promptSuggestion: { id: 'old', text: 'Stale' }
          })
        }
      ]
    }
  }
  const views = new SqliteConversationViews(async () => ({ selectFrom: () => query }))
  const result = await views.read([{ key: 'fixture', current: () => true }])
  assert.equal(result.get('fixture').promptSuggestion, undefined)
})

test('large saved message lists retain full text and use a single payload for openings', async () => {
  const items = Array.from({ length: 30 }, (_, i) => [
    { id: `user-${i}`, type: 'message', role: 'user', content: `Question ${i}` },
    {
      id: `answer-${i}`,
      type: 'message',
      role: 'assistant',
      content: `Start ${i}\n${'Full message text. '.repeat(2000)}\nEnd ${i}`,
      attachments: [{ kind: 'file', path: `/fixture/file-${i}.txt`, name: `file-${i}.txt` }]
    }
  ]).flat()
  const view = {
    id: 'large',
    title: 'Large chat',
    conversationView: true,
    historyPreview: true,
    items,
    turnCount: 30,
    itemsStartTurnIndex: 0
  }
  let row
  let columns
  const query = {
    values(value) {
      row = value
      return this
    },
    onConflict() {
      return this
    },
    select(value) {
      columns = value
      return this
    },
    where() {
      return this
    },
    async execute() {
      return row ? [{ ...row, opening: '{"items":[]}' }] : []
    }
  }
  const views = new SqliteConversationViews(async () => ({
    insertInto: () => query,
    selectFrom: () => query
  }))
  const scope = { key: 'large-scope', current: () => true }
  await views.write(scope, view)
  assert.equal(row.opening, null, 'do not save a second truncated message list')
  const restored = (await views.read([scope], { opening: true })).get(scope.key)
  assert.deepEqual(
    Array.from(columns),
    ['scope_key', 'format_version', 'payload'],
    'ignore obsolete truncated openings'
  )
  assert.deepEqual(JSON.parse(JSON.stringify(restored.items)), items)
  assert.equal(restored.items.length, 60)
  assert.equal(restored.items[1].content, items[1].content)
  assert.equal(restored.itemsStartTurnIndex, 0)
})
