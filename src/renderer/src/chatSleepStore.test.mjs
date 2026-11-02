import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chatSleepStorageKey,
  createChatSleepStore,
  formatSleepDuration,
  legacyChatBookmarksStorageKey,
  parseSleepDuration
} from './chatSleepStore.ts'

const minute = 60_000
const hour = 60 * minute
const day = 24 * hour

const createHarness = (initial = {}, startTime = 1_000_000) => {
  const values = new Map(Object.entries(initial))
  const harness = {
    time: startTime,
    timers: [],
    values,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key)
    },
    createStore: () =>
      createChatSleepStore({
        storage: harness.storage,
        now: () => harness.time,
        setTimer: (callback, delayMs) => {
          const timer = { callback, delayMs }
          harness.timers.push(timer)
          return timer
        },
        clearTimer: (timer) => {
          harness.timers = harness.timers.filter((candidate) => candidate !== timer)
        }
      }),
    // Fires the pending timer the way a browser would, including after a late wake-up.
    advance: (durationMs) => {
      harness.time += durationMs
      const pending = harness.timers
      harness.timers = []
      for (const timer of pending) timer.callback()
    }
  }
  return harness
}

test('parses combined durations regardless of spacing and case', () => {
  assert.equal(parseSleepDuration('30m'), 30 * minute)
  assert.equal(parseSleepDuration('1h'), hour)
  assert.equal(parseSleepDuration('1d'), day)
  assert.equal(parseSleepDuration('1w 3d 5h 6m'), 10 * day + 5 * hour + 6 * minute)
  assert.equal(parseSleepDuration('1h30m'), 90 * minute)
  assert.equal(parseSleepDuration('  2 H  5 M '), 2 * hour + 5 * minute)
})

test('rejects input that is not a positive duration', () => {
  for (const input of [
    '',
    '   ',
    '30',
    'h',
    '0m',
    '0h 0m',
    '1.5h',
    '-1h',
    '1x',
    '1h soon',
    '1mo'
  ]) {
    assert.equal(parseSleepDuration(input), null, input)
  }
  assert.equal(parseSleepDuration(`${'9'.repeat(30)}w`), null)
})

test('formats a remaining time in the same format the input accepts', () => {
  const duration = 10 * day + 5 * hour + 6 * minute
  assert.equal(formatSleepDuration(duration), '1w 3d 5h 6m')
  assert.equal(parseSleepDuration(formatSleepDuration(duration)), duration)
  assert.equal(formatSleepDuration(hour), '1h')
  assert.equal(formatSleepDuration(hour + 1), '1h 1m')
  assert.equal(formatSleepDuration(1), '1m')
  assert.equal(formatSleepDuration(-1), '1m')
})

test('a timed sleep wakes on time without a reload and notifies only that chat', () => {
  const harness = createHarness()
  const store = harness.createStore()
  let target = 0
  let other = 0
  let all = 0
  store.subscribeKey('codex:a', () => target++)
  store.subscribeKey('codex:b', () => other++)
  store.subscribe(() => all++)

  store.sleep('codex:a', 30 * minute)
  store.sleep('codex:b')
  assert.deepEqual([target, other, all], [1, 1, 2])

  // No wake before the time, even though the clock is re-checked every minute.
  for (let elapsed = 0; elapsed < 29; elapsed++) harness.advance(minute)
  assert.equal(store.getSnapshot().has('codex:a'), true)
  assert.deepEqual([target, other, all], [1, 1, 2])

  harness.advance(minute)
  assert.equal(store.getSnapshot().has('codex:a'), false)
  assert.equal(store.getSnapshot().get('codex:b'), null)
  assert.deepEqual([target, other, all], [2, 1, 3])
  assert.deepEqual(JSON.parse(harness.values.get(chatSleepStorageKey)), { 'codex:b': null })
  assert.equal(harness.timers.length, 0, 'an untimed sleep needs no timer')
})

test('wakes at the exact time and survives delays longer than a timer can hold', () => {
  const harness = createHarness()
  const store = harness.createStore()
  store.sleep('codex:a', 90_500)
  assert.deepEqual(
    harness.timers.map((timer) => timer.delayMs),
    [minute]
  )
  harness.advance(minute)
  assert.deepEqual(
    harness.timers.map((timer) => timer.delayMs),
    [30_500]
  )
  harness.advance(30_500)
  assert.equal(store.getSnapshot().size, 0)

  store.sleep('codex:long', 8 * 7 * day)
  assert.deepEqual(
    harness.timers.map((timer) => timer.delayMs),
    [minute]
  )
})

test('a machine that was suspended past the wake time wakes on the next check', () => {
  const harness = createHarness()
  const store = harness.createStore()
  store.sleep('codex:a', hour)
  harness.advance(3 * day)
  assert.equal(store.getSnapshot().size, 0)
})

test('reload wakes chats whose time passed while the app was closed and keeps the rest', () => {
  const harness = createHarness()
  const first = harness.createStore()
  first.sleep('codex:expired', hour)
  first.sleep('codex:future', 3 * hour)
  first.sleep('codex:manual')

  harness.time += 2 * hour
  harness.timers = []
  const reloaded = harness.createStore()
  const snapshot = reloaded.getSnapshot()
  assert.deepEqual([...snapshot.keys()].sort(), ['codex:future', 'codex:manual'])
  assert.deepEqual(Object.keys(JSON.parse(harness.values.get(chatSleepStorageKey))).sort(), [
    'codex:future',
    'codex:manual'
  ])
  assert.deepEqual(
    harness.timers.map((timer) => timer.delayMs),
    [minute],
    'the remaining timer resumes after a reload'
  )
  harness.advance(hour)
  assert.deepEqual([...reloaded.getSnapshot().keys()], ['codex:manual'])
})

test('sleeping again replaces the timer and waking cancels it', () => {
  const harness = createHarness()
  const store = harness.createStore()
  store.sleep('codex:a', minute)
  store.sleep('codex:a', hour)
  assert.equal(harness.timers.length, 1)
  harness.advance(minute)
  assert.equal(store.getSnapshot().has('codex:a'), true)

  store.wake('codex:a')
  assert.equal(store.getSnapshot().size, 0)
  assert.equal(harness.timers.length, 0)
  assert.equal(harness.values.has(chatSleepStorageKey), false)
})

test('repeating the current state notifies nobody', () => {
  const harness = createHarness()
  const store = harness.createStore()
  let notifications = 0
  store.subscribeKey('codex:a', () => notifications++)
  store.wake('codex:a')
  store.sleep('codex:a')
  store.sleep('codex:a')
  assert.equal(notifications, 1)
})

test('existing bookmarks become untimed sleeps and do not return after waking', () => {
  const harness = createHarness({
    [legacyChatBookmarksStorageKey]: JSON.stringify(['codex:a', 'claude:b', 7, ' '])
  })
  const store = harness.createStore()
  assert.deepEqual(
    [...store.getSnapshot()],
    [
      ['codex:a', null],
      ['claude:b', null]
    ]
  )
  assert.equal(harness.values.has(legacyChatBookmarksStorageKey), false)
  assert.equal(harness.timers.length, 0)

  store.wake('codex:a')
  store.wake('claude:b')
  assert.equal(harness.createStore().getSnapshot().size, 0)
})

test('ignores invalid stored entries', () => {
  const harness = createHarness({
    [chatSleepStorageKey]: JSON.stringify({
      'codex:a': null,
      'codex:b': 'soon',
      'codex:c': 5_000_000,
      ' ': null
    })
  })
  assert.deepEqual(
    [...harness.createStore().getSnapshot()],
    [
      ['codex:a', null],
      ['codex:c', 5_000_000]
    ]
  )
})
