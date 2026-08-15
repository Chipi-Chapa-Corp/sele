import assert from 'node:assert/strict'
import test from 'node:test'
import { ProviderClientPool } from './ProviderClientPool.ts'

test('reuses one provider client per environment and isolates different environments', async () => {
  const closed = []
  const pool = new ProviderClientPool((entry) => closed.push(entry))
  let createCount = 0
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const create = async () => ({ id: ++createCount })

  const [first, second] = await Promise.all([pool.get('host', create), pool.get('host', create)])
  const third = await pool.get('host', create)
  const container = await pool.get('docker:development', create)

  assert.equal(createCount, 2)
  assert.equal(first, second)
  assert.equal(second, third)
  assert.notEqual(first, container)

  pool.dispose()
  assert.deepEqual(closed, [first, container])
})

test('replaces invalid clients and rejects reads after disposal', async () => {
  const closed = []
  const pool = new ProviderClientPool((entry) => closed.push(entry))
  const first = await pool.get('host', async () => ({ id: 1 }))

  pool.invalidate('host', first)
  const second = await pool.get('host', async () => ({ id: 2 }))

  assert.notEqual(first, second)
  assert.deepEqual(closed, [first])

  pool.dispose()
  assert.deepEqual(closed, [first, second])
  await assert.rejects(
    pool.get('host', async () => ({ id: 3 })),
    /client pool is closed/
  )
})
