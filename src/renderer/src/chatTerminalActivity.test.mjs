import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatTerminalActivity } from './chatTerminalActivity.ts'
import { createPanelTerminalTask } from './panelTerminalTask.ts'

for (const provider of ['codex', 'claude', 'copilot', 'opencode']) {
  test(`${provider}: panel and agent tasks share one idle indicator and completion marker`, () => {
    const store = createChatTerminalActivity()
    const key = `${provider}:chat`
    store.setIdle(key, true)
    store.report(key, 'panel:tab', ['panel-task'])
    store.report(key, 'agent', ['agent-task'])
    assert.deepEqual(store.getSnapshot(key), { running: true, unread: false })
    store.markSeen(key)
    store.report(key, 'panel:tab', [])
    assert.deepEqual(store.getSnapshot(key), { running: true, unread: true })
    store.report(key, 'agent', [])
    assert.deepEqual(store.getSnapshot(key), { running: false, unread: true })
    store.markSeen(key)
    assert.deepEqual(store.getSnapshot(key), { running: false, unread: false })
  })
}

test('completion while the chat is working does not create an idle-task unread marker', () => {
  const store = createChatTerminalActivity()
  store.setIdle('chat', false)
  store.report('chat', 'agent', ['one'])
  store.report('chat', 'agent', [])
  assert.equal(store.getSnapshot('chat').unread, false)
  store.setIdle('chat', true)
  store.report('chat', 'agent', ['two'])
  store.report('chat', 'agent', [])
  assert.equal(store.getSnapshot('chat').unread, true)
})

test('a first empty snapshot, duplicate updates and deliberate tab closure do not invent completions', () => {
  const store = createChatTerminalActivity()
  store.setIdle('chat', true)
  store.report('chat', 'agent', [])
  const snapshot = store.getSnapshot('chat')
  store.report('chat', 'agent', [])
  assert.equal(store.getSnapshot('chat'), snapshot)
  store.report('chat', 'panel', ['one'])
  store.report('chat', 'panel', [], false)
  assert.equal(store.getSnapshot('chat').unread, false)
})

test('terminal unread state survives restart and clears only when that chat is read', () => {
  const store = createChatTerminalActivity()
  let saved = []
  store.initialize([], (keys) => {
    saved = keys
  })
  store.setIdle('chat', true)
  store.report('chat', 'agent', ['one'])
  store.report('chat', 'agent', [])
  const restarted = createChatTerminalActivity()
  restarted.initialize(saved, (keys) => {
    saved = keys
  })
  assert.deepEqual(restarted.getSnapshot('chat'), { running: false, unread: true })
  restarted.markSeen('other')
  assert.equal(restarted.getSnapshot('chat').unread, true)
  restarted.markSeen('chat')
  assert.deepEqual(saved, [])
})

test('a panel command retains its launching chat when selection changes, then uses the new chat for the next command', async () => {
  const events = []
  let selected = 'first'
  let hasActiveProcess = true
  const task = createPanelTerminalTask({
    initialChatKey: 'first',
    currentChatKey: () => selected,
    readStatus: async () => ({ hasActiveProcess, processName: 'sleep' }),
    report: (...event) => events.push(event)
  })
  task.input('sleep 1\r')
  await task.check()
  selected = 'second'
  hasActiveProcess = false
  await task.check()
  task.input('sleep 1\r')
  task.output('\x1b]777;sele-command-finished;0\x07')
  assert.deepEqual(events, [
    ['first', true, false],
    ['first', false, true],
    ['second', true, false],
    ['second', false, true]
  ])
})

test('keep-open commands and shell integration finish without closing the terminal tab', () => {
  const events = []
  const task = createPanelTerminalTask({
    initialChatKey: 'chat',
    currentChatKey: () => 'chat',
    readStatus: async () => ({ hasActiveProcess: false, processName: 'shell' }),
    report: (...event) => events.push(event)
  })
  task.start()
  task.output('\x1b]777;sele-command-fin')
  task.output('ished;1\x07')
  task.output('\x1b]133;C\x07')
  task.output('\x1b]133;D;0\x07')
  assert.deepEqual(events, [
    ['chat', true, false],
    ['chat', false, true],
    ['chat', true, false],
    ['chat', false, true]
  ])
})

test('late process-status responses cannot resurrect a finished or disposed command', async () => {
  let resolve
  const events = []
  const task = createPanelTerminalTask({
    initialChatKey: 'chat',
    currentChatKey: () => 'chat',
    readStatus: () =>
      new Promise((done) => {
        resolve = done
      }),
    report: (...event) => events.push(event)
  })
  task.start()
  const checking = task.check()
  task.finish()
  task.dispose()
  resolve({ hasActiveProcess: true, processName: 'sleep' })
  await checking
  assert.equal(events.length, 2)
})
