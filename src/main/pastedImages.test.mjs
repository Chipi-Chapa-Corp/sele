import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PastedImageStore } from './pastedImages.ts'
const preview = 'data:image/webp;base64,AAAA'
const bytes = (value) => Uint8Array.from(value).buffer
const first = (data, totalBytes = data.byteLength) => ({
  data,
  totalBytes,
  offset: 0,
  mimeType: 'image/png',
  previewDataUrl: preview
})
const fixture = async (t, idle) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-pasted-store-'))
  const store = new PastedImageStore(directory, idle)
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { directory, store }
}

test('chunked pastes preserve original bytes and return only a thumbnail and file reference', async (t) => {
  const { store } = await fixture(t)
  const data = Uint8Array.from({ length: 1200000 }, (_, i) => i % 251)
  let image, path
  for (let offset = 0; offset < data.length; offset += 512 * 1024) {
    const part = data.slice(offset, offset + 512 * 1024).buffer
    const reply = await store.write(
      path ? { path, data: part, offset, totalBytes: data.length } : first(part, data.length),
      7
    )
    if (!path) {
      image = reply
      path = reply.path
    } else if (offset + part.byteLength === data.length) image = reply
    else assert.equal(reply, null)
  }
  assert.equal(image.dataUrl, preview)
  assert.equal(image.previewOnly, true)
  assert.deepEqual(await readFile(path), Buffer.from(data))
  assert.ok(path.endsWith('.png'))
  await assert.rejects(
    store.write({ path, data: bytes([1]), offset: 0, totalBytes: 1 }, 7),
    /no longer available/
  )
  assert.deepEqual(
    await readFile(path),
    Buffer.from(data),
    'a completed image cannot be overwritten by another upload'
  )
})

test('other windows cannot append to or cancel an unfinished image', async (t) => {
  const { store } = await fixture(t)
  const image = await store.write(first(bytes([1, 2]), 4), 1)
  await assert.rejects(
    store.write({ path: image.path, data: bytes([3, 4]), offset: 2, totalBytes: 4 }, 2),
    /no longer available/
  )
  await store.write({ cancel: image.path }, 2)
  const done = await store.write(
    { path: image.path, data: bytes([3, 4]), offset: 2, totalBytes: 4 },
    1
  )
  assert.equal(done.path, image.path)
  assert.deepEqual(await readFile(image.path), Buffer.from([1, 2, 3, 4]))
})

test('failed chunk order and explicit cancellation remove partial files', async (t) => {
  const { store } = await fixture(t)
  const image = await store.write(first(bytes([1]), 3), 1)
  await assert.rejects(
    store.write({ path: image.path, data: bytes([2]), offset: 2, totalBytes: 3 }, 1),
    /chunk order/
  )
  await assert.rejects(readFile(image.path), /ENOENT/)
  const next = await store.write(first(bytes([1]), 3), 1)
  await store.write({ cancel: next.path }, 1)
  await assert.rejects(readFile(next.path), /ENOENT/)
})

test('closing a window cancels active and still-opening uploads without touching other windows', async (t) => {
  const { store } = await fixture(t)
  const a = await store.write(first(bytes([1]), 3), 1),
    b = await store.write(first(bytes([2]), 3), 2)
  await store.cancelOwner(1)
  await assert.rejects(readFile(a.path), /ENOENT/)
  assert.deepEqual(await readFile(b.path), Buffer.from([2]))
  await store.cancelOwner(2)
  const opening = store.write(first(bytes([1]), 3), 3)
  await store.cancelOwner(3)
  await assert.rejects(opening, /canceled/)
})

test('pending pastes are bounded and abandoned files expire', async (t) => {
  const { store, directory } = await fixture(t, 80)
  await store.write(first(bytes([1]), 3), 1)
  await store.write(first(bytes([2]), 3), 1)
  await assert.rejects(store.write(first(bytes([3]), 3), 1), /still being prepared/)
  await new Promise((resolve) => setTimeout(resolve, 180))
  assert.deepEqual(await readdir(directory), [])
})

test('invalid formats, oversized chunks, previews and coordinates never create a file', async (t) => {
  const { store, directory } = await fixture(t)
  for (const value of [
    null,
    {},
    first(new ArrayBuffer(0)),
    first(new ArrayBuffer(512 * 1024 + 1)),
    { ...first(bytes([1])), totalBytes: 33 * 1024 * 1024 },
    { ...first(bytes([1])), offset: -1 },
    { ...first(bytes([1])), offset: 0.5 },
    { ...first(bytes([1])), mimeType: 'toString' },
    { ...first(bytes([1])), mimeType: 'text/html' },
    { ...first(bytes([1])), previewDataUrl: 'A'.repeat(131073) }
  ])
    await assert.rejects(store.write(value, 1))
  assert.deepEqual(await readdir(directory), [])
})

test('concurrent openings release reservations so later pastes retain their full capacity', async (t) => {
  const { store } = await fixture(t)
  for (let round = 0; round < 2; round++) {
    const images = await Promise.all([
      store.write(first(bytes([1]), 2), 1),
      store.write(first(bytes([2]), 2), 1)
    ])
    await Promise.all(
      images.map((image) =>
        store.write({ path: image.path, data: bytes([3]), offset: 1, totalBytes: 2 }, 1)
      )
    )
    assert.deepEqual(await readFile(images[0].path), Buffer.from([1, 3]))
  }
})
