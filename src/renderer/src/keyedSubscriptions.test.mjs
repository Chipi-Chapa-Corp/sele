import assert from 'node:assert/strict'
import test from 'node:test'
import { createKeyedSubscriptions } from './keyedSubscriptions.ts'

test('a row update notifies its own subscribers and aggregate consumers only', () => {
  const store = createKeyedSubscriptions()
  let global = 0,
    target = 0,
    unrelated = 0
  store.subscribe(() => global++)
  store.subscribeKey('target', () => target++)
  for (let i = 0; i < 10000; i++) store.subscribeKey(`other-${i}`, () => unrelated++)
  store.notify('target')
  assert.equal(global, 1)
  assert.equal(target, 1)
  assert.equal(unrelated, 0)
})

test('subscription cleanup is idempotent and does not delete newer subscribers', () => {
  const store = createKeyedSubscriptions()
  let calls = 0
  const first = store.subscribeKey('chat', () => assert.fail('removed listener fired'))
  first()
  const second = store.subscribeKey('chat', () => calls++)
  first()
  store.notify('chat')
  assert.equal(calls, 1)
  second()
  second()
  store.notify('chat')
  assert.equal(calls, 1)
})

test('reentrant registration waits for the next change and duplicate membership fires once', () => {
  const store = createKeyedSubscriptions()
  let added = 0,
    shared = 0
  const listener = () => shared++
  store.subscribe(listener)
  store.subscribeKey('chat', listener)
  store.subscribeKey('chat', () => store.subscribeKey('chat', () => added++))
  store.notify('chat')
  assert.equal(shared, 1)
  assert.equal(added, 0)
  store.notify('chat')
  assert.equal(shared, 2)
  assert.equal(added, 1)
})
