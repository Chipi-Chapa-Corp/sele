import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAgentTerminalSessions } from '../agentTerminalSessions.ts'
import {
  DeferredChatProcessCleanup,
  chatProcessCleanupDelayMs as delay
} from './DeferredChatProcessCleanup.ts'

const chat = (id, overrides = {}) => ({
  id,
  providerId: 'codex',
  cwd: '/project',
  projectCwd: '/project',
  container: null,
  ...overrides
})

const fixture = async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const directory = await mkdtemp(join(tmpdir(), 'sele-deferred-cleanup-'))
  const file = join(directory, 'cleanup.json')
  const calls = [],
    errors = [],
    reopened = new Set(),
    queues = []
  let fail = false
  const create = (cleanup) => {
    const queue = new DeferredChatProcessCleanup({
      file,
      cleanup: async (ids, provider) => {
        calls.push([ids, provider])
        if (fail) throw new Error('offline')
        await cleanup?.(ids)
      },
      metadata: async (id) => ({ done: !reopened.has(id) }),
      onError: (error) => errors.push(error)
    })
    queues.push(queue)
    return queue
  }
  const advance = async (queue, ms) => {
    t.mock.timers.tick(ms)
    // Timer callbacks enqueue asynchronous disk and process operations.
    await queue.work
  }
  t.after(async () => {
    await Promise.all(queues.map((queue) => queue.close()))
    await rm(directory, { recursive: true, force: true })
  })
  return {
    create,
    advance,
    calls,
    errors,
    reopened,
    file,
    fail: (value) => {
      fail = value
    }
  }
}

test('Done leaves processes alive until the full five-minute grace period expires', async (t) => {
  const h = await fixture(t),
    queue = h.create()
  queue.remember(chat('old'))
  await queue.schedule(['old'], 'codex')
  assert.deepEqual(h.calls, [])
  await h.advance(queue, delay - 1)
  assert.deepEqual(h.calls, [])
  await h.advance(queue, 1)
  assert.deepEqual(h.calls, [[['old'], 'codex']])
  assert.deepEqual(JSON.parse(await readFile(h.file, 'utf8')), [])
})

test('replacement chats retain the dev server for their whole lifetime and hand it on again', async (t) => {
  const h = await fixture(t),
    queue = h.create()
  queue.remember(chat('old'))
  await queue.schedule(['old'], 'codex')
  await h.advance(queue, delay - 1)
  await queue.created(chat('next', { providerId: 'claude' }))
  await h.advance(queue, 10 * delay)
  assert.deepEqual(h.calls, [], 'the server must not die five minutes into the next task')
  await queue.schedule(['next'], 'claude')
  await h.advance(queue, delay - 1)
  await queue.created(chat('third'))
  await h.advance(queue, 10 * delay)
  assert.deepEqual(h.calls, [])
  await queue.schedule(['third'], 'codex')
  await h.advance(queue, delay - 1)
  assert.deepEqual(h.calls, [])
  await h.advance(queue, 1)
  assert.deepEqual(h.calls, [
    [['old'], 'codex'],
    [['next'], 'claude'],
    [['third'], 'codex']
  ])
})

test('the original dev-server terminal tab remains running throughout the next task', async (t) => {
  const h = await fixture(t)
  const terminals = createAgentTerminalSessions()
  const queue = h.create((ids) => terminals.stopChats(ids))
  let stopped = false
  const server = terminals.register('dev-server', {
    providerId: 'codex',
    chatId: 'old',
    chatTitle: 'First task',
    cwd: '/project',
    container: null,
    command: 'npm run dev',
    background: true,
    stop: async () => {
      stopped = true
    }
  })
  queue.remember(chat('old'))
  await queue.schedule(['old'], 'codex')
  await h.advance(queue, delay - 1)
  await queue.created(chat('next'))
  await h.advance(queue, 10 * delay)
  assert.equal(stopped, false)
  assert.equal(terminals.list()[0].id, server.id, 'the new task keeps the original tab')
  assert.equal(terminals.status(server.id), 'running')
  await queue.schedule(['next'], 'codex')
  await h.advance(queue, delay)
  assert.equal(stopped, true)
  assert.equal(terminals.status(server.id), 'exited')
})

test('new chats in other projects or environments do not preserve unrelated processes', async (t) => {
  const h = await fixture(t),
    queue = h.create()
  queue.remember(chat('old'))
  await queue.schedule(['old'], 'codex')
  await queue.created(chat('different-project', { cwd: '/other', projectCwd: '/other' }))
  await queue.created(
    chat('remote', {
      container: { kind: 'container', tool: 'ssh', name: 'remote', runtime: { kind: 'host' } }
    })
  )
  await h.advance(queue, delay)
  assert.deepEqual(h.calls, [[['old'], 'codex']])
})

test('worktrees use the same project scope as the terminal tabs', async (t) => {
  const h = await fixture(t),
    queue = h.create()
  queue.remember(chat('old', { cwd: '/worktrees/one' }))
  await queue.schedule(['old'], 'codex')
  await queue.created(chat('next', { cwd: '/worktrees/two' }))
  await h.advance(queue, 10 * delay)
  assert.deepEqual(h.calls, [])
})

test('bulk Done waits until all replacement chats have finished', async (t) => {
  const h = await fixture(t),
    queue = h.create()
  for (const id of ['one', 'two']) queue.remember(chat(id))
  await queue.schedule(['one', 'two', 'one'])
  await queue.created(chat('next-one'))
  await queue.created(chat('next-two'))
  await queue.schedule(['next-one'])
  await h.advance(queue, 10 * delay)
  assert.deepEqual(h.calls, [])
  await queue.schedule(['next-two'])
  await h.advance(queue, delay)
  assert.deepEqual(
    h.calls.map(([ids]) => ids[0]),
    ['one', 'two', 'next-one', 'next-two']
  )
})

test('undo cancels cleanup and keeps inherited work alive until the reopened chat finishes', async (t) => {
  const h = await fixture(t),
    queue = h.create()
  queue.remember(chat('old'))
  await queue.schedule(['old'], 'codex')
  await queue.created(chat('next'))
  await queue.schedule(['next'], 'codex')
  await queue.cancel('next')
  await h.advance(queue, 10 * delay)
  assert.deepEqual(h.calls, [])
  await queue.schedule(['next'], 'codex')
  await h.advance(queue, delay)
  assert.equal(h.calls.length, 2)
})

test('a failed Done save protects inherited work as well as the unsaved chat', async (t) => {
  const h = await fixture(t),
    queue = h.create()
  queue.remember(chat('old'))
  await queue.schedule(['old'], 'codex')
  await queue.created(chat('next'))
  await queue.schedule(['next'], 'codex')
  h.reopened.add('next')
  await h.advance(queue, 10 * delay)
  assert.deepEqual(h.calls, [])
})

test('restart restores a pending deadline without extending it or cleaning up on shutdown', async (t) => {
  const h = await fixture(t),
    first = h.create()
  first.remember(chat('old'))
  await first.schedule(['old'], 'codex')
  await h.advance(first, delay - 1000)
  await first.close()
  assert.deepEqual(h.calls, [])
  const second = h.create()
  second.start()
  await second.work
  await h.advance(second, 999)
  assert.deepEqual(h.calls, [])
  await h.advance(second, 1)
  assert.deepEqual(h.calls, [[['old'], 'codex']])
})

test('restart preserves the handoff until the replacement chat is marked Done', async (t) => {
  const h = await fixture(t),
    first = h.create()
  first.remember(chat('old'))
  await first.schedule(['old'], 'codex')
  await first.created(chat('next'))
  await first.close()
  const second = h.create()
  second.start()
  await second.work
  await h.advance(second, 10 * delay)
  assert.deepEqual(h.calls, [])
  // Even before sidebar discovery, the saved holder identity is sufficient.
  await second.schedule(['next'], 'codex')
  await h.advance(second, delay)
  assert.deepEqual(h.calls, [
    [['old'], 'codex'],
    [['next'], 'codex']
  ])
})

test('a fork retains its source project processes', async (t) => {
  const h = await fixture(t),
    queue = h.create()
  queue.remember(chat('old'))
  await queue.schedule(['old'], 'codex')
  await queue.forked('fork', 'codex', 'old')
  await h.advance(queue, 10 * delay)
  assert.deepEqual(h.calls, [])
  await queue.schedule(['fork'], 'codex')
  await h.advance(queue, delay)
  assert.equal(h.calls.length, 2)
})

test('cleanup failures retain ownership and retry after another five minutes', async (t) => {
  const h = await fixture(t),
    queue = h.create()
  queue.remember(chat('old'))
  await queue.schedule(['old'], 'codex')
  h.fail(true)
  await h.advance(queue, delay)
  assert.equal(h.calls.length, 1)
  assert.equal(h.errors.length, 1)
  h.fail(false)
  await h.advance(queue, delay - 1)
  assert.equal(h.calls.length, 1)
  await h.advance(queue, 1)
  assert.equal(h.calls.length, 2)
})
