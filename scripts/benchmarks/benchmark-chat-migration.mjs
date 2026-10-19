// Storage/CPU prototype benchmark, not a production transcript importer.
// No model requests, GUI, or writes to provider profiles.
// node --expose-gc scripts/benchmarks/benchmark-chat-migration.mjs
// Optional: --real-state=test-results/real-transcript-roundtrip/state.json
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { cpus, release, totalmem } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(import.meta.url)
const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('='))
)
const providers = ['codex', 'claude', 'copilot', 'opencode']
const runs = Number(options.runs ?? 7)
const scratchRoot = resolve(options['scratch-root'] ?? 'benchmark-results/chat-migration-scratch')
const note = 'Note: Previous dialog was managed by another agent, some tool calls were stripped.'
const withNote = (text) => (text.startsWith(note + '\n') ? text : `${note}\n\n${text}`)
const textOf = (content) =>
  typeof content === 'string'
    ? content
    : (content ?? [])
        .filter((block) => ['text', 'input_text', 'output_text'].includes(block.type))
        .map((block) => block.text)
        .join('\n')
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function extract(provider, input, selective = false) {
  const messages = []
  const add = (role, content) => {
    if (content) messages.push({ role, content })
  }
  if (provider === 'opencode') {
    for (const { info, parts } of JSON.parse(input).messages) {
      if (info.role === 'user' || (info.role === 'assistant' && info.finish === 'stop')) {
        add(info.role, textOf(parts))
      }
    }
    return messages
  }
  // Scan lines without building an array containing every large tool-result line.
  let offset = 0
  while (offset < input.length) {
    let end = input.indexOf('\n', offset)
    if (end < 0) end = input.length
    const line = input.slice(offset, end)
    offset = end + 1
    if (!line.trim()) continue
    // Conservative prefilter: false positives are parsed and rejected below.
    // Every Codex message record has this marker, regardless of property order.
    if (provider === 'codex' && selective && !/"type"\s*:\s*"message"/.test(line)) continue
    const record = JSON.parse(line)
    if (provider === 'codex') {
      const value = record.payload
      if (record.type !== 'response_item' || value?.type !== 'message') continue
      if (value.role === 'user' || (value.role === 'assistant' && value.phase === 'final_answer')) {
        add(value.role, textOf(value.content))
      }
    } else if (provider === 'claude') {
      if (record.isSidechain || record.isMeta || record.isCompactSummary) continue
      const value = record.message
      if (record.type === 'user') add('user', textOf(value?.content))
      else if (record.type === 'assistant' && value?.stop_reason === 'end_turn') {
        add('assistant', textOf(value.content))
      }
    } else if (provider === 'copilot') {
      if (record.type === 'user.message') add('user', record.data.content)
      else if (record.type === 'assistant.message' && !record.data.toolRequests?.length) {
        add('assistant', record.data.content)
      }
    }
  }
  return messages
}

function sourceTurn(provider, user, assistant, noise, index) {
  const message = (role, content) => ({ type: 'message', role, content })
  const text = (value) => [{ type: 'text', text: value }]
  const tools = Array.from({ length: 4 }, (_, tool) => noise(tool))
  if (provider === 'codex') {
    return [
      { type: 'response_item', payload: message('user', [{ type: 'input_text', text: user }]) },
      ...tools.flatMap((output, tool) => [
        {
          type: 'response_item',
          payload: {
            type: 'function_call',
            call_id: `${index}-${tool}`,
            name: 'shell',
            arguments: '{"command":"test"}'
          }
        },
        {
          type: 'response_item',
          payload: { type: 'function_call_output', call_id: `${index}-${tool}`, output }
        }
      ]),
      {
        type: 'response_item',
        payload: {
          ...message('assistant', [{ type: 'output_text', text: assistant }]),
          phase: 'final_answer'
        }
      }
    ]
  }
  if (provider === 'claude') {
    return [
      { type: 'user', message: { role: 'user', content: text(user) } },
      ...tools.flatMap((output, tool) => [
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            stop_reason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                id: `${index}-${tool}`,
                name: 'Read',
                input: { file_path: '/fixture' }
              }
            ]
          }
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: `${index}-${tool}`, content: output }]
          }
        }
      ]),
      {
        type: 'assistant',
        message: { role: 'assistant', stop_reason: 'end_turn', content: text(assistant) }
      }
    ]
  }
  if (provider === 'copilot') {
    return [
      { type: 'user.message', data: { content: user } },
      ...tools.flatMap((output, tool) => [
        {
          type: 'tool.execution_start',
          data: { toolCallId: `${index}-${tool}`, toolName: 'shell' }
        },
        {
          type: 'tool.execution_complete',
          data: { toolCallId: `${index}-${tool}`, result: { content: output } }
        }
      ]),
      { type: 'assistant.message', data: { content: assistant, toolRequests: [] } }
    ]
  }
  return [
    { info: { id: `user-${index}`, role: 'user' }, parts: text(user) },
    ...tools.map((output, tool) => ({
      info: { id: `tool-${index}-${tool}`, role: 'assistant', finish: 'tool-calls' },
      parts: [{ type: 'tool', state: { status: 'completed', output } }]
    })),
    {
      info: { id: `assistant-${index}`, role: 'assistant', finish: 'stop' },
      parts: text(assistant)
    }
  ]
}

async function fixture(provider, turns, path) {
  // Random-looking tool payloads avoid benchmarking only filesystem compression
  // of repeated 'x' characters. Generation is outside every timed interval.
  const pool = randomBytes(4 * 1024 * 1024).toString('base64')
  const handle = await open(path, 'w')
  const expected = []
  let buffer = provider === 'opencode' ? '{"messages":[' : ''
  for (let index = 0; index < turns; index++) {
    const user =
      `User turn ${index}: inspect src/main/providers and explain the conversion. ` +
      'Preserve ordering and existing tools. '.repeat(4)
    const assistant =
      `Final reply ${index}: ` +
      'The native transcript keeps its own tools; migrated messages contain input and final output only. '.repeat(
        9
      )
    expected.push({ role: 'user', content: user }, { role: 'assistant', content: assistant })
    const records = sourceTurn(
      provider,
      user,
      assistant,
      (tool) => {
        const start = ((index * 4 + tool) * 4099) % (pool.length - 4096)
        return pool.slice(start, start + 4096)
      },
      index
    )
    buffer += records
      .map(
        (value, recordIndex) =>
          (provider === 'opencode' && (index || recordIndex) ? ',' : '') +
          JSON.stringify(value) +
          (provider === 'opencode' ? '' : '\n')
      )
      .join('')
    if (buffer.length > 1024 * 1024) {
      await handle.writeFile(buffer)
      buffer = ''
    }
  }
  await handle.writeFile(buffer + (provider === 'opencode' ? ']}' : ''))
  await handle.close()
  return expected
}

export function encode(provider, messages) {
  const sessionId = randomUUID()
  let parentId = null
  let userId = null
  const records = []
  for (let index = 0; index < messages.length; index++) {
    const { role } = messages[index]
    const content = role === 'user' ? withNote(messages[index].content) : messages[index].content
    const uuid = randomUUID()
    if (provider === 'codex') {
      records.push({
        type: 'message',
        role,
        content: [{ type: role === 'user' ? 'input_text' : 'output_text', text: content }]
      })
    } else if (provider === 'claude') {
      records.push({
        parentUuid: parentId,
        isSidechain: false,
        userType: 'external',
        cwd: '/benchmark',
        sessionId,
        uuid,
        timestamp: new Date().toISOString(),
        type: role,
        message:
          role === 'user'
            ? { role, content: [{ type: 'text', text: content }] }
            : {
                id: `msg_${uuid}`,
                type: 'message',
                role,
                model: 'imported-history',
                content: [{ type: 'text', text: content }],
                stop_reason: 'end_turn',
                stop_sequence: null,
                usage: { input_tokens: 0, output_tokens: 0 }
              }
      })
      parentId = uuid
    } else if (provider === 'copilot') {
      const turnId = String(Math.floor(index / 2))
      const data =
        role === 'user'
          ? [['user.message', { content, transformedContent: content, messageId: uuid, turnId }]]
          : [
              ['assistant.turn_start', { turnId }],
              ['assistant.message', { content, messageId: uuid, toolRequests: [], turnId }],
              ['assistant.turn_end', { turnId }]
            ]
      for (const [type, value] of data) {
        const id = randomUUID()
        records.push({ type, data: value, id, timestamp: new Date().toISOString(), parentId })
        parentId = id
      }
    } else {
      const id = `msg_${uuid.replaceAll('-', '')}`
      const partId = `prt_${randomUUID().replaceAll('-', '')}`
      const time = { created: 1700000000000 + index }
      if (role === 'user') userId = id
      const info =
        role === 'user'
          ? {
              id,
              sessionID: sessionId,
              role,
              time,
              agent: 'build',
              model: { providerID: 'benchmark', modelID: 'imported' }
            }
          : {
              id,
              sessionID: sessionId,
              role,
              parentID: userId,
              time: { ...time, completed: time.created },
              agent: 'build',
              mode: 'build',
              modelID: 'imported',
              providerID: 'benchmark',
              path: { cwd: '/benchmark', root: '/benchmark' },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              finish: 'stop'
            }
      records.push({
        info,
        parts: [{ id: partId, sessionID: sessionId, messageID: id, type: 'text', text: content }]
      })
    }
  }
  if (provider === 'codex')
    return { records, bytes: JSON.stringify({ threadId: sessionId, items: records }) }
  if (provider === 'opencode') return { records, bytes: JSON.stringify({ messages: records }) }
  return { records, bytes: records.map((value) => JSON.stringify(value)).join('\n') + '\n' }
}

const summarize = (times) => {
  const sorted = [...times].sort((a, b) => a - b)
  const at = (fraction) =>
    +sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)].toFixed(3)
  return { medianMs: at(0.5), p95Ms: at(0.95), samples: times.length }
}
async function measure(operation, count = runs) {
  await operation()
  const times = []
  for (let index = 0; index < count; index++) {
    global.gc?.()
    const start = performance.now()
    await operation()
    times.push(performance.now() - start)
  }
  return summarize(times)
}
async function durableWrite(path, bytes, append = false) {
  const handle = await open(path, append ? 'a' : 'w')
  try {
    await handle.writeFile(bytes)
    await handle.datasync()
  } finally {
    await handle.close()
  }
}

function sqliteTarget(path) {
  const db = new DatabaseSync(path)
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE INDEX message_session ON message(session_id, time_created);
    CREATE TABLE part(id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX part_message ON part(message_id);`)
  const message = db.prepare('INSERT OR IGNORE INTO message VALUES (?, ?, ?, ?)')
  const part = db.prepare('INSERT OR IGNORE INTO part VALUES (?, ?, ?, ?)')
  return {
    db,
    clear() {
      db.exec('DELETE FROM part; DELETE FROM message; PRAGMA wal_checkpoint(TRUNCATE);')
    },
    insert(records) {
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const record of records) {
          const { id, sessionID, ...data } = record.info
          message.run(id, sessionID, record.info.time.created, JSON.stringify(data))
          for (const value of record.parts) {
            const { id: partId, sessionID: partSession, messageID, ...partData } = value
            part.run(partId, messageID, partSession, JSON.stringify(partData))
          }
        }
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
  }
}

async function worker() {
  const provider = options.worker
  await mkdir(scratchRoot, { recursive: true })
  const directory = await mkdtemp(join(scratchRoot, 'case-'))
  try {
    const sourcePath = join(directory, 'source')
    let expected
    if (options['real-file']) {
      await writeFile(sourcePath, await readFile(options['real-file']))
      expected = extract(provider, await readFile(sourcePath, 'utf8'))
    } else expected = await fixture(provider, Number(options.turns), sourcePath)
    const expectedHash = digest(expected)
    const input = await readFile(sourcePath, 'utf8')
    assert.equal(digest(extract(provider, input)), expectedHash)
    if (provider === 'codex') assert.equal(digest(extract(provider, input, true)), expectedHash)
    const normalizedPath = join(directory, 'text-cache.json')
    await writeFile(normalizedPath, JSON.stringify(expected))
    const result = {
      source: provider,
      dataset: options['real-file'] ? 'real-PoC-session' : `${options.turns}-turns`,
      messages: expected.length,
      rawBytes: (await stat(sourcePath)).size,
      normalizedBytes: (await stat(normalizedPath)).size,
      readNativeFile: await measure(async () => {
        await readFile(sourcePath, 'utf8')
      }),
      parseAndExtract: await measure(() => {
        extract(provider, input)
      }),
      readAndExtract: await measure(async () => {
        extract(provider, await readFile(sourcePath, 'utf8'))
      }),
      readNormalizedCache: await measure(async () => {
        JSON.parse(await readFile(normalizedPath, 'utf8'))
      }),
      targets: {}
    }
    if (provider === 'codex')
      result.readAndSelectivelyExtract = await measure(async () => {
        extract(provider, await readFile(sourcePath, 'utf8'), true)
      })
    for (const target of providers) {
      const path = join(directory, `${target}-output`)
      const encoded = encode(target, expected)
      const deltaMessages = expected.slice(-2)
      const delta = encode(target, deltaMessages)
      const metrics = {
        bytes: Buffer.byteLength(encoded.bytes),
        encodeAndSerialize: await measure(() => {
          encode(target, expected)
        }),
        writeBuffered: await measure(async () => {
          await writeFile(path, encoded.bytes)
        }),
        writeDurable: await measure(async () => {
          await durableWrite(path, encoded.bytes)
        }),
        readConvertWriteDurable: await measure(async () => {
          const messages = extract(provider, await readFile(sourcePath, 'utf8'))
          await durableWrite(path, encode(target, messages).bytes)
        }),
        cachedConvertWriteDurable: await measure(async () => {
          const messages = JSON.parse(await readFile(normalizedPath, 'utf8'))
          await durableWrite(path, encode(target, messages).bytes)
        }),
        missingPairBytes: Buffer.byteLength(delta.bytes),
        appendMissingPairDurable: await measure(async () => {
          await durableWrite(path, encode(target, deltaMessages).bytes, true)
        })
      }
      // OpenCode JSON-file numbers measure export/import staging. This separate
      // transaction measures lower-level storage with a prototype table subset,
      // not the native CLI, API, event system, or provider hydration.
      if (target === 'opencode') {
        const storage = sqliteTarget(join(directory, 'target.sqlite'))
        try {
          const times = []
          for (let repeat = 0; repeat < runs + 1; repeat++) {
            storage.clear()
            const start = performance.now()
            storage.insert(encoded.records)
            if (repeat) times.push(performance.now() - start)
          }
          metrics.sqlitePrototypeFullTransaction = summarize(times)
          metrics.sqlitePrototypeAppendPair = await measure(() => {
            storage.insert(encode(target, deltaMessages).records)
          })
          assert.equal(
            storage.db.prepare('SELECT count(*) AS count FROM message').get().count,
            expected.length + (runs + 1) * 2
          )
        } finally {
          storage.db.close()
        }
      }
      result.targets[target] = metrics
    }
    result.peakRssMiB = +(process.resourceUsage().maxRSS / 1024).toFixed(1)
    console.log(JSON.stringify(result))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function runChild(args) {
  const child = spawn(
    process.execPath,
    [
      '--expose-gc',
      '--disable-warning=ExperimentalWarning',
      script,
      ...args,
      `--runs=${runs}`,
      `--scratch-root=${scratchRoot}`
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let stdout = '',
    stderr = ''
  child.stdout.on('data', (data) => {
    stdout += data
  })
  child.stderr.on('data', (data) => {
    stderr += data
  })
  const code = await new Promise((done) => child.on('exit', done))
  if (code !== 0) throw new Error(`Benchmark child failed (${code}): ${stderr}\n${stdout}`)
  return JSON.parse(stdout.trim())
}

async function main() {
  await mkdir(scratchRoot, { recursive: true })
  const filesystem = await statfs(scratchRoot)
  const rows = []
  const cases = []
  if (options['real-state']) {
    const stateFile = resolve(options['real-state'])
    const state = JSON.parse(await readFile(stateFile, 'utf8'))
    cases.push(['codex', state.sourcePath])
    cases.push(['claude', state.stages.claude.path])
    cases.push(['copilot', state.stages.copilot.path])
    cases.push(['opencode', join(dirname(stateFile), 'opencode-final-export.json')])
  }
  for (const [provider, path] of cases) {
    const row = await runChild([`--worker=${provider}`, `--real-file=${path}`])
    rows.push(row)
    console.log(
      JSON.stringify({
        source: provider,
        dataset: row.dataset,
        rawMiB: +(row.rawBytes / 2 ** 20).toFixed(2),
        readExtractMs: row.readAndExtract.medianMs
      })
    )
  }
  for (const turns of (options.sizes ?? '100,1000,10000').split(',').map(Number)) {
    for (const provider of providers) {
      const row = await runChild([`--worker=${provider}`, `--turns=${turns}`])
      rows.push(row)
      console.log(
        JSON.stringify({
          source: provider,
          turns,
          rawMiB: +(row.rawBytes / 2 ** 20).toFixed(2),
          readExtractMs: row.readAndExtract.medianMs,
          cachedReadMs: row.readNormalizedCache.medianMs
        })
      )
    }
  }
  const report = {
    recordedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      kernel: release(),
      cpu: cpus()[0].model,
      logicalCpus: cpus().length,
      memoryGiB: +(totalmem() / 2 ** 30).toFixed(1),
      scratchRoot,
      filesystemMagic: `0x${filesystem.type.toString(16)}`,
      filesystem:
        filesystem.type === 0x9123683e
          ? 'btrfs'
          : filesystem.type === 0x01021994
            ? 'tmpfs'
            : 'other'
    },
    methodology: {
      runs,
      warmupRuns: 1,
      filesystemCache: 'warm; no global cache eviction or system tuning',
      durability: 'JSON payload files: fdatasync; SQLite prototype: WAL + synchronous=FULL',
      gc: 'explicit GC before samples, outside timed intervals',
      sourceNoise:
        'four approximately 4 KiB tool results per synthetic turn; generation outside timings',
      retainedText: 'about 1 KiB user/final-assistant text per turn',
      targetWrites:
        'Claude/Copilot native-shaped JSONL; Codex RPC-payload and OpenCode export staging files, not native API-ingest timings',
      sqlite:
        'prototype message/part tables only; excludes native OpenCode import/runtime overhead',
      parserScope:
        'linear benchmark fixtures and uncompacted PoC snapshots; not a production fork/compaction/branch traversal implementation',
      excluded: [
        'model requests',
        'model prefill/generation',
        'provider startup/resume',
        'UI',
        'live provider-profile writes'
      ]
    },
    rows
  }
  const output = resolve(options.output ?? 'benchmark-results/chat-migration.json')
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2) + '\n')
  console.log(`Report: ${output}`)
}

if (resolve(process.argv[1] ?? '') === script) {
  if (options.worker) await worker()
  else await main()
}
