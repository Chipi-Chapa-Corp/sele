import assert from 'node:assert/strict'
import test from 'node:test'
import { getClosedBenchmarkRounds, getLatestBenchmarkRound } from './benchmark.ts'

const user = (id, content) => ({ type: 'message', role: 'user', id, content })
const answer = (id, content) => ({ type: 'message', role: 'assistant', id, content })

test('a queued benchmark prompt closes the previous round once both deliveries are confirmed', () => {
  const primary = [user('p1', 'first'), answer('pa1', 'left'), user('p2', 'next')]
  const secondary = [user('s1', 'first'), answer('sa1', 'right')]
  assert.equal(getLatestBenchmarkRound(primary, secondary), null)
  assert.deepEqual(getClosedBenchmarkRounds(primary, secondary), [])
  secondary.push(user('s2', 'next'))
  const [closed] = getClosedBenchmarkRounds(primary, secondary)
  assert.equal(closed.turnId, 'p1')
  assert.equal(closed.secondary[0].id, 's1')
  assert.equal(closed.votable, true)
  assert.equal(getLatestBenchmarkRound(primary, secondary), null)
  primary.push(answer('pa2', 'left again'))
  secondary.push(answer('sa2', 'right again'))
  assert.equal(getLatestBenchmarkRound(primary, secondary)?.turnId, 'p2')
})
