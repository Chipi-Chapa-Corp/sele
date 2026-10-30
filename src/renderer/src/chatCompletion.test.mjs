import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(
  new URL('./workspace/useChatListController.tsx', import.meta.url),
  'utf8'
)
const file = ts.createSourceFile(
  'controller.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
const controller = file.statements.find((node) => ts.isFunctionDeclaration(node))
const code = ts.transpileModule(controller.getText(file).replace('export ', ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const makeChat = (id) => ({
  id,
  providerId: 'codex',
  cwd: '/repo',
  done: false,
  doneAt: null,
  sidebarOrder: 2
})
const key = (chat) => `${chat.providerId}:${chat.id}`
const fixture = () => {
  const requests = [],
    updates = [],
    errors = [],
    removed = [],
    opened = []
  const selected = makeChat('selected'),
    other = makeChat('other')
  let chats = [selected, other],
    draftsReleased = 0
  const selection = { current: key(selected) }
  const dependencies = {
    selectedChat: selected,
    selectedChatKeyRef: selection,
    chatDetail: null,
    newSessionContainer: { kind: 'host' },
    setChats: (update) => updates.push(update),
    applyChatMetadata: (metadata) =>
      updates.push((list) =>
        list.map((chat) => {
          const entry = metadata.find((entry) => entry.id === chat.id)
          return entry ? { ...chat, ...entry } : chat
        })
      ),
    removeRecentChatCacheEntry: (...args) => removed.push(args),
    showNewChatView: (...args) => {
      opened.push(args)
      selection.current = null
    }
  }
  const request = (...args) => {
    const pending = deferred()
    requests.push({ ...pending, args })
    return pending.promise
  }
  const context = vm.createContext({
    startTransition: (callback) => callback(),
    useRef: (value) => ({ current: value }),
    getChatKey: key,
    getChatProjectCwd: (chat) => chat.cwd,
    providerApi: { markChatDone: request, markChatsDone: request },
    updateStoredComposerDrafts: () => draftsReleased++,
    console: { error: (...args) => errors.push(args) }
  })
  vm.runInContext(code, context)
  // biome-ignore lint/correctness/useHookAtTopLevel: isolated controller with a deterministic useRef test double.
  const api = context.useChatListController(dependencies)
  const flush = () => {
    while (updates.length) chats = updates.shift()(chats)
  }
  return {
    api,
    requests,
    selected,
    other,
    selection,
    opened,
    removed,
    errors,
    flush,
    get chats() {
      return chats
    },
    get draftsReleased() {
      return draftsReleased
    },
    stream: () => {
      chats = chats.map((chat) => ({ ...chat, title: 'New streamed title' }))
    }
  }
}

test('completion updates the sidebar and composer before disk acknowledgement', async () => {
  const f = fixture()
  const saving = f.api.handleMarkChatDone(f.selected)
  f.flush()
  assert.equal(f.chats[0].done, true)
  assert.equal(f.opened.length, 1)
  assert.equal(f.draftsReleased, 0, 'draft release waits for durable success')
  f.selection.current = key(f.other)
  f.requests[0].resolve({ id: f.selected.id, done: true, doneAt: 100, sidebarOrder: null })
  await saving
  f.flush()
  assert.equal(f.opened.length, 1, 'late acknowledgement cannot navigate away from another chat')
  assert.equal(f.chats[0].doneAt, 100)
  assert.equal(f.draftsReleased, 1)
})

test('failed persistence rolls back after React processes the updater, preserving newer chat data', async () => {
  const f = fixture()
  const saving = f.api.handleMarkChatDone(f.selected)
  f.flush()
  f.stream()
  f.requests[0].reject(new Error('Disk full'))
  await saving
  f.flush()
  assert.equal(f.chats[0].done, false)
  assert.equal(f.chats[0].sidebarOrder, 2)
  assert.equal(f.chats[0].title, 'New streamed title')
  assert.equal(f.draftsReleased, 0)
  assert.equal(f.removed.length, 0)
  assert.equal(f.errors.length, 1)
})

test('a late completion cannot overwrite a newer undo or roll it back', async () => {
  for (const failure of [false, true]) {
    const f = fixture()
    const done = f.api.handleMarkChatDone(f.selected)
    f.flush()
    const undo = f.api.handleMarkChatDone(f.chats[0], false)
    f.requests[1].resolve({ id: f.selected.id, done: false, doneAt: null })
    await undo
    if (failure) f.requests[0].reject(new Error('Older failed save'))
    else f.requests[0].resolve({ id: f.selected.id, done: true, doneAt: 100 })
    await done
    f.flush()
    assert.equal(f.chats[0].done, false)
    assert.equal(f.draftsReleased, 0)
  }
})

test('project completion uses one bulk save and restores all affected rows on failure', async () => {
  const f = fixture()
  const saving = f.api.handleMarkCwdChatsDone({
    kind: 'cwd',
    cwd: '/repo',
    chats: [f.selected, f.other]
  })
  f.flush()
  assert.ok(f.chats.every((chat) => chat.done))
  assert.equal(f.requests.length, 1)
  assert.deepEqual(Array.from(f.requests[0].args[0]), ['selected', 'other'])
  f.requests[0].reject(new Error('Unavailable'))
  await saving
  f.flush()
  assert.ok(f.chats.every((chat) => !chat.done))
})
