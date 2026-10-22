import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { sortDoneChats, sortChatsForSidebarSection } from './chatSidebarOrder.ts'
import { mapPreservingIdentity, mergeChatMetadata } from './chatMetadata.ts'

const chat = (id, createdAt, doneAt, sidebarOrder = null, cwd = '/repo') => ({
  id,
  providerId: 'codex',
  createdAt,
  doneAt,
  sidebarOrder,
  cwd,
  done: true
})
const ids = (chats) => Array.from(chats, (item) => item.id)

test('Done uses completion time regardless of creation time or manual order', () => {
  const chats = [chat('created-recently', 500, 600, 0), chat('finished-recently', 100, 900, 1)]
  assert.deepEqual(ids(sortDoneChats(chats)), ['finished-recently', 'created-recently'])
  assert.deepEqual(ids(chats), ['created-recently', 'finished-recently'])
  assert.deepEqual(ids(sortChatsForSidebarSection(chats)), [
    'created-recently',
    'finished-recently'
  ])
})

test('legacy completions and equal timestamps have deterministic fallback ordering', () => {
  const chats = [
    chat('legacy-old', 10, undefined),
    chat('legacy-new', 20, null),
    chat('b', 1, 30),
    chat('a', 1, 30),
    chat('newer-created', 2, 30)
  ]
  assert.deepEqual(ids(sortDoneChats(chats)), [
    'newer-created',
    'a',
    'b',
    'legacy-new',
    'legacy-old'
  ])
})

test('metadata updates carry completion times and clear them when undone', () => {
  const original = chat('chat', 1, null)
  const completed = mergeChatMetadata(original, { done: true, doneAt: 100 })
  assert.equal(completed.doneAt, 100)
  assert.equal(original.doneAt, null)
  const undone = mergeChatMetadata(completed, { done: false, doneAt: null })
  assert.equal(undone.doneAt, null)
  assert.equal(undone.done, false)
})

test('metadata that changes nothing keeps the same chat and list objects', () => {
  const ssh = { kind: 'container', tool: 'ssh', name: 'box', runtime: { kind: 'host' } }
  const original = {
    ...chat('chat', 1, null),
    pinned: false,
    done: false,
    seenUpdatedAt: 50,
    purpose: null,
    container: ssh
  }
  const metadata = {
    id: 'chat',
    pinned: false,
    sidebarOrder: null,
    done: false,
    doneAt: null,
    seenUpdatedAt: 40,
    purpose: null,
    container: { ...ssh, runtime: { kind: 'host' } }
  }
  assert.equal(mergeChatMetadata(original, metadata), original)
  const seen = mergeChatMetadata(original, { ...metadata, seenUpdatedAt: 60 })
  assert.notEqual(seen, original)
  assert.equal(seen.seenUpdatedAt, 60)
  assert.equal(seen.container, ssh, 'an equal container keeps its identity')
  const moved = mergeChatMetadata(original, { ...metadata, container: { ...ssh, name: 'other' } })
  assert.equal(moved.container.name, 'other')

  const list = [original, chat('other', 2, null)]
  assert.equal(
    mapPreservingIdentity(list, (item) => item),
    list
  )
  const updated = mapPreservingIdentity(list, (item) => (item.id === 'other' ? { ...item } : item))
  assert.notEqual(updated, list)
  assert.equal(updated[0], list[0])
})

// Exercise the actual controller declarations, as in chatLoadRecovery.test.mjs,
// without mounting the workspace or starting any real provider sessions.
const source = ts.createSourceFile(
  'useWorkspaceController.tsx',
  readFileSync(new URL('./useWorkspaceController.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
const expression = (name) => {
  let result
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      result = node.initializer.getText(source)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(result, `Found ${name}`)
  return ts.transpileModule(`globalThis.result = ${result}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
}

test('switching Done projects filters loaded chats without provider history requests', () => {
  const allProjects = '__all__'
  const ordered = sortDoneChats([
    chat('other', 1, 100, null, '/other'),
    chat('old', 20, 30),
    chat('recent', 10, 60)
  ])
  let selected = allProjects
  let resets = 0
  let requests = 0
  const context = vm.createContext({
    useMemo: (fn) => fn(),
    allDoneProjectsValue: allProjects,
    doneGroupKey: 'done',
    unfilteredDoneChatGroup: { kind: 'done', chats: ordered },
    getChatProjectCwd: (item) => item.projectCwd ?? item.cwd,
    setDoneProjectFilterValue: (value) => {
      selected = value
    },
    resetDoneChatPagination: () => {
      resets++
    },
    providerApi: {
      getChats: () => {
        requests++
        throw new Error('History must not be reloaded')
      }
    }
  })
  const change = vm.runInContext(expression('handleDoneProjectFilterChange'), context)
  const group = () => {
    context.doneProjectFilterValue = selected
    return vm.runInContext(expression('doneChatGroup'), context)
  }
  change('/repo')
  assert.deepEqual(ids(group().chats), ['recent', 'old'])
  change('/missing')
  assert.equal(group().chats.length, 0)
  change('/other')
  assert.deepEqual(ids(group().chats), ['other'])
  change(allProjects)
  assert.equal(group(), context.unfilteredDoneChatGroup)
  assert.equal(resets, 4)
  assert.equal(requests, 0)
  // Background discovery remains visible without selecting the project again.
  change('/repo')
  context.unfilteredDoneChatGroup = {
    chats: sortDoneChats([...ordered, chat('discovered', 5, 200)])
  }
  assert.deepEqual(ids(group().chats), ['discovered', 'recent', 'old'])
})

test('unchanged projects reuse their sorted history while completion or manual ordering invalidates it', () => {
  const a = chat('a', 10, 20)
  const b = chat('b', 20, 30)
  for (const sort of [sortDoneChats, sortChatsForSidebarSection]) {
    const previous = sort([a, b])
    assert.equal(sort([b, a], previous), previous, 'same records reuse their established order')
    assert.notEqual(
      sort([a, { ...b, doneAt: 40, sidebarOrder: 0 }], previous),
      previous,
      'updated metadata must not reuse old records'
    )
    assert.notEqual(sort([a], previous), previous)
    assert.deepEqual(
      previous.map((item) => item.id),
      ['b', 'a']
    )
  }
})
