import assert from 'node:assert/strict'
import test from 'node:test'
import { getInitialProviderContainers, providerProcessContext } from './providerProcessContext.ts'

test('owned adapters inherit their saved environment before source-free operations or forks', () => {
  const container = { kind: 'container', tool: 'ssh', name: 'fixture' }
  const known = { record: { chatId: 'chat', container } }
  assert.deepEqual(providerProcessContext.run(known, getInitialProviderContainers), [
    ['chat', container]
  ])
  const fork = { record: { chatId: null, container }, sourceChatId: 'source' }
  assert.deepEqual(providerProcessContext.run(fork, getInitialProviderContainers), [
    ['source', container]
  ])
  fork.record.chatId = 'fork'
  assert.deepEqual(providerProcessContext.run(fork, getInitialProviderContainers), [
    ['fork', container]
  ])
  assert.deepEqual(
    providerProcessContext.run(
      { record: { chatId: 'host', container: null } },
      getInitialProviderContainers
    ),
    [['host', null]]
  )
  assert.deepEqual(getInitialProviderContainers(), [])
})
