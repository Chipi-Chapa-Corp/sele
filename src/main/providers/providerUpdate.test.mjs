import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectActiveProviderChats,
  getProviderUpdateImpact,
  stopActiveProviderChats
} from './providerUpdate.ts'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const chat = (id, status) => ({ id, status })

test('collects active chats across pages and ignores terminal and error states', async () => {
  const pages = new Map([
    [
      null,
      {
        chats: [
          chat('active', 'active'),
          chat('finished', null),
          chat('approval', 'waitingOnApproval')
        ],
        nextCursor: 'next'
      }
    ],
    [
      'next',
      {
        chats: [chat('input', 'waitingOnUserInput'), chat('failed', 'error')],
        nextCursor: null
      }
    ]
  ])
  const adapter = {
    getChats: async ({ cursor = null }) => pages.get(cursor),
    stopChat: async () => {}
  }

  const activeChats = await collectActiveProviderChats(adapter, { forceRefresh: true })

  assert.deepEqual(
    activeChats.map(({ id }) => id),
    ['active', 'approval', 'input']
  )
  assert.deepEqual(await getProviderUpdateImpact(adapter), { activeChatCount: 3 })
})

test('stops every active chat and reports aggregate failure after all attempts settle', async () => {
  const stopped = []
  const adapter = {
    getChats: async () => ({ chats: [], nextCursor: null }),
    stopChat: async (id) => {
      stopped.push(id)
      if (id === 'second') throw new Error('stop failed')
    }
  }

  await assert.rejects(
    stopActiveProviderChats(adapter, [chat('first', 'active'), chat('second', 'active')]),
    /Unable to stop 1 of 2 active chats before updating: stop failed/
  )
  assert.deepEqual(stopped, ['first', 'second'])
})

test('stops pagination when a provider repeats its cursor', async () => {
  let reads = 0
  const adapter = {
    getChats: async () => {
      reads += 1
      return { chats: [chat('active', 'active')], nextCursor: 'same' }
    },
    stopChat: async () => {}
  }

  const activeChats = await collectActiveProviderChats(adapter)

  assert.equal(reads, 2)
  assert.deepEqual(
    activeChats.map(({ id }) => id),
    ['active']
  )
})
