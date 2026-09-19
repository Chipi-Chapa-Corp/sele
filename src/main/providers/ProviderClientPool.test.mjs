import assert from 'node:assert/strict'
import test from 'node:test'
import { ProviderClientPool } from './ProviderClientPool.ts'

test('invalidateKey closes cached entries and creates a fresh client', async () => {
  const closed = []
  const pool = new ProviderClientPool((entry) => closed.push(entry.id))
  const first = await pool.get('account:host', async () => ({ id: 'first' }))

  pool.invalidateKey('account:host')
  const second = await pool.get('account:host', async () => ({ id: 'second' }))

  assert.deepEqual(closed, ['first'])
  assert.notEqual(second, first)
  assert.equal(second.id, 'second')
})

test('invalidateKey prevents a pending stale client from entering the pool', async () => {
  const closed = []
  let resolveStale
  const pool = new ProviderClientPool((entry) => closed.push(entry.id))
  const stale = pool.get('account:host', () => new Promise((resolve) => (resolveStale = resolve)))

  pool.invalidateKey('account:host')
  const fresh = await pool.get('account:host', async () => ({ id: 'fresh' }))
  resolveStale({ id: 'stale' })

  await assert.rejects(stale, /invalidated/)
  assert.equal(fresh.id, 'fresh')
  assert.deepEqual(closed, ['stale'])
  assert.equal(await pool.get('account:host', async () => ({ id: 'unexpected' })), fresh)
})
