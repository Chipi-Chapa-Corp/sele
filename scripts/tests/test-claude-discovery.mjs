import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

// Exercise the production worker bundle, including the SDK and shell-backed remote store.
const bundle = (await readdir('out/main')).find((name) =>
  name.startsWith('claudeSessionDiscovery.worker-')
)
assert.ok(bundle, 'Build the app before running the discovery worker regression')
const root = await mkdtemp(join(tmpdir(), 'sele-discovery-'))
let worker
try {
  const project = join(root, 'projects', '-fixture')
  await mkdir(project, { recursive: true })
  const ids = []
  const payload = 'x'.repeat(16 * 1024 * 1024)
  for (let i = 0; i < 6; i++) {
    const id = randomUUID()
    ids.push(id)
    const base = {
      sessionId: id,
      cwd: '/fixture',
      gitBranch: 'main',
      isSidechain: false,
      timestamp: '2026-09-25T12:00:00.000Z'
    }
    await writeFile(
      join(project, `${id}.jsonl`),
      [
        {
          ...base,
          type: 'user',
          uuid: 'user',
          parentUuid: null,
          message: { role: 'user', content: `Request ${i}` }
        },
        {
          ...base,
          type: 'assistant',
          uuid: 'answer',
          parentUuid: 'user',
          message: { role: 'assistant', content: [{ type: 'text', text: payload }] }
        },
        { type: 'custom-title', sessionId: id, customTitle: `Session ${i}` }
      ]
        .map((value) => JSON.stringify(value))
        .join('\n') + '\n'
    )
  }
  worker = new Worker(resolve('out/main', bundle), {
    env: { ...process.env, CLAUDE_CONFIG_DIR: root }
  })
  const results = new Map()
  worker.on('message', (message) => {
    if (message.type === 'command') {
      worker.postMessage({
        type: 'commandResult',
        id: message.id,
        command: {
          file: '/bin/sh',
          args: ['-lc', message.script, 'sele-test', ...message.args],
          env: { ...process.env, CLAUDE_CONFIG_DIR: root }
        }
      })
    } else if (message.type === 'result') {
      const pending = results.get(message.id)
      results.delete(message.id)
      if (message.error) pending.reject(new Error(message.error))
      else pending.resolve(message.sessions)
    }
  })
  worker.on('error', (error) => {
    for (const pending of results.values()) pending.reject(error)
  })
  let requestId = 0
  const list = (remote) =>
    new Promise((resolve, reject) => {
      const id = ++requestId
      results.set(id, { resolve, reject })
      worker.postMessage({ type: 'list', id, remote })
    })
  let last = performance.now()
  const gaps = []
  const heartbeat = setInterval(() => {
    const now = performance.now()
    gaps.push(now - last)
    last = now
  }, 5)
  let remote, local
  try {
    ;[remote, local] = await Promise.all([list(true), list(false)])
  } finally {
    clearInterval(heartbeat)
  }
  assert.deepEqual(remote.map((s) => s.sessionId).sort(), ids.toSorted())
  assert.deepEqual(local.map((s) => s.sessionId).sort(), ids.toSorted())
  assert.deepEqual(
    remote.map((s) => s.summary).sort(),
    Array.from({ length: 6 }, (_, i) => `Session ${i}`)
  )
  assert.ok(JSON.stringify(remote).length < 10000, 'Only summaries cross back to the app')
  assert.ok(gaps.length > 10, 'The main event loop ran while the worker processed transcripts')
  assert.ok(Math.max(...gaps) < 200, `Discovery blocked the caller for ${Math.max(...gaps)} ms`)
  console.log(
    `Claude discovery passed: 96 MiB remote/local history, ${gaps.length} heartbeats, max gap ${Math.max(...gaps).toFixed(1)} ms`
  )
} finally {
  await worker?.terminate()
  await rm(root, { recursive: true, force: true })
}
