import assert from 'node:assert/strict'
import test from 'node:test'
import { LimitResetQueue } from './LimitResetQueue.ts'
import { createLimitResetDelivery } from './LimitResetDelivery.ts'

const start = 1_800_000_000_000
const options = {
  model: 'saved-model',
  cwd: '/repo',
  noProject: false,
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
  sandboxMode: 'workspace-write',
  serviceTier: null
}
const limits = [
  {
    id: 'primary',
    label: 'Codex',
    kind: 'primary',
    windowMinutes: 300,
    usedPercent: 100,
    resetsAt: start + 1000
  }
]
const draft = { draftKey: 'new-chat-project', worktree: true }
const fixture = () => {
  const rows = new Map()
  const created = []
  const queued = []
  let time = start
  let preparations = 0
  let failAfterCreate = false
  const backend = {
    list: async () => structuredClone([...rows.values()]),
    put: async (entry) => {
      rows.set(entry.id, structuredClone(entry))
    },
    remove: async (id) => {
      rows.delete(id)
    }
  }
  const delivery = createLimitResetDelivery({
    backend,
    prepare: async (entry) => {
      assert.ok(time >= entry.resetsAt)
      preparations++
      return { ...entry.options, cwd: '/prepared/worktree' }
    },
    create: async (entry, onCreated) => {
      assert.equal(entry.accountId, 'saved-account')
      assert.equal(entry.options.model, 'saved-model')
      const id = `created-${created.length}`
      created.push(id)
      await onCreated(id)
      if (failAfterCreate) throw new Error('exited after native session creation')
    },
    saveMetadata: async (entry) => {
      assert.ok(entry.chatId)
    },
    enqueue: async (entry) => {
      queued.push({ chatId: entry.chatId, content: entry.content, options: entry.options })
      await backend.remove(entry.id)
    }
  })
  return {
    make: () => new LimitResetQueue(backend, delivery, () => time),
    backend,
    rows,
    created,
    queued,
    preparations: () => preparations,
    setTime: (value) => {
      time = value
    },
    failCreate: (value) => {
      failAfterCreate = value
    }
  }
}

test('a new-chat draft creates no session or workspace before reset, then creates one chat for its prompts', async () => {
  const f = fixture()
  let queue = f.make()
  await queue.add('codex', draft, 'first', options, limits, undefined, 'saved-account')
  await queue.add('codex', draft, 'second', options, limits, undefined, 'saved-account')
  assert.equal((await queue.list('codex', draft)).length, 2)
  assert.deepEqual(await queue.list('codex', { draftKey: 'another-project' }), [])
  await queue.tick()
  assert.equal(f.created.length, 0)
  assert.equal(f.preparations(), 0)
  assert.equal([...f.rows.values()][0].chatId, null)
  await queue.close()
  // Sele was closed through the reset; the original deadline and settings survive.
  f.setTime(start + 5000)
  queue = f.make()
  await queue.tick()
  assert.deepEqual(f.created, ['created-0'])
  assert.equal(f.preparations(), 1)
  assert.deepEqual(
    f.queued.map(({ chatId, content }) => [chatId, content]),
    [
      ['created-0', 'first'],
      ['created-0', 'second']
    ]
  )
  assert.equal(f.queued[1].options.cwd, '/prepared/worktree')
  assert.deepEqual(await queue.list('codex', draft), [])
})

test('a restart after native creation retains that chat identity and does not create a duplicate', async () => {
  const f = fixture()
  let queue = f.make()
  await queue.add('codex', draft, 'prompt', options, limits, undefined, 'saved-account')
  f.setTime(start + 1000)
  f.failCreate(true)
  await queue.tick()
  const [stored] = await f.backend.list()
  assert.equal(stored.chatId, 'created-0')
  assert.equal(stored.options.cwd, '/prepared/worktree')
  assert.match(stored.error, /native session/)
  await queue.close()
  f.failCreate(false)
  queue = f.make()
  await queue.tick()
  assert.deepEqual(f.created, ['created-0'])
  assert.equal(f.preparations(), 1)
  assert.equal(f.queued[0].chatId, 'created-0')
})

test('a new-chat draft can be cancelled before reset without creating a session', async () => {
  const f = fixture()
  const queue = f.make()
  await queue.add('codex', draft, 'prompt', options, limits, undefined, 'saved-account')
  const [entry] = await queue.list('codex', draft)
  await queue.remove('codex', { draftKey: 'different' }, entry.id)
  assert.equal(f.rows.size, 1)
  await queue.remove('codex', draft, entry.id)
  f.setTime(start + 5000)
  await queue.tick()
  assert.equal(f.created.length, 0)
  assert.equal(f.queued.length, 0)
})

test('later prompts join the same scheduled draft chat while preserving their own model selection', async () => {
  const f = fixture()
  const queue = f.make()
  await queue.add('codex', draft, 'first', options, limits, undefined, 'saved-account')
  await queue.add(
    'codex',
    draft,
    'future',
    options,
    [{ ...limits[0], resetsAt: start + 10000 }],
    undefined,
    'saved-account'
  )
  f.setTime(start + 1000)
  await queue.tick()
  await queue.add(
    'codex',
    draft,
    'different model',
    { ...options, model: 'other-model' },
    [{ ...limits[0], resetsAt: start + 2000 }],
    undefined,
    'saved-account'
  )
  f.setTime(start + 2000)
  await queue.tick()
  assert.deepEqual(f.created, ['created-0'])
  assert.equal(f.queued[1].content, 'different model')
  assert.equal(f.queued[1].chatId, 'created-0')
  assert.equal(f.queued[1].options.model, 'other-model')
})
