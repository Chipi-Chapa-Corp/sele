import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { encodeChatArchive } from './ChatArchive.ts'

const require = createRequire(import.meta.url)
const directory = await mkdtemp(join(tmpdir(), 'sele-archive-worker-'))
after(() => rm(directory, { recursive: true, force: true }))
const entry = join(directory, 'client.cjs')
await build({
  entryPoints: [new URL('./ChatArchiveWorker.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: entry,
  plugins: [require('../../../scripts/tests/helpers/node-workers.cjs')(directory)]
})
const { ChatArchiveWorker } = require(entry)
const archive = (count = 1) => ({
  format: 'sele-chat',
  version: 1,
  exportedAt: 1,
  providerId: 'codex',
  chat: {
    id: 'source',
    title: 'Portable',
    createdAt: 1,
    items: Array.from({ length: count }, (_, i) => [
      { type: 'message', id: `user-${i}`, role: 'user', content: 'Inspect this file.' },
      {
        type: 'working',
        id: `work-${i}`,
        status: 'worked',
        items: [
          {
            type: 'tool',
            id: `tool-${i}`,
            toolId: 'read',
            status: 'finished',
            label: 'Read',
            stdout: 'Complete tool output\n'.repeat(300),
            rawOutput: 'Exact raw result\n'.repeat(300),
            images: [],
            diffs: []
          }
        ]
      },
      {
        type: 'message',
        id: `answer-${i}`,
        role: 'assistant',
        content: '![Image](/original/image.png)\n' + 'Explanation. '.repeat(80)
      }
    ]).flat()
  },
  subagents: [],
  assets: [
    { path: '/original/image.png', data: Buffer.from('exact image bytes').toString('base64') }
  ]
})
const files = {
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
  write: async (path, data) => {
    await writeFile(path, data, { flag: 'wx' })
  }
}

test('large archive preview, restoration and persistence JSON leave the app thread responsive', {
  timeout: 20000
}, async () => {
  const worker = new ChatArchiveWorker()
  const file = join(directory, 'large.sele')
  await writeFile(file, await encodeChatArchive(archive(2500)))
  let ticks = 0
  let last = performance.now()
  let longestGap = 0
  const heartbeat = setInterval(() => {
    const now = performance.now()
    longestGap = Math.max(longestGap, now - last)
    last = now
    ticks++
  }, 5)
  try {
    const preview = await worker.read(file, 'operation')
    assert.deepEqual(preview, {
      id: 'operation',
      title: 'Portable',
      turnCount: 2500,
      providerId: 'codex'
    })
    const restored = await worker.restore(join(directory, 'assets'), files)
    assert.equal(restored.chat.items.length, 7500)
    assert.equal(restored.chat.items[1].items[0].stdout, archive().chat.items[1].items[0].stdout)
    assert.ok(!restored.chat.items[2].content.includes('/original/image.png'))
    const json = await worker.stringify(restored)
    const persisted = await worker.parse(json)
    assert.equal(
      persisted.chat.items[1].items[0].rawOutput,
      restored.chat.items[1].items[0].rawOutput
    )
    // Account for the final worker delivery too; large JS payloads must never reach the renderer.
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.ok(ticks > 10, `App heartbeat ran ${ticks} times`)
    assert.ok(longestGap < 250, `Longest app event-loop gap: ${longestGap.toFixed(1)} ms`)
    console.log(
      `Archive preparation: 2,500 turns, ${(Buffer.byteLength(json) / 1024 / 1024).toFixed(1)} MB; longest app event-loop gap ${longestGap.toFixed(1)} ms`
    )
  } finally {
    clearInterval(heartbeat)
    worker.dispose()
  }
})

test('retry restores original paths and cancellation waits for in-flight destination writes', {
  timeout: 10000
}, async () => {
  const worker = new ChatArchiveWorker()
  const file = join(directory, 'retry.sele')
  await writeFile(file, await encodeChatArchive(archive()))
  try {
    await worker.read(file, 'retry')
    await assert.rejects(
      worker.restore(join(directory, 'failed'), {
        ...files,
        write: async () => {
          throw new Error('Destination disconnected')
        }
      }),
      /Destination disconnected/
    )
    const restored = await worker.restore(join(directory, 'retry'), files)
    const image = restored.chat.items[2].content.match(/<([^>]+)>/)[1]
    assert.equal(await readFile(image, 'utf8'), 'exact image bytes')
    let release
    let writing
    const started = new Promise((resolve) => {
      writing = resolve
    })
    let settled = false
    const pending = worker.restore(join(directory, 'cancelled'), {
      ...files,
      write: async () => {
        writing()
        await new Promise((resolve) => {
          release = resolve
        })
      }
    })
    const rejected = assert.rejects(
      pending.finally(() => {
        settled = true
      }),
      /cancelled/
    )
    await started
    worker.dispose()
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(settled, false, 'Workspace cleanup must wait for the outstanding write')
    release()
    await rejected
  } finally {
    worker.dispose()
  }
})
