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

test('selected tab defaults to active chats and survives restarts independently of visibility', () => {
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
    assert.equal(readChatSidebarFilter(), 'active')
    for (const filter of ['active', 'sleeping', 'working', 'all']) {
      writeChatSidebarFilter(filter)
      // A fresh initialization reads the saved preference.
      assert.equal(readChatSidebarFilter(), filter)
    }
    writeChatSidebarFilter('working')
    writeChatSidebarTabs({ all: true, active: false, sleeping: false, working: false })
    assert.equal(readChatSidebarFilter(), 'working')
    stored.set('sele:chat-sidebar-filter:v1', 'unknown-tab')
    assert.equal(readChatSidebarFilter(), 'active')
  } finally {
    delete globalThis.window
  }
})

test('all chats includes sleeping and working chats with any tab visibility', () => {
  for (const sleeping of [false, true]) {
    for (const working of [false, true]) {
      for (const showSleeping of [false, true]) {
        for (const showWorking of [false, true]) {
          const tabs = { all: true, active: true, sleeping: showSleeping, working: showWorking }
          assert.equal(matchesChatSidebarFilter(readChat, 'all', { sleeping, working, tabs }), true)
        }
      }
    }
  }
})

test('active chats excludes only categories with enabled tabs', () => {
  for (const sleeping of [false, true]) {
    for (const working of [false, true]) {
      for (const showSleeping of [false, true]) {
        for (const showWorking of [false, true]) {
          const tabs = { all: true, active: true, sleeping: showSleeping, working: showWorking }
          const expected = !(sleeping && showSleeping) && !(working && showWorking)
          assert.equal(
            matchesChatSidebarFilter(readChat, 'active', { sleeping, working, tabs }),
            expected
          )
          assert.equal(
            matchesChatSidebarFilter({ ...readChat, status: working ? 'active' : null }, 'active', {
              sleeping,
              tabs
            }),
            expected
          )
        }
      }
    }
  }
})

test('active chats includes read chats, questions, approvals, failures, and stopped chats', () => {
  for (const change of [
    {},
    { seenUpdatedAt: 0 },
    { status: 'waitingOnUserInput' },
    { status: 'waitingOnApproval' },
    { pendingApproval: {} },
    { status: 'error' },
    { lastTurnOutcome: 'failed' },
    { lastTurnOutcome: 'stopped' }
  ]) {
    assert.equal(matchesChatSidebarFilter({ ...readChat, ...change }, 'active'), true)
  }
})

test('sleeping and working tabs include their category even when categories overlap', () => {
  assert.equal(matchesChatSidebarFilter(readChat, 'sleeping'), false)
  assert.equal(matchesChatSidebarFilter(readChat, 'sleeping', { sleeping: true }), true)
  assert.equal(matchesChatSidebarFilter(readChat, 'working'), false)
  assert.equal(matchesChatSidebarFilter({ ...readChat, status: 'active' }, 'working'), true)
  assert.equal(matchesChatSidebarFilter(readChat, 'working', { working: true }), true)
  assert.equal(
    matchesChatSidebarFilter(readChat, 'sleeping', { sleeping: true, working: true }),
    true
  )
  assert.equal(
    matchesChatSidebarFilter({ ...readChat, status: 'active' }, 'working', { sleeping: true }),
    true
  )
})

test('manual unread markers survive reload', () => {
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
    const defaults = { all: true, active: true, sleeping: true, working: true }
    assert.deepEqual(readChatSidebarTabs(), defaults)
    const tabs = { ...defaults, all: false, sleeping: false }
    writeChatSidebarTabs(tabs)
    assert.deepEqual(readChatSidebarTabs(), tabs)
    stored = JSON.stringify({ all: false, active: false, sleeping: false, working: false })
    assert.deepEqual(readChatSidebarTabs(), {
      all: false,
      active: false,
      sleeping: false,
      working: false
    })
    stored = JSON.stringify({ all: 'false', active: false })
    assert.deepEqual(readChatSidebarTabs(), { ...defaults, active: false })
  } finally {
    delete globalThis.window
  }
})

test('legacy attention selection and visibility migrate to active chats', () => {
  const stored = new Map([
    ['sele:chat-sidebar-filter:v1', 'attention'],
    [
      'sele:chat-sidebar-tabs:v1',
      JSON.stringify({ all: true, attention: false, sleeping: true, working: true })
    ]
  ])
  globalThis.window = {
    preferencesApi: { getItem: (key) => ({ ok: true, value: stored.get(key) ?? null }) }
  }
  try {
    assert.equal(readChatSidebarFilter(), 'active')
    assert.deepEqual(readChatSidebarTabs(), {
      all: true,
      active: false,
      sleeping: true,
      working: true
    })
    stored.set('sele:chat-sidebar-tabs:v1', JSON.stringify({ active: true, attention: false }))
    assert.equal(readChatSidebarTabs().active, true)
  } finally {
    delete globalThis.window
  }
})
