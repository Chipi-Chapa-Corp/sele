import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collapseProjectGroups,
  getExpandedProjectGroupKeys,
  restoreExpandedProjectGroups,
  sortChatsForSidebarSection,
  sortProjectGroupsForSidebar
} from './chatSidebarOrder.ts'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const chat = (id, createdAt, sidebarOrder = null) => ({
  id,
  providerId: 'codex',
  createdAt,
  sidebarOrder
})

test('sorts chats without saved positions by creation time, newest first', () => {
  assert.deepEqual(
    sortChatsForSidebarSection([chat('oldest', 100), chat('newest', 300), chat('middle', 200)]).map(
      ({ id }) => id
    ),
    ['newest', 'middle', 'oldest']
  )
})

test('honors saved drag positions', () => {
  assert.deepEqual(
    sortChatsForSidebarSection([
      chat('created-first', 300, 2),
      chat('dragged-first', 100, 0),
      chat('dragged-middle', 200, 1)
    ]).map(({ id }) => id),
    ['dragged-first', 'dragged-middle', 'created-first']
  )
})

test('puts newly created unpositioned chats above a saved arrangement', () => {
  assert.deepEqual(
    sortChatsForSidebarSection([
      chat('saved-first', 300, 0),
      chat('newer', 500),
      chat('saved-second', 400, 1),
      chat('newest', 600)
    ]).map(({ id }) => id),
    ['newest', 'newer', 'saved-first', 'saved-second']
  )
})

test('sorts project sections by project creation time, newest first', () => {
  const groups = [
    { key: 'cwd:/older', cwd: '/older', label: 'Older' },
    { key: 'cwd:/newer', cwd: '/newer', label: 'Newer' }
  ]
  const projects = new Map([
    ['/older', { addedAt: 100, sidebarOrder: null }],
    ['/newer', { addedAt: 200, sidebarOrder: null }]
  ])

  assert.deepEqual(
    sortProjectGroupsForSidebar(groups, projects).map(({ key }) => key),
    ['cwd:/newer', 'cwd:/older']
  )
})

test('keeps chat-only project sections in a deterministic fallback order', () => {
  const groups = [
    { key: 'cwd:/zeta', cwd: '/zeta', label: 'Zeta' },
    { key: 'cwd:/registered', cwd: '/registered', label: 'Registered' },
    { key: 'cwd:/alpha', cwd: '/alpha', label: 'Alpha' }
  ]
  const projects = new Map([['/registered', { addedAt: 100, sidebarOrder: null }]])

  assert.deepEqual(
    sortProjectGroupsForSidebar(groups, projects).map(({ key }) => key),
    ['cwd:/registered', 'cwd:/alpha', 'cwd:/zeta']
  )
})

test('honors saved project drag positions', () => {
  const groups = [
    { key: 'cwd:/newest', cwd: '/newest', label: 'Newest' },
    { key: 'cwd:/oldest', cwd: '/oldest', label: 'Oldest' }
  ]
  const projects = new Map([
    ['/newest', { addedAt: 300, sidebarOrder: 1 }],
    ['/oldest', { addedAt: 100, sidebarOrder: 0 }]
  ])

  assert.deepEqual(
    sortProjectGroupsForSidebar(groups, projects).map(({ key }) => key),
    ['cwd:/oldest', 'cwd:/newest']
  )
})

test('puts a newly created project above a saved arrangement', () => {
  const groups = [
    { key: 'cwd:/saved', cwd: '/saved', label: 'Saved' },
    { key: 'cwd:/new', cwd: '/new', label: 'New' }
  ]
  const projects = new Map([
    ['/saved', { addedAt: 100, sidebarOrder: 0 }],
    ['/new', { addedAt: 200, sidebarOrder: null }]
  ])

  assert.deepEqual(
    sortProjectGroupsForSidebar(groups, projects).map(({ key }) => key),
    ['cwd:/new', 'cwd:/saved']
  )
})

test('collapses projects for dragging and restores only those previously expanded', () => {
  const projectGroupKeys = ['cwd:/one', 'cwd:/two', 'cwd:/three']
  const collapsedGroups = {
    'cwd:/one': false,
    'cwd:/two': true,
    'cwd:/three': false,
    done: false
  }
  const expandedGroups = getExpandedProjectGroupKeys(projectGroupKeys, collapsedGroups)
  const collapsedForDrag = collapseProjectGroups(collapsedGroups, projectGroupKeys)

  assert.deepEqual(collapsedForDrag, {
    'cwd:/one': true,
    'cwd:/two': true,
    'cwd:/three': true,
    done: false
  })
  assert.deepEqual(
    restoreExpandedProjectGroups(collapsedForDrag, projectGroupKeys, expandedGroups),
    collapsedGroups
  )
})
