import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import {
  encodeChatArchive,
  decodeChatArchive,
  archivePreview,
  collectArchiveAssets,
  restoreArchiveAssets,
  saveChatArchive
} from './ChatArchive.ts'
import { ImportedConversations } from './ImportedConversations.ts'

const user = { type: 'message', id: 'user', role: 'user', content: 'Read the file 你好' }
const tool = {
  type: 'tool',
  id: 'tool',
  toolId: 'call',
  status: 'finished',
  activity: 'command',
  icon: null,
  label: 'Read',
  command: 'cat file',
  cwd: '/original',
  stdout: 'large output\n'.repeat(5000),
  diffs: [{ path: 'file', kind: 'edit', diff: '+hello' }],
  backgroundSessionId: null,
  finishedBackgroundSessionId: null,
  rawInput: { command: 'cat file' },
  rawOutput: { exact: ['all', 'the', 'output'] },
  images: []
}
const working = { type: 'working', id: 'work', status: 'worked', items: [tool] }
const answer = { type: 'message', id: 'answer', role: 'assistant', content: 'Read and checked.' }
const detail = (id = 'source') => ({
  id,
  title: 'Full chat',
  revision: 1,
  createdAt: 1234,
  cwd: '/original',
  cwdKind: 'directory',
  projectCwd: '/original',
  branchName: null,
  worktreeBaseBranchName: null,
  status: null,
  pinned: false,
  sidebarOrder: null,
  done: false,
  seenUpdatedAt: null,
  purpose: null,
  container: null,
  capabilities: { editMessages: true, activeMessages: true },
  pendingApproval: null,
  pendingUserInput: null,
  contextUsage: null,
  items: structuredClone([user, working, answer])
})
const archive = () => ({
  format: 'sele-chat',
  version: 1,
  exportedAt: 12345,
  providerId: 'codex',
  chat: detail(),
  subagents: [
    {
      id: 'child',
      title: 'Research',
      status: 'completed',
      items: structuredClone([user, working, answer])
    }
  ],
  assets: []
})
const options = {
  model: 'fixture',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
  sandboxMode: 'workspace-write',
  serviceTier: null,
  cwd: '/imported'
}

const harness = () => {
  const rows = new Map()
  const sessions = new Map()
  const events = new Map()
  const calls = []
  const native = Object.fromEntries(
    ['codex', 'claude', 'copilot', 'opencode'].map((providerId) => {
      const listeners = new Set()
      events.set(providerId, (detail, metadata) =>
        listeners.forEach((listener) => listener(detail, metadata))
      )
      const adapter = {
        id: providerId,
        onChatUpdated: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        getChats: async () => ({
          chats: [...sessions.values()]
            .filter((session) => session.providerId === providerId)
            .map((session) => ({ ...session, preview: '', updatedAt: 1234 })),
          nextCursor: null
        }),
        getChat: async (id) => structuredClone(sessions.get(id)),
        getChatWindow: async (id, _window, source) => {
          h.lastReadContainer = source?.container
          return structuredClone(sessions.get(id))
        },
        getChatWindowForItem: async (id) => structuredClone(sessions.get(id)),
        getSubagents: async () => [],
        getSubagent: async (_id, subagentId) => ({
          id: subagentId,
          title: 'Child',
          items: structuredClone([user, working, answer])
        }),
        importHistory: async (_id, messages, settings, created) => {
          const id = `${providerId}-${sessions.size}`
          const session = {
            ...detail(id),
            providerId,
            cwd: settings.cwd,
            items: messages.map((message, index) => ({
              type: 'message',
              ...message,
              id: `synthetic-${index}`
            }))
          }
          sessions.set(id, session)
          events.get(providerId)(structuredClone(session)) // Providers can emit before creation returns.
          await created(id)
          calls.push({ providerId, id, messages, settings })
          if (h.block) await h.block
          if (h.fail) throw new Error('Native failure')
          return id
        },
        continueChat: async (id, message) => {
          calls.push({ send: id, providerId, message })
          const session = sessions.get(id)
          session.items.push(
            { ...user, id: 'next-user', content: message },
            { ...working, id: 'next-work' },
            { ...answer, id: 'next-answer', content: 'Native final' }
          )
          session.revision++
          session.status = null
          events.get(providerId)(structuredClone(session), { turnCompleted: true })
          return structuredClone(session)
        },
        forkChat: async () => {
          throw new Error('Native fork must not be called')
        },
        stopChat: async (id) => {
          calls.push({ stop: id, providerId })
          return structuredClone(sessions.get(id))
        }
      }
      return [providerId, adapter]
    })
  )
  const store = {
    list: async () =>
      [...rows.values()].map(({ archive, baseline, ...record }) => structuredClone(record)),
    get: async (id) => structuredClone(rows.get(id)),
    save: async (record) => {
      rows.set(`${record.providerId}:${record.chatId}`, structuredClone(record))
    }
  }
  const h = { rows, sessions, events, calls, native, store, fail: false, block: null }
  return h
}

test('portable archive round-trips complete tools, raw payloads, Unicode and subagents', async () => {
  const original = archive()
  const bytes = await encodeChatArchive(original)
  assert.deepEqual(await decodeChatArchive(bytes), original)
  assert.deepEqual(archivePreview('preview', original), {
    id: 'preview',
    title: 'Full chat',
    turnCount: 1,
    providerId: 'codex'
  })
  await assert.rejects(decodeChatArchive(Buffer.from('not an archive')), /valid/)
  await assert.rejects(
    decodeChatArchive(await encodeChatArchive({ ...original, version: 99 })),
    /version/
  )
})

test('attachments are bundled and restored without using original absolute paths or allowing traversal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-archive-'))
  try {
    const source = join(directory, 'source.txt')
    await writeFile(source, 'exact attachment bytes こんにちは')
    const original = archive()
    original.chat.items[0].attachments = [{ kind: 'file', name: 'source', path: source }]
    await collectArchiveAssets(original)
    const copy = await decodeChatArchive(await encodeChatArchive(original))
    copy.assets[0].path = '../../outside.txt'
    copy.chat.items[0].attachments[0].path = '../../outside.txt'
    const target = join(directory, 'attachments')
    await restoreArchiveAssets(copy, target)
    const path = copy.chat.items[0].attachments[0].path
    assert.equal(dirname(path), target)
    assert.equal(await readFile(path, 'utf8'), 'exact attachment bytes こんにちは')
    await assert.rejects(
      collectArchiveAssets({
        ...archive(),
        chat: {
          ...detail(),
          items: [
            {
              ...user,
              attachments: [{ kind: 'file', name: 'missing', path: '/missing-test-attachment' }]
            }
          ]
        }
      }),
      /Unable to export attachment/
    )
    const first = await saveChatArchive(directory, original)
    const second = await saveChatArchive(directory, original)
    assert.notEqual(first, second)
    assert.equal((await readdir(directory)).filter((file) => file.endsWith('.sele')).length, 2)
    assert.deepEqual(await decodeChatArchive(await readFile(second)), original)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('each provider imports a fresh chat, retains tools for display, routes sends/events and survives restart', async () => {
  for (const providerId of ['codex', 'claude', 'copilot', 'opencode']) {
    const h = harness()
    const router = new ImportedConversations(h.native, h.store)
    const received = []
    router.wrap(providerId).onChatUpdated((detail) => received.push(detail))
    const imported = await router.importArchive(archive(), providerId, options, () => false)
    assert.equal(imported.imported.providerId, 'codex')
    assert.equal(imported.items.length, 3)
    assert.equal(imported.items[1].itemsLoaded, false)
    const expanded = await router
      .wrap(providerId)
      .getChatWindowForItem(imported.id, 'archive:work', 10)
    assert.deepEqual(expanded.items[1].items[0], tool)
    assert.equal(imported.items[0].editTargetId, null)
    assert.deepEqual(
      h.calls[0].messages.map((message) => message.role),
      ['user', 'assistant']
    )
    assert.equal(
      h.calls.some((call) => call.send),
      false,
      'import must not execute a prompt'
    )
    const wrapper = router.wrap(providerId)
    const final = await wrapper.continueChat(imported.id, 'Continue', options)
    assert.equal(h.calls.at(-1).providerId, providerId)
    assert.deepEqual(
      final.items.map((item) => item.id),
      ['archive:user', 'archive:work', 'archive:answer', 'next-user', 'next-work', 'next-answer']
    )
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(received.at(-1).items.at(-1).content, 'Native final')
    const restarted = new ImportedConversations(h.native, h.store).wrap(providerId)
    assert.equal((await restarted.getChats()).chats[0].imported.providerId, 'codex')
    assert.equal((await restarted.getChat(imported.id)).items.length, 6)
    const window = await restarted.getChatWindow(imported.id, { startIndex: 1, limit: 1 })
    assert.equal(window.turnCount, 2)
    assert.deepEqual(
      window.items.map((item) => item.id),
      ['next-user', 'next-work', 'next-answer']
    )
    await restarted.stopChat(imported.id)
    assert.equal(h.calls.at(-1).stop, imported.id)
    await assert.rejects(restarted.forkChat(imported.id, 'archive:user'), /not supported/)
  }
})

test('failed or cancelled imports never publish a chat, including after restart', async () => {
  for (const failure of [true, false]) {
    const h = harness()
    const router = new ImportedConversations(h.native, h.store)
    let release
    h.block = new Promise((resolve) => {
      release = resolve
    })
    h.fail = failure
    let cancelled = false
    const operation = router.importArchive(archive(), 'claude', options, () => cancelled)
    while (!h.calls.length) await new Promise((resolve) => setImmediate(resolve))
    assert.equal((await router.wrap('claude').getChats()).chats.length, 0)
    cancelled = !failure
    release()
    if (failure) await assert.rejects(operation, /Native failure/)
    else assert.equal(await operation, null)
    const reloaded = new ImportedConversations(h.native, h.store)
    assert.equal((await reloaded.wrap('claude').getChats()).chats.length, 0)
    assert.equal([...h.rows.values()][0].state, 'cancelled')
  }
})

test('archived queued work is read-only and old subagent windows retain tools without resuming them', async () => {
  const h = harness()
  const source = archive()
  source.chat.subagents = [
    {
      id: 'child',
      parentId: 'source',
      title: 'Research',
      status: 'running',
      beforeItemId: 'answer'
    }
  ]
  source.chat.items[1].status = 'working'
  source.chat.items[1].items[0].mcpApp = { callId: 'old-call', serverName: 'old-server' }
  source.chat.items.push({
    id: 'queued',
    type: 'pendingMessage',
    kind: 'queued',
    content: 'Unsent prompt'
  })
  const router = new ImportedConversations(h.native, h.store)
  const imported = await router.importArchive(source, 'claude', options, () => false)
  assert.equal(imported.items[1].status, 'stopped')
  const expanded = await router.wrap('claude').getChatWindowForItem(imported.id, 'archive:work', 10)
  assert.equal(expanded.items[1].items[0].mcpApp, undefined)
  assert.equal(imported.items.at(-1).type, 'message')
  assert.equal(imported.subagents[0].parentId, imported.id)
  assert.equal(imported.subagents[0].beforeItemId, 'archive:answer')
  const child = await router
    .wrap('claude')
    .getSubagent(imported.id, 'archive:child', {}, { startIndex: 0, limit: 1 })
  assert.equal(child.canMessage, false)
  assert.equal(child.items[1].items[0].stdout, tool.stdout)
  const exported = await router.archive('claude', imported.id)
  assert.equal(exported.subagents[0].id, 'archive:child')
  assert.equal(exported.subagents[0].items[1].items[0].stdout, tool.stdout)
})

test('local Markdown images and videos are portable, with code examples and ordinary file links excluded', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-markdown-export-'))
  try {
    await writeFile(join(directory, 'plot.png'), Buffer.from([1, 2, 3]))
    await writeFile(join(directory, 'demo.mp4'), Buffer.from([4, 5, 6]))
    const original = archive()
    original.chat.cwd = directory
    original.chat.items[0].content =
      '![Plot](plot.png)\n[Demo](demo.mp4)\n[Source](README.md)\n`![Code](not-a-real-file.png)`'
    await collectArchiveAssets(original)
    assert.deepEqual(
      original.assets.map((asset) => asset.path),
      ['plot.png', 'demo.mp4']
    )
    assert.ok(original.chat.items[0].content.includes('![Plot](plot.png)'))
    const copy = await decodeChatArchive(await encodeChatArchive(original))
    await restoreArchiveAssets(copy, join(directory, 'restored'))
    assert.ok(copy.chat.items[0].content.includes(join(directory, 'restored')))
    assert.ok(copy.chat.items[0].content.includes('[Source](README.md)'))
    assert.ok(copy.chat.items[0].content.includes('`![Code](not-a-real-file.png)`'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('import environment survives restart and scopes fallback listings and transcript reads', async () => {
  const h = harness()
  const container = { kind: 'container', tool: 'ssh', name: 'remote', runtime: { kind: 'host' } }
  const router = new ImportedConversations(h.native, h.store)
  const imported = await router.importArchive(
    archive(),
    'codex',
    { ...options, container },
    () => false
  )
  assert.deepEqual(imported.container, container)
  h.native.codex.getChats = async () => ({ chats: [], nextCursor: null })
  const reloaded = new ImportedConversations(h.native, h.store)
  assert.equal(
    (await reloaded.wrap('codex').getChats({ container: { kind: 'host' } })).chats.length,
    0
  )
  assert.equal((await reloaded.wrap('codex').getChats({ container })).chats[0].id, imported.id)
  assert.deepEqual((await reloaded.wrap('codex').getChat(imported.id)).container, container)
  assert.deepEqual(h.lastReadContainer, container)
})
