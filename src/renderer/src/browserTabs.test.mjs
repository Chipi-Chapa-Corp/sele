import assert from 'node:assert/strict'
import test from 'node:test'
import { parseStoredBrowserSession, parseStoredBrowserWorkspaces } from './browserTabs.ts'

test('restores valid browser tabs and their active tab', () => {
  assert.deepEqual(
    parseStoredBrowserSession(
      JSON.stringify({
        activeTabId: 'docs',
        tabs: [
          { id: 'home', title: 'Example', url: 'https://example.com/' },
          { id: 'docs', title: 'Docs', url: 'https://developer.mozilla.org/' }
        ]
      })
    ),
    {
      activeTabId: 'docs',
      tabs: [
        { id: 'home', title: 'Example', url: 'https://example.com/' },
        { id: 'docs', title: 'Docs', url: 'https://developer.mozilla.org/' }
      ]
    }
  )
})

test('drops invalid and duplicate persisted browser tabs', () => {
  assert.deepEqual(
    parseStoredBrowserSession(
      JSON.stringify({
        activeTabId: 'missing',
        tabs: [
          { id: 'safe', title: '', url: 'https://example.com/path' },
          { id: 'safe', title: 'Duplicate', url: 'https://example.org/' },
          { id: 'unsafe', title: 'Unsafe', url: 'file:///tmp/page.html' },
          { id: 'blank', title: '', url: '' }
        ]
      })
    ),
    {
      activeTabId: 'safe',
      tabs: [
        { id: 'safe', title: 'example.com', url: 'https://example.com/path' },
        { id: 'blank', title: 'New tab', url: '' }
      ]
    }
  )
})

test('rejects malformed persisted browser state', () => {
  assert.equal(parseStoredBrowserSession(null), null)
  assert.equal(parseStoredBrowserSession('{broken'), null)
  assert.equal(parseStoredBrowserSession(JSON.stringify({ tabs: 'not-an-array' })), null)
})

test('restores independently scoped browser workspaces', () => {
  assert.deepEqual(
    parseStoredBrowserWorkspaces(
      JSON.stringify({
        'project:one': {
          activeTabId: 'one',
          tabs: [{ id: 'one', title: 'One', url: 'https://example.com/one' }]
        },
        'chat:two': {
          activeTabId: 'two',
          tabs: [{ id: 'two', title: 'Two', url: 'https://example.com/two' }]
        },
        broken: { tabs: 'not-an-array' }
      })
    ),
    {
      'project:one': {
        activeTabId: 'one',
        tabs: [{ id: 'one', title: 'One', url: 'https://example.com/one' }]
      },
      'chat:two': {
        activeTabId: 'two',
        tabs: [{ id: 'two', title: 'Two', url: 'https://example.com/two' }]
      }
    }
  )
})

test('rejects malformed browser workspace collections', () => {
  assert.deepEqual(parseStoredBrowserWorkspaces(null), {})
  assert.deepEqual(parseStoredBrowserWorkspaces('{broken'), {})
  assert.deepEqual(parseStoredBrowserWorkspaces(JSON.stringify([])), {})
})
