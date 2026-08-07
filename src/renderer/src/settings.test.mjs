import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appMaxChatsRenderedDefault, normalizeAppMaxChatsRendered } from './performanceSettings.ts'

test('defaults the maximum rendered chats to 20', () => {
  assert.equal(appMaxChatsRenderedDefault, 20)
  assert.equal(normalizeAppMaxChatsRendered(undefined), 20)
})

test('normalizes maximum rendered chat counts', () => {
  assert.equal(normalizeAppMaxChatsRendered(34.8), 34)
  assert.equal(normalizeAppMaxChatsRendered(0), 1)
  assert.equal(normalizeAppMaxChatsRendered(10_000), 100)
})
