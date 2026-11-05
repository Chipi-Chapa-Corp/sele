import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatSleepState } from './chatSleepState.ts'

const fixture = (sleeping = null, legacy = null) => {
  let value = sleeping
  let clock = 1000
  const events = []
  const options = { read: async () => ({ sleeping: value, legacy }), write: async (next) => { await new Promise(resolve => setTimeout(resolve, 2)); value = next }, now: () => clock, broadcast: state => events.push(state) }
  return { service: createChatSleepState(options), events, setClock: next => { clock = next }, restart: () => createChatSleepState(options), stored: () => value }
}
test('existing desktop sleep state loads, retaining manual sleeps and pruning elapsed timers', async () => {
  const f = fixture(JSON.stringify({'codex:old':null,'claude:later':5000,'copilot:expired':500}))
  assert.deepEqual((await f.service.getState()).sleeping, {'codex:old':null,'claude:later':5000})
})
test('concurrent clients update individual keys without replacing another client’s changes', async () => {
  const f = fixture()
  await Promise.all([f.service.update([{key:'codex:a',wakeAt:null}]),f.service.update([{key:'claude:b',wakeAt:4000}])])
  assert.deepEqual((await f.service.getState()).sleeping, {'codex:a':null,'claude:b':4000})
  await f.service.update([{key:'codex:a',wakeAt:false,expected:null}])
  assert.deepEqual((await f.restart().getState()).sleeping, {'claude:b':4000})
  assert.ok(f.events.length >= 3)
})
test('a stale expiry or wake cannot erase a newly extended sleep', async () => {
  const f = fixture(JSON.stringify({'codex:a':2000}))
  await f.service.update([{key:'codex:a',wakeAt:9000}])
  f.setClock(3000)
  await f.service.update([{key:'codex:a',wakeAt:false,expected:2000}])
  assert.deepEqual((await f.service.getState()).sleeping, {'codex:a':9000})
})
test('legacy bookmarks migrate and do not resurrect after the final wake and restart', async () => {
  const f = fixture(null, JSON.stringify(['codex:legacy']))
  assert.deepEqual((await f.service.getState()).sleeping, {'codex:legacy':null})
  await f.service.update([{key:'codex:legacy',wakeAt:false,expected:null}])
  assert.equal(f.stored(), '{}')
  assert.deepEqual((await f.restart().getState()).sleeping, {})
})
test('rejects malformed mutations atomically and recovers for the next valid write', async () => {
  const f = fixture()
  await assert.rejects(f.service.update([{key:'codex:a',wakeAt:null},{key:'bad',wakeAt:'later'}]))
  assert.deepEqual((await f.service.getState()).sleeping, {})
  await f.service.update([{key:'codex:a',wakeAt:null}])
  assert.deepEqual((await f.service.getState()).sleeping, {'codex:a':null})
})
test('a damaged stored preference does not block startup or the next sleep', async () => {
  const f = fixture('{damaged')
  assert.deepEqual((await f.service.getState()).sleeping, {})
  await f.service.update([{key:'codex:a',wakeAt:null}])
  assert.deepEqual((await f.restart().getState()).sleeping, {'codex:a':null})
})
