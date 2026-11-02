import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatTerminalActivity } from './chatTerminalActivity.ts'
import { createPanelTerminalTask } from './panelTerminalTask.ts'

test('terminal updates address one chat and empty task sources return to the shared idle snapshot', () => {
  const store = createChatTerminalActivity()
  const idle = store.getSnapshot('never-active')
  let unrelated = 0,
    target = 0,
    all = 0
  for (let i = 0; i < 5000; i++) store.subscribeKey(`chat-${i}`, () => unrelated++)
  store.subscribeKey('target', () => target++)
  store.subscribe(() => all++)
  store.report('target', 'panel', ['running'])
  store.report('target', 'panel', ['running'])
  store.report('target', 'panel', [])
  assert.equal(store.getSnapshot('target'), idle)
  assert.equal(target, 2)
  assert.equal(all, 2)
  assert.equal(unrelated, 0)
})

for (const provider of ['codex', 'claude', 'copilot', 'opencode']) {
  test(`${provider}: panel and agent tasks share a running indicator and completion returns to idle`, () => {
    const store = createChatTerminalActivity()
    const key = `${provider}:chat`
    const idle = store.getSnapshot(key)
    store.report(key, 'panel:tab', ['panel-task'])
    store.report(key, 'agent', ['agent-task'])
    assert.deepEqual(store.getSnapshot(key), { running: true })
    store.report(key, 'panel:tab', [])
    assert.deepEqual(store.getSnapshot(key), { running: true })
    store.report(key, 'agent', [])
    assert.equal(store.getSnapshot(key), idle)
    assert.deepEqual(store.getSnapshot(key), { running: false })
  })
}

test('a first empty snapshot and duplicate updates preserve the idle snapshot', () => {
  const store = createChatTerminalActivity()
  const snapshot = store.getSnapshot('chat')
  store.report('chat', 'agent', [])
  store.report('chat', 'agent', [])
  assert.equal(store.getSnapshot('chat'), snapshot)
  store.report('chat', 'panel', ['one'])
  store.report('chat', 'panel', [])
  assert.equal(store.getSnapshot('chat'), snapshot)
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
    ['first', true],
    ['first', false],
    ['second', true],
    ['second', false]
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
    ['chat', true],
    ['chat', false],
    ['chat', true],
    ['chat', false]
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
