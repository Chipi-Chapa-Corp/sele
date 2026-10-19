// Native ingestion timings in throwaway provider profiles. No inference requests.
// node --disable-warning=ExperimentalWarning scripts/benchmarks/benchmark-chat-migration-ingest.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, open, rm, statfs, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { encode } from './benchmark-chat-migration.mjs'

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('='))
)
const runs = Number(options.runs ?? 3)
const sizes = (options.sizes ?? '100,1000,10000').split(',').map(Number)
const scratchRoot = resolve(
  options['scratch-root'] ?? 'benchmark-results/chat-migration-ingest-scratch'
)
await mkdir(scratchRoot, { recursive: true })
const filesystem = await statfs(scratchRoot)
const root = await mkdtemp(join(scratchRoot, 'case-'))
const rows = []
const environment = { PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: root, CI: '1', NO_COLOR: '1' }
const stats = (times) => {
  const sorted = [...times].sort((a, b) => a - b)
  return {
    medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(3),
    p95Ms: +sorted.at(-1).toFixed(3),
    samples: sorted.length
  }
}
const messages = (turns) =>
  Array.from({ length: turns }, (_, index) => [
    {
      role: 'user',
      content: `User ${index}: ` + 'Inspect the repository and explain the conversion. '.repeat(4)
    },
    {
      role: 'assistant',
      content:
        `Final ${index}: ` +
        'Keep native tool history intact and migrate user input and final assistant output only. '.repeat(
          10
        )
    }
  ]).flat()

async function tailContains(path, marker) {
  const deadline = performance.now() + 30000
  while (performance.now() < deadline) {
    let handle
    try {
      handle = await open(path, 'r')
      const { size } = await handle.stat()
      const buffer = Buffer.alloc(Math.min(size, 32 * 1024))
      await handle.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length))
      if (buffer.toString().includes(marker)) return
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    } finally {
      await handle?.close()
    }
    await new Promise((done) => setTimeout(done, 2))
  }
  throw new Error('Native rollout did not expose final injected marker')
}

async function codex() {
  const home = join(root, 'codex')
  await mkdir(home)
  await writeFile(
    join(home, 'config.toml'),
    'model="benchmark"\nmodel_provider="benchmark"\n[model_providers.benchmark]\nname="Local no-inference benchmark"\nbase_url="http://127.0.0.1:9/v1"\nwire_api="responses"\nrequires_openai_auth=false\n'
  )
  const start = performance.now()
  const child = spawn('codex', ['app-server'], {
    cwd: root,
    env: { ...environment, CODEX_HOME: home },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let buffer = '',
    sequence = 0
  const pending = new Map()
  child.stderr.on('data', () => {})
  child.stdout.on('data', (data) => {
    buffer += data
    for (;;) {
      const end = buffer.indexOf('\n')
      if (end < 0) break
      const message = JSON.parse(buffer.slice(0, end))
      buffer = buffer.slice(end + 1)
      const handler = pending.get(message.id)
      if (!handler) continue
      pending.delete(message.id)
      clearTimeout(handler.timer)
      if (message.error) handler.reject(new Error(JSON.stringify(message.error)))
      else handler.resolve(message.result)
    }
  })
  const call = (method, params) =>
    new Promise((resolveResult, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => reject(new Error(`Codex timeout: ${method}`)), 90000)
      pending.set(id, { resolve: resolveResult, reject, timer })
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    })
  try {
    await call('initialize', {
      clientInfo: { name: 'sele-storage-bench', version: '1.0' },
      capabilities: { experimentalApi: true }
    })
    child.stdin.write('{"method":"initialized"}\n')
    const startupMs = performance.now() - start
    for (const turns of sizes) {
      const history = messages(turns)
      const full = [],
        fullVisible = [],
        delta = [],
        deltaVisible = [],
        create = []
      let payloadBytes
      for (let repeat = 0; repeat < runs + 1; repeat++) {
        let time = performance.now()
        const { thread } = await call('thread/start', {
          cwd: root,
          approvalPolicy: 'never',
          sandbox: 'read-only'
        })
        if (repeat) create.push(performance.now() - time)
        const marker = `full-${randomUUID()}`
        const payload = JSON.parse(encode('codex', history).bytes)
        payload.threadId = thread.id
        payload.items.at(-1).content[0].text += marker
        payloadBytes = Buffer.byteLength(JSON.stringify(payload))
        time = performance.now()
        await call('thread/inject_items', payload)
        const ack = performance.now() - time
        await tailContains(thread.path, marker)
        if (repeat) {
          full.push(ack)
          fullVisible.push(performance.now() - time)
        }
        const pair = JSON.parse(encode('codex', messages(1)).bytes)
        pair.threadId = thread.id
        const deltaMarker = `delta-${randomUUID()}`
        pair.items.at(-1).content[0].text += deltaMarker
        time = performance.now()
        await call('thread/inject_items', pair)
        const deltaAck = performance.now() - time
        await tailContains(thread.path, deltaMarker)
        if (repeat) {
          delta.push(deltaAck)
          deltaVisible.push(performance.now() - time)
        }
      }
      const row = {
        provider: 'codex',
        turns,
        messages: history.length,
        payloadBytes,
        startupMs: +startupMs.toFixed(3),
        createThread: stats(create),
        injectFullAck: stats(full),
        injectFullAndVisibleInRollout: stats(fullVisible),
        injectMissingPairAck: stats(delta),
        injectMissingPairAndVisibleInRollout: stats(deltaVisible)
      }
      rows.push(row)
      console.log(JSON.stringify(row))
    }
  } finally {
    if (child.exitCode === null) {
      child.kill()
      await new Promise((done) => child.once('exit', done))
    }
  }
}

async function opencode() {
  const home = join(root, 'opencode')
  const env = {
    ...environment,
    XDG_CONFIG_HOME: join(home, 'config'),
    XDG_DATA_HOME: join(home, 'data'),
    XDG_CACHE_HOME: join(home, 'cache'),
    XDG_STATE_HOME: join(home, 'state'),
    OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
    OPENCODE_DISABLE_MODELS_FETCH: 'true',
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      model: 'benchmark/local',
      small_model: 'benchmark/local',
      plugin: [],
      provider: {
        benchmark: {
          npm: '@ai-sdk/openai-compatible',
          name: 'No inference',
          options: { baseURL: 'http://127.0.0.1:9/v1', apiKey: 'not-a-credential' },
          models: { local: { name: 'Local benchmark', limit: { context: 128000, output: 1000 } } }
        }
      }
    })
  }
  const start = performance.now()
  const server = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: root,
    env,
    detached: true
  })
  let startupOutput = ''
  try {
    const url = await new Promise((resolveUrl, reject) => {
      const timer = setTimeout(() => reject(new Error('OpenCode startup timeout')), 60000)
      for (const stream of [server.stdout, server.stderr])
        stream.on('data', (data) => {
          startupOutput += data
          const match = startupOutput.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/)
          if (match) {
            clearTimeout(timer)
            resolveUrl(match[1])
          }
        })
      server.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`OpenCode server exited ${code}`))
      })
    })
    const startupMs = performance.now() - start
    const api = async (path, body) => {
      const response = await fetch(`${url}${path}?directory=${encodeURIComponent(root)}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      })
      assert(response.ok, `OpenCode HTTP ${response.status}`)
      return response.json()
    }
    // Finish first-use project/database initialization outside sampled imports.
    await api('/session', { title: 'warmup only' })
    const cliImport = (path) =>
      new Promise((resolveResult, reject) => {
        const process = spawn('opencode', ['import', path], { cwd: root, env })
        let output = '',
          errors = ''
        process.stdout.on('data', (data) => {
          output += data
        })
        process.stderr.on('data', (data) => {
          errors += data
        })
        const timer = setTimeout(() => {
          process.kill()
          reject(new Error('OpenCode import timed out'))
        }, 120000)
        process.once('exit', (code) => {
          clearTimeout(timer)
          if (code === 0 && output.includes('Imported session:')) resolveResult()
          else reject(new Error(`OpenCode import failed ${code}: ${errors.slice(-1000)}`))
        })
      })
    for (const turns of sizes) {
      const history = messages(turns)
      const full = [],
        delta = [],
        create = []
      let payloadBytes
      for (let repeat = 0; repeat < runs + 1; repeat++) {
        let time = performance.now()
        const info = await api('/session', { title: 'Migration storage benchmark' })
        if (repeat) create.push(performance.now() - time)
        const nativePayload = (source, offset = 0) => {
          const payload = JSON.parse(encode('opencode', source).bytes)
          payload.info = info
          for (let index = 0; index < payload.messages.length; index++) {
            const record = payload.messages[index]
            record.info.sessionID = info.id
            record.info.time.created += offset
            if (record.info.time.completed) record.info.time.completed += offset
            for (const part of record.parts) part.sessionID = info.id
          }
          return payload
        }
        const path = join(root, 'opencode-full.json')
        const bytes = JSON.stringify(nativePayload(history))
        payloadBytes = Buffer.byteLength(bytes)
        await writeFile(path, bytes)
        time = performance.now()
        await cliImport(path)
        if (repeat) full.push(performance.now() - time)
        const deltaPath = join(root, 'opencode-delta.json')
        await writeFile(deltaPath, JSON.stringify(nativePayload(messages(1), history.length)))
        time = performance.now()
        await cliImport(deltaPath)
        if (repeat) delta.push(performance.now() - time)
        const db = new DatabaseSync(join(home, 'data', 'opencode', 'opencode.db'), {
          readOnly: true
        })
        try {
          assert.equal(
            db.prepare('SELECT count(*) AS count FROM message WHERE session_id=?').get(info.id)
              .count,
            history.length + 2
          )
        } finally {
          db.close()
        }
      }
      const row = {
        provider: 'opencode',
        turns,
        messages: history.length,
        payloadBytes,
        startupMs: +startupMs.toFixed(3),
        createSession: stats(create),
        fullCliImport: stats(full),
        missingPairCliImport: stats(delta)
      }
      rows.push(row)
      console.log(JSON.stringify(row))
    }
  } finally {
    try {
      process.kill(-server.pid, 'SIGTERM')
    } catch {}
  }
}

try {
  await codex()
  await opencode()
  const output = resolve(options.output ?? 'benchmark-results/chat-migration-ingest.json')
  await mkdir(dirname(output), { recursive: true })
  await writeFile(
    output,
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        scratchRoot,
        filesystemMagic: `0x${filesystem.type.toString(16)}`,
        filesystem:
          filesystem.type === 0x9123683e
            ? 'btrfs'
            : filesystem.type === 0x01021994
              ? 'tmpfs'
              : 'other',
        runs,
        notes: [
          'Isolated temporary homes and databases; no real profiles or credentials used.',
          'No turn/start, prompt, or model inference calls.',
          'Codex includes warm RPC transport, serialization, native processing and acknowledgement; rollout visibility is checked separately and does not prove fsync durability.',
          'OpenCode includes actual CLI process startup, JSON decoding and native importer writes; input staging-file creation is excluded.',
          'Sample p95 is the maximum of three samples by default; warmup is excluded.'
        ],
        rows
      },
      null,
      2
    ) + '\n'
  )
  console.log(`Report: ${output}`)
} finally {
  await rm(root, { recursive: true, force: true })
}
