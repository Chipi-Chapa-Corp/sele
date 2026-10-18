import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalMediaCache, getLocalMediaKey } from './localMediaCache.ts'

const image = (bytes = 4) => ({ data: new ArrayBuffer(bytes), mimeType: 'image/png', updatedAt: 1 })
const setup = (t, load = async () => image(), limits = {}) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = []
  const revoked = []
  let id = 0
  const cache = createLocalMediaCache(
    (options, kind) => {
      calls.push({ options, kind })
      return load(options, kind)
    },
    { ...limits, createUrl: () => `blob:${++id}`, revokeUrl: (url) => revoked.push(url) }
  )
  return { cache, calls, revoked }
}

test('duplicate thumbnails, gallery, and remounts share one read and URL', async (t) => {
  let finish
  const { cache, calls, revoked } = setup(
    t,
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const options = { cwd: '/work', path: './image.png', relativeTo: 'cwd' }
  const first = cache.acquire(options)
  const second = cache.acquire({ ...options })
  assert.equal(calls.length, 1)
  first.release()
  second.release()
  const remounted = cache.acquire(options)
  finish(image())
  assert.equal(await remounted.ready, await second.ready)
  assert.equal(remounted.url, 'blob:1')
  const gallery = cache.acquire(options)
  assert.equal(gallery.url, 'blob:1', 'cached URL is available synchronously before paint')
  assert.equal(calls.length, 1)
  remounted.release()
  t.mock.timers.tick(30_000)
  assert.deepEqual(revoked, [], 'an open gallery pins the URL after thumbnails unmount')
  gallery.release()
  gallery.release()
  t.mock.timers.tick(30_000)
  assert.deepEqual(revoked, ['blob:1'])
  const refreshed = cache.acquire(options)
  assert.equal(calls.length, 2, 'expired paths are read again to pick up file changes')
  finish(image())
  await refreshed.ready
  refreshed.release()
})

test('idle memory and count are bounded without evicting active images', async (t) => {
  const { cache, revoked } = setup(t, async () => image(4), { maxIdleBytes: 6, maxIdleEntries: 1 })
  const active = cache.acquire({ path: '/active.png' })
  await active.ready
  const first = cache.acquire({ path: '/first.png' })
  await first.ready
  first.release()
  const second = cache.acquire({ path: '/second.png' })
  await second.ready
  second.release()
  assert.deepEqual(revoked, ['blob:2'])
  t.mock.timers.tick(30_000)
  assert.deepEqual(revoked, ['blob:2', 'blob:3'])
  assert.equal(active.url, 'blob:1')
  active.release()
})

test('oversized unused media is released immediately', async (t) => {
  const { cache, revoked } = setup(t, async () => image(10), { maxIdleBytes: 5 })
  const media = cache.acquire({ path: '/large.webm' }, 'video')
  await media.ready
  assert.deepEqual(revoked, [])
  media.release()
  assert.deepEqual(revoked, ['blob:1'])
})

test('late reads are cleaned up and cannot interfere with a replacement entry', async (t) => {
  const pending = []
  const { cache, revoked, calls } = setup(
    t,
    () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    { maxIdleEntries: 1 }
  )
  const options = { path: '/same.png' }
  const old = cache.acquire(options)
  const failure = assert.rejects(old.ready, /missing/)
  old.release()
  const other = cache.acquire({ path: '/other.png' })
  other.release() // Evicts the older pending entry.
  const replacement = cache.acquire(options)
  pending[0].reject(new Error('missing'))
  await failure
  pending[2].resolve(image())
  await replacement.ready
  replacement.release()
  const again = cache.acquire(options)
  assert.equal(again.url, replacement.url)
  assert.equal(calls.length, 3)
  pending[1].resolve(image())
  await other.ready
  assert.ok(revoked.includes('blob:2'), 'an evicted pending read releases its late URL')
  again.release()
})

test('failed reads can be retried', async (t) => {
  let fail = true
  const { cache, calls } = setup(t, async () => {
    if (fail) throw new Error('missing')
    return image()
  })
  const first = cache.acquire({ path: '/image.png' })
  await assert.rejects(first.ready, /missing/)
  first.release()
  fail = false
  const retry = cache.acquire({ path: '/image.png' })
  await retry.ready
  assert.equal(calls.length, 2)
  retry.release()
})

test('media keys separate cwd, path base, kind, container, and SSH runtime', () => {
  const options = { path: './image.png' }
  const key = getLocalMediaKey(options, 'image')
  assert.equal(key, getLocalMediaKey({ ...options, container: { kind: 'host' } }, 'image'))
  const variants = [
    [{ ...options, cwd: '/elsewhere' }, 'image'],
    [{ ...options, relativeTo: 'cwd' }, 'image'],
    [options, 'video'],
    [{ ...options, container: { kind: 'container', tool: 'ssh', name: 'one' } }, 'image'],
    [{ ...options, container: { kind: 'container', tool: 'ssh', name: 'two' } }, 'image'],
    [
      {
        ...options,
        container: {
          kind: 'container',
          tool: 'ssh',
          name: 'one',
          runtime: { kind: 'container', tool: 'toolbox', name: 'dev' }
        }
      },
      'image'
    ]
  ]
  const keys = variants.map(([value, kind]) => getLocalMediaKey(value, kind))
  assert.equal(new Set([key, ...keys]).size, 7)
})
