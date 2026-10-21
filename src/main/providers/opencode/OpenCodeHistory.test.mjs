import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpencodeClient } from '@opencode-ai/sdk/v2'
import {
  forEachOpenCodeHistoryMessage,
  loadOpenCodeMessages,
  openCodeHistoryPageSize
} from './OpenCodeHistory.ts'

const session = { id: 'chat', directory: '/fixture/project' }
const message = (index) => ({ info: { id: `msg-${index}` }, parts: [] })

test('full history uses bounded SDK responses and opaque cursors in chronological order', async () => {
  const history = Array.from({ length: openCodeHistoryPageSize * 3 + 7 }, (_, i) => message(i))
  const requests = []
  let heartbeat = 0
  const client = createOpencodeClient({
    baseUrl: 'http://opencode.test',
    fetch: async (request) => {
      const url = new URL(request.url)
      const limit = Number(url.searchParams.get('limit'))
      const before = url.searchParams.get('before')
      assert.equal(limit, openCodeHistoryPageSize)
      assert.equal(url.searchParams.get('directory'), session.directory)
      assert.ok(
        !requests.length || heartbeat > requests.at(-1).heartbeat,
        'the app event loop must run between history responses'
      )
      requests.push({ before, heartbeat })
      setImmediate(() => heartbeat++)
      const end = before ? Number(before.split(':')[1]) : history.length
      const start = Math.max(0, end - limit)
      return Response.json(history.slice(start, end), {
        headers: start ? { 'X-Next-Cursor': `opaque:${start}` } : {}
      })
    }
  })
  const result = await loadOpenCodeMessages(client, session)
  assert.deepEqual(result, history)
  assert.equal(requests.length, 4)
  assert.equal(new Set(result.map((record) => record.info.id)).size, history.length)
})

test('previews fetch only the requested tail even when an older cursor is available', async () => {
  let reads = 0
  const client = {
    session: {
      messages: async (input) => {
        reads++
        assert.equal(input.limit, 8)
        return {
          data: [message(1)],
          response: new Response(null, {
            headers: { 'X-Next-Cursor': 'older' }
          })
        }
      }
    }
  }
  assert.deepEqual(await loadOpenCodeMessages(client, session, 8), [message(1)])
  assert.equal(reads, 1)
})

test('only the cursor decides whether full history has another page', async () => {
  let reads = 0
  const client = {
    session: {
      messages: async () => {
        reads++
        return {
          data: [message(reads)],
          response: new Response(null, {
            headers: reads === 1 ? { 'X-Next-Cursor': 'older' } : {}
          })
        }
      }
    }
  }
  assert.deepEqual(await loadOpenCodeMessages(client, session), [message(2), message(1)])
  assert.equal(reads, 2)
})

test('an exact full final page without a cursor completes without another request', async () => {
  let reads = 0
  const history = Array.from({ length: openCodeHistoryPageSize }, (_, i) => message(i))
  const client = {
    session: {
      messages: async () => {
        reads++
        return { data: history, response: new Response() }
      }
    }
  }
  assert.deepEqual(await loadOpenCodeMessages(client, session), history)
  assert.equal(reads, 1)
})

test('failed older pages reject the load instead of publishing an incomplete history', async () => {
  let reads = 0
  const client = {
    session: {
      messages: async () => {
        if (++reads === 2) throw new Error('offline')
        return {
          data: [message(1)],
          response: new Response(null, {
            headers: { 'X-Next-Cursor': 'older' }
          })
        }
      }
    }
  }
  await assert.rejects(loadOpenCodeMessages(client, session), /offline/)
})

test('a repeated cursor fails instead of trapping the app in an endless history load', async () => {
  const client = {
    session: {
      messages: async () => ({
        data: [message(1)],
        response: new Response(null, {
          headers: { 'X-Next-Cursor': 'unchanged' }
        })
      })
    }
  }
  await assert.rejects(loadOpenCodeMessages(client, session), /pagination did not advance/)
})

test('expensive usage listeners yield to the app before processing the rest of history', async () => {
  const visits = []
  let heartbeat = false
  setImmediate(() => {
    heartbeat = true
  })
  await forEachOpenCodeHistoryMessage([message(0), message(1), message(2)], (record) => {
    visits.push([record.info.id, heartbeat])
    // One expensive listener is enough to consume the processing budget.
    const started = performance.now()
    while (performance.now() - started < 10) {}
  })
  assert.deepEqual(visits, [
    ['msg-0', false],
    ['msg-1', true],
    ['msg-2', true]
  ])
})
