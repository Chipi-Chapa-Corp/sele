import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseReadCache } from './readCache.ts'

test('reads share pending work, invalidate after writes, and never retain failures', async () => {
  const cache = new DatabaseReadCache(2)
  const db = {}
  let finish
  let reads = 0
  const old = cache.read(db, 'chat', () => {
    reads++
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  assert.equal(
    cache.read(db, 'chat', () => assert.fail('duplicate read')),
    old
  )
  cache.invalidate('chat')
  assert.equal(await cache.read(db, 'chat', async () => ++reads), 2)
  finish(1)
  assert.equal(await old, 1)
  assert.equal(
    await cache.read(db, 'chat', () => assert.fail('stale read replaced fresh cache')),
    2
  )
  await assert.rejects(
    cache.read(db, 'broken', async () => {
      throw new Error('offline')
    }),
    /offline/
  )
  assert.equal(await cache.read(db, 'broken', async () => 'recovered'), 'recovered')
  assert.equal(await cache.read({}, 'chat', async () => 'new database'), 'new database')
})

test('least recently used entries are bounded', async () => {
  const cache = new DatabaseReadCache(2)
  const db = {}
  await cache.read(db, 'a', async () => 'a')
  await cache.read(db, 'b', async () => 'b')
  await cache.read(db, 'a', async () => assert.fail('cached'))
  await cache.read(db, 'c', async () => 'c')
  assert.equal(await cache.read(db, 'b', async () => 'reloaded'), 'reloaded')
})
