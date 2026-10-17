import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { transform } from 'esbuild'

// Download lifecycle tests do not launch Electron or use the desktop.
const source = await readFile(new URL('./BrowserDownloads.ts', import.meta.url), 'utf8')
const compiled = await transform(
  source.replace(
    /^import .* from 'electron'$/m,
    'const app = { getPath: () => process.env.SELE_DOWNLOAD_TEST_DIRECTORY }'
  ),
  { loader: 'ts', format: 'esm' }
)
const { BrowserDownloads } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
)

class Item extends EventEmitter {
  received = 0
  canceled = false
  constructor(url, filename = '../../fixture.txt') {
    super()
    this.url = url
    this.name = filename
  }
  getURL() {
    return this.url
  }
  getURLChain() {
    return this.chain ?? [this.url]
  }
  getFilename() {
    return this.name
  }
  getReceivedBytes() {
    return this.received
  }
  getTotalBytes() {
    return 100
  }
  setSavePath(path) {
    this.path = path
  }
  cancel() {
    this.canceled = true
    this.emit('done', {}, 'cancelled')
  }
}

test('downloads authorize one exact URL on an owned tab and emit terminal state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-download-unit-'))
  process.env.SELE_DOWNLOAD_TEST_DIRECTORY = directory
  const session = new EventEmitter()
  const events = []
  const downloads = new BrowserDownloads(
    session,
    (guest) => guest.id === 7,
    (event) => events.push(event)
  )
  try {
    await downloads.allow(7, 'https://example.test/file')
    const foreign = new Item('https://example.test/file')
    session.emit('will-download', {}, foreign, { id: 8 })
    assert.equal(foreign.path, undefined)
    const mismatch = new Item('https://example.test/other')
    session.emit('will-download', {}, mismatch, { id: 7 })
    assert.equal(mismatch.path, undefined)
    const item = new Item('https://example.test/file')
    session.emit('will-download', {}, item, { id: 7 })
    assert.ok(item.path.startsWith(join(directory, 'Sele') + '/'))
    assert.match(item.path, /fixture.txt$/)
    const second = new Item('https://example.test/file')
    session.emit('will-download', {}, second, { id: 7 })
    assert.equal(second.path, undefined, 'authorization is consumed once')
    item.received = 20
    item.emit('updated', {}, 'interrupted')
    assert.equal(events.at(-1).status, 'in_progress', 'interruption can resume')
    item.received = 100
    item.emit('done', {}, 'completed')
    assert.equal(events.at(-1).status, 'complete')
    assert.equal(downloads.list(7)[0].receivedBytes, 100)
    assert.deepEqual(downloads.list(8), [])
    const copy = downloads.list(7)
    copy[0].status = 'failed'
    assert.equal(downloads.list(7)[0].status, 'complete')
    await downloads.allow(7, 'https://example.test/start')
    const redirected = new Item('https://cdn.example.test/file')
    redirected.chain = ['https://example.test/start', redirected.url]
    session.emit('will-download', {}, redirected, { id: 7 })
    assert.ok(redirected.path, 'a download retains authorization through its original URL')
    redirected.emit('done', {}, 'completed')
  } finally {
    downloads.close()
    delete process.env.SELE_DOWNLOAD_TEST_DIRECTORY
    await rm(directory, { recursive: true, force: true })
  }
})

test('download waiters finish on completion, reject on revocation and clean up on close', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-download-unit-'))
  process.env.SELE_DOWNLOAD_TEST_DIRECTORY = directory
  const session = new EventEmitter()
  const downloads = new BrowserDownloads(
    session,
    () => true,
    () => {}
  )
  try {
    const waiting = downloads.wait(7, 1000)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const item = new Item('https://example.test/file')
    session.emit('will-download', {}, item, { id: 7 })
    item.emit('done', {}, 'completed')
    assert.equal((await waiting).status, 'complete')
    const pending = downloads.wait(7, 1000)
    await new Promise((resolve) => setTimeout(resolve, 10))
    downloads.revoke(7)
    await assert.rejects(pending, /detached/)
    await downloads.allow(7, 'https://example.test/file')
    const active = new Item('https://example.test/file')
    session.emit('will-download', {}, active, { id: 7 })
    downloads.close()
    assert.equal(active.canceled, true)
    assert.equal(session.listenerCount('will-download'), 0)
    await assert.rejects(downloads.allow(7, 'https://example.test/file'), /closed/)
  } finally {
    downloads.close()
    delete process.env.SELE_DOWNLOAD_TEST_DIRECTORY
    await rm(directory, { recursive: true, force: true })
  }
})
