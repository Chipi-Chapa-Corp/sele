import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getEffectiveChatTurnWindow,
  getLatestChatTurnWindow,
  shiftChatTurnWindow
} from './chatTurnWindow.ts'

const latestWindow = {
  chatKey: 'codex:chat-1',
  startIndex: 90,
  endIndex: 100,
  totalCount: 100
}

test('keeps the latest view limited to the payload-loaded page', () => {
  assert.deepEqual(getLatestChatTurnWindow('codex:chat-1', 100, 10), latestWindow)
})

test('shows a newly appended latest turn without waiting for the stored window to catch up', () => {
  const nextLatestWindow = getLatestChatTurnWindow('codex:chat-1', 101, 10)

  assert.deepEqual(getEffectiveChatTurnWindow(latestWindow, nextLatestWindow, true), {
    chatKey: 'codex:chat-1',
    startIndex: 91,
    endIndex: 101,
    totalCount: 101
  })
})

test('advances an initially empty chat window when its first turn arrives', () => {
  const emptyWindow = {
    chatKey: 'opencode:new-chat',
    startIndex: 0,
    endIndex: 0,
    totalCount: 0
  }
  const firstTurnWindow = getLatestChatTurnWindow('opencode:new-chat', 1, 10)

  assert.equal(getEffectiveChatTurnWindow(emptyWindow, firstTurnWindow, false), firstTurnWindow)
})

test('does not move a stale latest window while the user is reading earlier content', () => {
  const nextLatestWindow = getLatestChatTurnWindow('codex:chat-1', 101, 10)

  assert.equal(getEffectiveChatTurnWindow(latestWindow, nextLatestWindow, false), latestWindow)
})

test('does not replace an explicitly paged earlier window', () => {
  const earlierWindow = { ...latestWindow, startIndex: 70, endIndex: 90 }
  const nextLatestWindow = getLatestChatTurnWindow('codex:chat-1', 101, 10)

  assert.equal(getEffectiveChatTurnWindow(earlierWindow, nextLatestWindow, true), earlierWindow)
})

test('grows the initial page while retaining the previous visible turns', () => {
  assert.deepEqual(shiftChatTurnWindow(latestWindow, 'older', 80, 90, 100, 20), {
    chatKey: 'codex:chat-1',
    startIndex: 80,
    endIndex: 100,
    totalCount: 100
  })
})

test('slides an overlapping bounded window toward older turns', () => {
  assert.deepEqual(
    shiftChatTurnWindow({ ...latestWindow, startIndex: 80 }, 'older', 70, 80, 100, 20),
    {
      chatKey: 'codex:chat-1',
      startIndex: 70,
      endIndex: 90,
      totalCount: 100
    }
  )
})

test('slides the same window back toward newer turns', () => {
  assert.deepEqual(
    shiftChatTurnWindow(
      { ...latestWindow, startIndex: 70, endIndex: 90 },
      'newer',
      90,
      100,
      100,
      20
    ),
    {
      chatKey: 'codex:chat-1',
      startIndex: 80,
      endIndex: 100,
      totalCount: 100
    }
  )
})
