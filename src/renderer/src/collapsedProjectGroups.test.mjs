import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collapsedProjectGroupsStorageKey,
  parseStoredCollapsedProjectGroups,
  readStoredCollapsedProjectGroups,
  writeStoredCollapsedProjectGroups
} from './collapsedProjectGroups.ts'

test('restores collapsed project groups', () => {
  assert.deepEqual(
    parseStoredCollapsedProjectGroups(JSON.stringify(['cwd:/projects/one', 'cwd:/projects/two'])),
    {
      'cwd:/projects/one': true,
      'cwd:/projects/two': true
    }
  )
})

test('drops invalid and non-project group keys', () => {
  assert.deepEqual(
    parseStoredCollapsedProjectGroups(
      JSON.stringify(['pinned', 'done', '', false, 'cwd:/valid', 'cwd:/valid'])
    ),
    { 'cwd:/valid': true }
  )
})

test('rejects malformed collapsed project state', () => {
  assert.deepEqual(parseStoredCollapsedProjectGroups(null), {})
  assert.deepEqual(parseStoredCollapsedProjectGroups('{broken'), {})
  assert.deepEqual(parseStoredCollapsedProjectGroups(JSON.stringify({ 'cwd:/one': true })), {})
})

test('persists only collapsed project groups and removes empty state', (context) => {
  const previousWindow = globalThis.window
  const storedValues = new Map()
  globalThis.window = {
    localStorage: {
      getItem: (key) => storedValues.get(key) ?? null,
      removeItem: (key) => storedValues.delete(key),
      setItem: (key, value) => storedValues.set(key, value)
    }
  }
  context.after(() => {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  })

  writeStoredCollapsedProjectGroups({
    'cwd:/collapsed': true,
    'cwd:/expanded': false,
    done: true
  })

  assert.equal(
    storedValues.get(collapsedProjectGroupsStorageKey),
    JSON.stringify(['cwd:/collapsed'])
  )
  assert.deepEqual(readStoredCollapsedProjectGroups(), { 'cwd:/collapsed': true })

  writeStoredCollapsedProjectGroups({ 'cwd:/collapsed': false })
  assert.equal(storedValues.has(collapsedProjectGroupsStorageKey), false)
})
