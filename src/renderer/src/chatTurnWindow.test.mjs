import assert from 'node:assert/strict'
import test from 'node:test'
import { getLatestChatTurnWindow, shiftChatTurnWindow } from './chatTurnWindow.ts'

const latestWindow = {
  chatKey: 'codex:chat-1',
  startIndex: 90,
  endIndex: 100,
  totalCount: 100
}

test('keeps the latest view limited to the payload-loaded page', () => {
  assert.deepEqual(getLatestChatTurnWindow('codex:chat-1', 100, 10), latestWindow)
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
