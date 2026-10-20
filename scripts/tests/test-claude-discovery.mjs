import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { mkdtemp, mkdir, writeFile, rm, readdir, utimes } from 'node:fs/promises'
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
    await utimes(join(project, `${id}.jsonl`), 1000 + i, 1000 + i)
  }
  worker = new Worker(resolve('out/main', bundle), {
    env: { ...process.env, CLAUDE_CONFIG_DIR: root }
  })
  const results = new Map()
  const commands = []
  let blockedCommand
  let blockedRequest
  const resolveCommand = (message) => {
    worker.postMessage({
      type: 'commandResult',
      id: message.id,
      command: {
        file: '/bin/sh',
        args: ['-lc', message.script, 'sele-test', ...message.args],
        env: { ...process.env, CLAUDE_CONFIG_DIR: root }
      }
    })
  }
  worker.on('message', (message) => {
    if (message.type === 'command') {
      commands.push(message)
      if (message.requestId === blockedRequest && !blockedCommand) blockedCommand = message
      else resolveCommand(message)
    } else if (message.type === 'result') {
      const pending = results.get(message.id)
      clearTimeout(pending.timer)
      results.delete(message.id)
      if (message.error) pending.reject(new Error(message.error))
      else pending.resolve(message.page)
    }
  })
  worker.on('error', (error) => {
    for (const pending of results.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
  })
  let requestId = 0
  const list = (remote, cursor = null) =>
    new Promise((resolve, reject) => {
      const id = ++requestId
      const timer = setTimeout(
        () => reject(new Error('Claude discovery worker request timed out')),
        10_000
      )
      results.set(id, { resolve, reject, timer })
      worker.postMessage({
        type: 'list',
        id,
        remote,
        scope: remote ? 'remote' : 'local',
        cursor,
        limit: 2
      })
    })
  let last = performance.now()
  const gaps = []
  const heartbeat = setInterval(() => {
    const now = performance.now()
    gaps.push(now - last)
    last = now
  }, 5)
  try {
    // Withhold a remote command entirely: local results must not queue behind it.
    blockedRequest = 1
    const remotePending = list(true)
    const local = await list(false)
    assert.equal(local.sessions.length, 2)
    assert.ok(blockedCommand, 'remote is still waiting for command resolution')
    resolveCommand(blockedCommand)
    const remote = await remotePending
    assert.equal(commands.length, 3, 'only enumerate + two remote summaries before the first page')
    assert.ok(commands.every((command) => !command.script.includes('cat ')))
    const expected = ids.toReversed()
    assert.deepEqual(
      local.sessions.map((s) => s.sessionId),
      expected.slice(0, 2)
    )
    assert.deepEqual(
      remote.sessions.map((s) => s.sessionId),
      expected.slice(0, 2)
    )
    assert.deepEqual(
      remote.sessions.map((s) => s.summary),
      ['Session 5', 'Session 4']
    )
    // Reordering the underlying directory cannot change an already-issued cursor.
    await utimes(join(project, `${ids[0]}.jsonl`), 2000, 2000)
    const collected = { local: [...local.sessions], remote: [...remote.sessions] }
    for (const [name, first, isRemote] of [
      ['local', local, false],
      ['remote', remote, true]
    ]) {
      let cursor = first.nextCursor
      while (cursor) {
        const page = await list(isRemote, cursor)
        collected[name].push(...page.sessions)
        cursor = page.nextCursor
      }
      assert.deepEqual(
        collected[name].map((s) => s.sessionId),
        expected
      )
      assert.equal(new Set(collected[name].map((s) => s.sessionId)).size, ids.length)
    }
    const refreshed = await list(false)
    assert.equal(refreshed.sessions[0].sessionId, ids[0], 'new listing picks up changed order')
    assert.ok(
      JSON.stringify(collected.remote).length < 10000,
      'Only summaries cross back to the app'
    )
  } finally {
    clearInterval(heartbeat)
  }
  assert.ok(gaps.length > 0, 'The caller event loop ran during discovery')
  assert.ok(Math.max(...gaps) < 200, `Discovery blocked the caller for ${Math.max(...gaps)} ms`)
  console.log(
    `Claude discovery passed: 96 MiB history, two-summary first pages, stable pagination, independent local/remote; max caller gap ${Math.max(...gaps).toFixed(1)} ms`
  )
} finally {
  await worker?.terminate()
  await rm(root, { recursive: true, force: true })
}
