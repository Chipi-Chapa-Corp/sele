import assert from 'node:assert/strict'
import test from 'node:test'
import {
  matchesChatSidebarFilter,
  readChatSidebarFilter,
  readChatSidebarTabs,
  writeChatSidebarFilter,
  writeChatSidebarTabs
} from './chatSidebarFilter.ts'
import { readManuallyUnreadChats, writeManuallyUnreadChats } from './manualChatReadState.ts'

const readChat = {
  status: null,
  lastTurnOutcome: null,
  pendingApproval: null,
  updatedAt: 10,
  seenUpdatedAt: 10,
  done: false
}

test('selected tab defaults to all chats and survives restarts independently of visibility', () => {
  const stored = new Map()
  globalThis.window = {
    preferencesApi: {
      getItem: (key) => ({ ok: true, value: stored.get(key) ?? null }),
      setItem: (key, value) => {
        stored.set(key, value)
        return { ok: true, value: null }
      }
    }
  }
  try {
    assert.equal(readChatSidebarFilter(), 'all')
    for (const filter of ['attention', 'sleeping', 'working', 'all']) {
      writeChatSidebarFilter(filter)
      // A fresh initialization reads the saved preference.
      assert.equal(readChatSidebarFilter(), filter)
    }
    writeChatSidebarFilter('working')
    writeChatSidebarTabs({ all: true, attention: false, sleeping: false, working: false })
    assert.equal(readChatSidebarFilter(), 'working')
    stored.set('sele:chat-sidebar-filter:v1', 'unknown-tab')
    assert.equal(readChatSidebarFilter(), 'all')
  } finally {
    delete globalThis.window
  }
})

test('sleeping chats stay in their own tab even when unread, failed, or active', () => {
  for (const status of [null, 'active', 'error', 'waitingOnUserInput']) {
    const chat = { ...readChat, status, seenUpdatedAt: 0, lastTurnOutcome: 'failed' }
    for (const filter of ['all', 'attention', 'working']) {
      assert.equal(matchesChatSidebarFilter(chat, filter, { sleeping: true }), false)
    }
    assert.equal(matchesChatSidebarFilter(chat, 'sleeping', { sleeping: true }), true)
    assert.equal(matchesChatSidebarFilter(chat, 'sleeping'), false)
  }
})

test('attention includes unread chats, questions, approvals, and failures', () => {
  assert.equal(matchesChatSidebarFilter(readChat, 'attention'), false)
  for (const change of [
    { seenUpdatedAt: 9 },
    { status: 'waitingOnUserInput' },
    { status: 'waitingOnApproval' },
    { pendingApproval: {} },
    { status: 'error' },
    { lastTurnOutcome: 'failed' }
  ]) {
    assert.equal(matchesChatSidebarFilter({ ...readChat, ...change }, 'attention'), true)
  }
  assert.equal(
    matchesChatSidebarFilter({ ...readChat, seenUpdatedAt: 0 }, 'attention', { selected: true }),
    true
  )
  assert.equal(
    matchesChatSidebarFilter({ ...readChat, seenUpdatedAt: 0, done: true }, 'attention'),
    false
  )
  assert.equal(
    matchesChatSidebarFilter(readChat, 'attention', { latestCommitFinishedAt: 11 }),
    true
  )
  assert.equal(
    matchesChatSidebarFilter({ ...readChat, lastTurnOutcome: 'stopped' }, 'attention'),
    false
  )
})

test('working includes active chats and ongoing child or commit work', () => {
  assert.equal(matchesChatSidebarFilter(readChat, 'working'), false)
  assert.equal(matchesChatSidebarFilter({ ...readChat, status: 'active' }, 'working'), true)
  assert.equal(matchesChatSidebarFilter(readChat, 'working', { working: true }), true)
  assert.equal(matchesChatSidebarFilter(readChat, 'all'), true)
})

test('opening an unread chat keeps it available until selection changes or it is marked done', () => {
  const unread = { ...readChat, seenUpdatedAt: 0 }
  assert.equal(matchesChatSidebarFilter(unread, 'attention'), true)
  assert.equal(matchesChatSidebarFilter(readChat, 'attention', { selected: true }), true)
  assert.equal(matchesChatSidebarFilter(readChat, 'attention'), false)
  assert.equal(
    matchesChatSidebarFilter({ ...readChat, done: true }, 'attention', { selected: true }),
    false
  )
  assert.equal(matchesChatSidebarFilter(readChat, 'attention', { manuallyUnread: true }), true)
})

test('manual unread markers survive reload and automatic seen timestamps', () => {
  let stored = null
  globalThis.window = {
    preferencesApi: {
      getItem: () => ({ ok: true, value: stored }),
      setItem: (_key, value) => {
        stored = value
        return { ok: true, value: null }
      },
      removeItem: () => {
        stored = null
        return { ok: true, value: null }
      }
    }
  }
  try {
    assert.equal(readManuallyUnreadChats().size, 0)
    writeManuallyUnreadChats(new Set(['codex:chat', 'claude:chat']))
    assert.deepEqual([...readManuallyUnreadChats()], ['codex:chat', 'claude:chat'])
    assert.equal(
      matchesChatSidebarFilter({ ...readChat, seenUpdatedAt: 100 }, 'attention', {
        manuallyUnread: true
      }),
      true
    )
    writeManuallyUnreadChats(new Set())
    assert.equal(readManuallyUnreadChats().size, 0)
  } finally {
    delete globalThis.window
  }
})

test('tab visibility persists and disabled tabs are preserved and invalid values use defaults', () => {
  let stored = null
  globalThis.window = {
    preferencesApi: {
      getItem: () => ({ ok: true, value: stored }),
      setItem: (_key, value) => {
        stored = value
        return { ok: true, value: null }
      }
    }
  }
  try {
    const defaults = { all: true, attention: true, sleeping: true, working: true }
    assert.deepEqual(readChatSidebarTabs(), defaults)
    const tabs = { ...defaults, all: false, sleeping: false }
    writeChatSidebarTabs(tabs)
    assert.deepEqual(readChatSidebarTabs(), tabs)
    stored = JSON.stringify({ all: false, attention: false, sleeping: false, working: false })
    assert.deepEqual(readChatSidebarTabs(), {
      all: false,
      attention: false,
      sleeping: false,
      working: false
    })
    stored = JSON.stringify({ all: 'false', attention: false })
    assert.deepEqual(readChatSidebarTabs(), { ...defaults, attention: false })
  } finally {
    delete globalThis.window
  }
})
