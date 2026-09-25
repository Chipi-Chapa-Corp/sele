// Compare actual Codex methods from a committed ref and the current working tree.
// No running app, provider process, network, or user conversations are used.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir, cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { build } from 'esbuild'
import ts from 'typescript'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const option = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? fallback : process.argv[index + 1]
}
const samples = Number(option('--samples', '3'))
assert.ok(Number.isInteger(samples) && samples >= 3 && samples <= 20)
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const round = (value) => Number(value.toFixed(3))

// A 1 ms heartbeat captures timer lateness while the operation occupies this Node event loop.
// It includes GC/OS scheduling; it is not an Electron input-to-paint measurement.
const measure = async (operation) => {
  let previous = performance.now()
  let maxStall = 0
  const timer = setInterval(() => {
    const now = performance.now()
    maxStall = Math.max(maxStall, now - previous - 1)
    previous = now
  }, 1)
  await delay(5)
  previous = performance.now()
  maxStall = 0
  const started = performance.now()
  const cpu = process.cpuUsage()
  try {
    const result = await operation()
    const elapsedMs = performance.now() - started
    const used = process.cpuUsage(cpu)
    // Let the heartbeat due during a synchronous operation fire before clearing it.
    await delay(0)
    return { elapsedMs, maxStallMs: maxStall, cpuMs: (used.user + used.system) / 1000, result }
  } finally {
    clearInterval(timer)
  }
}

const runWorker = async (root, label, output) => {
  const modules = [
    'CodexCommandStartAnchors',
    'CodexGoalPrompts',
    'CodexItemRenderers',
    'CodexSubagents',
    'CodexPaginatedHistory',
    'CodexTranscriptMetadataIndex',
    'CodexSubagentHistory'
  ]
  const entry =
    modules
      .filter((name) => existsSync(join(root, 'src/main/providers/codex', `${name}.ts`)))
      .map(
        (name) =>
          `export * from ${JSON.stringify(join(root, 'src/main/providers/codex', `${name}.ts`))}`
      )
      .join('\n') +
    `\nexport * from ${JSON.stringify(join(root, 'src/main/providers/chatDetailLazy.ts'))}`
  const bundle = join(root, 'benchmark-helpers.mjs')
  await build({
    stdin: { contents: entry, resolveDir: root },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundle,
    logLevel: 'silent'
  })
  const helpers = await import(pathToFileURL(bundle).href)
  const updated = Boolean(helpers.CodexTranscriptMetadataIndex)
  const adapterText = await readFile(
    join(root, 'src/main/providers/codex/CodexProviderAdapter.ts'),
    'utf8'
  )
  const source = ts.createSourceFile(
    'CodexProviderAdapter.ts',
    adapterText,
    ts.ScriptTarget.Latest,
    true
  )
  const declaration = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === 'CodexProviderAdapter'
  )
  const harness = (methods, globals = {}) => {
    const members = declaration.members.filter((node) =>
      methods.includes(node.name?.getText(source))
    )
    const code = ts.transpile(
      `class Harness { ${members.map((node) => node.getText(source)).join('\n')} }; new Harness()`,
      { target: ts.ScriptTarget.ES2022 }
    )
    return vm.runInNewContext(code, { ...helpers, Buffer, console, process, ...globals })
  }
  const rows = []
  const record = (scenario, measurements, extra = {}) => {
    const row = {
      scenario,
      samples: measurements.length,
      elapsedMedianMs: round(median(measurements.map((value) => value.elapsedMs))),
      stallMedianMs: round(median(measurements.map((value) => value.maxStallMs))),
      stallMaxMs: round(Math.max(...measurements.map((value) => value.maxStallMs))),
      cpuMedianMs: round(median(measurements.map((value) => value.cpuMs))),
      raw: measurements.map(({ elapsedMs, maxStallMs, cpuMs }) => ({
        elapsedMs: round(elapsedMs),
        maxStallMs: round(maxStallMs),
        cpuMs: round(cpuMs)
      })),
      ...extra
    }
    rows.push(row)
    console.log(
      `${label}: ${scenario}: ${row.elapsedMedianMs} ms elapsed, ${row.stallMedianMs} ms timer stall`
    )
  }

  // Identical native turn objects and timestamp maps, using each revision's exported algorithm.
  for (const count of [10_000, 30_000]) {
    const commands = Array.from({ length: count }, (_, index) => ({
      id: `command-${index}`,
      type: 'commandExecution'
    }))
    const items = [
      { id: 'user', type: 'userMessage' },
      ...commands.slice(0, -1),
      { id: 'answer', type: 'agentMessage', phase: 'final_answer' },
      commands.at(-1)
    ]
    const turn = { id: 'turn', status: 'completed', items }
    for (const reversed of [false, true]) {
      const times = new Map(
        items.map((item, index) => [item.id, reversed ? items.length - index : index])
      )
      const operation = () => helpers.anchorCodexCommandsByStart(turn, times)
      operation() // JIT warmup is excluded from the samples.
      const measurements = []
      for (let index = 0; index < samples; index++) measurements.push(await measure(operation))
      const ids = measurements[0].result.items.map((item) => item.id)
      record(`ordering/${count}/${reversed ? 'reorder' : 'already-ordered'}`, measurements, {
        outputHash: createHash('sha256').update(JSON.stringify(ids)).digest('hex')
      })
    }
  }

  // One ~32 MiB rollout shared by both revisions. The mock server returns pre-encoded
  // base64, excluding server encoding/network time but including the client's decoding.
  const line = (type, payload) => JSON.stringify({ type, payload }) + '\n'
  const filler = line('response_item', { type: 'function_call_output', output: 'x'.repeat(16_384) })
  const rolloutPath = join(root, 'synthetic-rollout.jsonl')
  let rollout = Buffer.from(
    line('event_msg', { type: 'task_started', turn_id: 'turn' }) +
      line('response_item', {
        type: 'message',
        id: 'goal',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: '<codex_internal_context source="goal">Continue the benchmark</codex_internal_context>'
          }
        ]
      }) +
      filler.repeat(2048) +
      line('event_msg', {
        type: 'item_completed',
        turn_id: 'turn',
        item: { id: 'command' },
        started_at_ms: 100
      }) +
      line('event_msg', {
        type: 'item_completed',
        turn_id: 'turn',
        item: { id: 'answer' },
        started_at_ms: 200
      })
  )
  let encoded = rollout.toString('base64')
  await writeFile(rolloutPath, rollout)
  let bytesRead = 0
  let reads = 0
  const metadata = harness(['loadTranscriptMetadata', 'loadTranscriptMetadataUnchecked'], {
    isRunningInFlatpak: () => false,
    getCurrentContainerHostBridge: async () => null,
    getContainerTargetKey: () => 'host',
    isExpectedFileAbsenceError: (error) => error?.code === 'ENOENT',
    localTranscriptSource: (...args) => {
      const local = helpers.localTranscriptSource(...args)
      return {
        ...local,
        read: async (...range) => {
          const bytes = await local.read(...range)
          bytesRead += bytes.length
          reads++
          return bytes
        }
      }
    }
  })
  Object.assign(metadata, {
    goalPrompts: new helpers.CodexGoalPrompts(),
    commandStartAnchors: new helpers.CodexCommandStartAnchors(),
    transcriptMetadataGeneration: 0,
    transcriptMetadataIndex: updated ? new helpers.CodexTranscriptMetadataIndex() : null,
    transcriptRangeSupport: new Map(),
    transcriptMetadataStatSupport: new Map(),
    transcriptMetadataWarnings: new Set(),
    getThreadContainer: () => null,
    client: {
      request: async (method) => {
        assert.equal(method, 'fs/readFile')
        bytesRead += rollout.length
        reads++
        return { dataBase64: encoded }
      }
    }
  })
  const freshThread = () => ({
    id: 'thread',
    path: rolloutPath,
    turns: [
      {
        id: 'turn',
        status: 'completed',
        items: [
          { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: 'Done' },
          { id: 'command', type: 'commandExecution', command: 'true', status: 'completed' }
        ]
      }
    ]
  })
  const loadMetadata = async () => {
    const thread = freshThread() // API snapshots are newly allocated on each navigation.
    await metadata.loadTranscriptMetadata(thread)
    assert.equal(
      metadata.goalPrompts.project(thread.id, thread.turns[0]).goalPrompt.text,
      'Continue the benchmark'
    )
    assert.equal(metadata.commandStartAnchors.project(thread.turns[0]).items[0].id, 'command')
  }
  for (const scenario of ['cold', 'unchanged', 'append-1KiB']) {
    const measurements = []
    const byteSamples = []
    const readSamples = []
    for (let index = 0; index < (scenario === 'cold' ? 1 : samples); index++) {
      if (scenario === 'append-1KiB') {
        rollout = Buffer.concat([
          rollout,
          Buffer.from(
            line('response_item', { type: 'function_call_output', output: 'a'.repeat(1024) })
          )
        ])
        encoded = rollout.toString('base64')
        await writeFile(rolloutPath, rollout)
      }
      bytesRead = 0
      reads = 0
      measurements.push(await measure(loadMetadata))
      byteSamples.push(bytesRead)
      readSamples.push(reads)
    }
    record(`metadata/${scenario}`, measurements, {
      fileBytes: rollout.length,
      bytesReadPerOperation: byteSamples,
      readsPerOperation: readSamples
    })
    if (updated && scenario !== 'cold') assert.ok(Math.max(...byteSamples) < 4096)
  }

  // Real adapter method, real catalog/hydration helpers, real renderers and IPC preparation.
  // Mock RPC responses are prepared before measurement. JSON.parse remains in the timed path,
  // as it is in the real app-server client. Unrelated title/cache bookkeeping is stubbed.
  const turns = [
    {
      id: 'inherited',
      status: 'interrupted',
      startedAt: 100,
      items: [
        { id: 'root-user', type: 'userMessage', content: [{ type: 'text', text: 'Root' }] },
        { id: 'spawn', type: 'subAgentActivity', agentThreadId: 'child', prompt: 'Inspect it' }
      ]
    },
    ...Array.from({ length: 2000 }, (_, index) => ({
      id: `turn-${index}`,
      status: 'completed',
      startedAt: 101 + index,
      items: [
        {
          id: `tool-${index}`,
          type: 'commandExecution',
          status: 'completed',
          command: 'ls',
          aggregatedOutput: 'x'.repeat(16_384)
        },
        {
          id: `answer-${index}`,
          type: 'agentMessage',
          phase: 'final_answer',
          text: `Done ${index}`
        }
      ]
    }))
  ]
  const wire = new Map()
  let preparing = true
  let fullTurns = 0
  let responseBytes = 0
  const request = async (method, params) => {
    assert.equal(method, 'thread/turns/list')
    const key = JSON.stringify(params)
    let text = wire.get(key)
    if (!text) {
      assert.ok(preparing, `unexpected unprepared RPC: ${key}`)
      const ordered = params.sortDirection === 'desc' ? [...turns].reverse() : turns
      const offset = Number(params.cursor ?? 0)
      const page = ordered.slice(offset, offset + params.limit)
      text = JSON.stringify({
        data: page.map((turn) => (params.itemsView === 'full' ? turn : { ...turn, items: [] })),
        nextCursor: offset + page.length < turns.length ? String(offset + page.length) : null
      })
      wire.set(key, text)
    }
    responseBytes += Buffer.byteLength(text)
    const response = JSON.parse(text)
    if (params.itemsView === 'full') fullTurns += response.data.length
    return response
  }
  const makeChildAdapter = () => {
    const adapter = harness(['getSubagentInContext', 'createChatDetail'], {
      assertSupportedCodexHistory: () => {},
      assertReadableCodexHistory: () => {},
      getContainerTargetKey: () => 'host',
      getThreadApiCwd: () => '/repo',
      getThreadTitle: () => 'child',
      getHydratedThreadStatus: () => 'idle',
      codexCapabilities: {}
    })
    Object.assign(adapter, {
      getSubagentsInContext: async () => [],
      readThread: async () => ({
        thread: {
          id: 'child',
          cwd: '/repo',
          historyMode: 'paginated',
          createdAt: 100,
          updatedAt: 3000,
          status: { type: 'idle' },
          turns: []
        }
      }),
      threads: new Map(),
      subagentHistory: updated ? new helpers.CodexSubagentHistory() : null,
      client: { request },
      getCurrentContainer: () => null,
      filterRolledBackTurns: (_id, value) => value,
      getRenderableTurns: (thread) => thread.turns,
      resolveThreadCwd: async () => '/repo',
      resolveThreadName: async () => 'child',
      loadTranscriptMetadata: async () => false,
      rememberThreadContainer: () => {},
      cacheThread: (thread) => adapter.threads.set(thread.id, thread),
      getProviderPendingMessages: () => [],
      getProviderPendingApproval: () => null,
      externallyOwnedThreadIds: new Set(),
      writeAccessChecks: new Map(),
      threadRevisions: new Map(),
      pendingTurnStarts: new Set(),
      pendingTurnIds: new Map(),
      threadContainers: new Map(),
      contextUsageByThread: new Map(),
      goals: new Map()
    })
    return adapter
  }
  const childOperation = async (adapter, startIndex = null) => {
    const detail = await adapter.getSubagentInContext('root', 'child', { startIndex, limit: 10 })
    const prepared = updated
      ? helpers.prepareChatDetailForRenderer(detail)
      : { ...detail, items: helpers.prepareChatItemsForRenderer(detail.items) }
    // Serialize the delivered snapshot in both variants; this is an IPC-payload proxy.
    const payloadBytes = Buffer.byteLength(JSON.stringify(prepared))
    const answer = prepared.items.findLast(
      (item) => item.type === 'message' && item.role === 'assistant'
    )?.content
    assert.equal(answer, startIndex === null || !updated ? 'Done 1999' : 'Done 108')
    return { payloadBytes, answer }
  }
  const preflight = makeChildAdapter()
  await childOperation(preflight)
  await childOperation(preflight)
  await childOperation(preflight, 100)
  preparing = false
  const child = makeChildAdapter()
  for (const scenario of ['cold-latest', 'poll-latest', 'older-page']) {
    const measurements = []
    const turnSamples = []
    const byteSamples = []
    for (let index = 0; index < (scenario === 'cold-latest' ? 1 : samples); index++) {
      fullTurns = 0
      responseBytes = 0
      measurements.push(
        await measure(() => childOperation(child, scenario === 'older-page' ? 100 : null))
      )
      turnSamples.push(fullTurns)
      byteSamples.push(responseBytes)
    }
    record(`subagent/${scenario}`, measurements, {
      fullTurnsPerOperation: turnSamples,
      responseBytesPerOperation: byteSamples,
      payloadBytes: measurements[0].result.payloadBytes
    })
    if (updated && scenario !== 'cold-latest') assert.ok(Math.max(...turnSamples) <= 10)
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        label,
        sourceHash: createHash('sha256')
          .update(adapterText)
          .update(await readFile(bundle))
          .digest('hex'),
        rows
      },
      null,
      2
    ) + '\n'
  )
}

if (process.argv.includes('--worker')) {
  await runWorker(option('--root'), option('--label'), option('--output'))
} else {
  const baseline = option('--baseline', 'main')
  const commit = execFileSync('git', ['rev-parse', '--verify', `${baseline}^{commit}`], {
    cwd: repository,
    encoding: 'utf8'
  }).trim()
  const temporary = await mkdtemp(join(tmpdir(), 'sele-codex-comparison-'))
  try {
    const baselineRoot = join(temporary, 'baseline')
    const workingRoot = join(temporary, 'working')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(baselineRoot)
    const archive = execFileSync('git', ['archive', '--format=tar', commit, 'src'], {
      cwd: repository,
      maxBuffer: 128 * 1024 * 1024
    })
    execFileSync('tar', ['-x', '-C', baselineRoot], { input: archive })
    await cp(join(repository, 'src'), join(workingRoot, 'src'), { recursive: true })
    const variants = []
    for (const [label, root] of [
      ['main', baselineRoot],
      ['uncommitted', workingRoot]
    ]) {
      const output = join(root, 'results.json')
      await new Promise((resolveRun, reject) => {
        const child = spawn(
          process.execPath,
          [
            fileURLToPath(import.meta.url),
            '--worker',
            '--root',
            root,
            '--label',
            label,
            '--output',
            output,
            '--samples',
            String(samples)
          ],
          { stdio: 'inherit' }
        )
        child.on('error', reject)
        child.on('exit', (code) =>
          code === 0 ? resolveRun() : reject(new Error(`${label} benchmark exited ${code}`))
        )
      })
      variants.push(JSON.parse(await readFile(output, 'utf8')))
    }
    const comparisons = variants[0].rows.map((before) => {
      const after = variants[1].rows.find((row) => row.scenario === before.scenario)
      assert.ok(after)
      if (before.outputHash)
        assert.equal(after.outputHash, before.outputHash, `${before.scenario}: ordering changed`)
      return {
        scenario: before.scenario,
        mainMs: before.elapsedMedianMs,
        uncommittedMs: after.elapsedMedianMs,
        mainStallMs: before.stallMedianMs,
        uncommittedStallMs: after.stallMedianMs,
        speedup: round(before.elapsedMedianMs / Math.max(after.elapsedMedianMs, 0.001))
      }
    })
    const result = {
      baseline,
      commit,
      createdAt: new Date().toISOString(),
      node: process.version,
      cpu: cpus()[0]?.model,
      samples,
      methodology:
        'Sequential isolated Node processes, identical synthetic fixtures, actual revision methods/helpers. Mock provider transport excludes network/server latency. 1 ms heartbeat measures event-loop timer lateness. Cold scenarios have one sample; other scenarios report medians. No live Electron or production traces.',
      comparisons,
      variants
    }
    const output = option('--output')
    if (output) await writeFile(resolve(output), JSON.stringify(result, null, 2) + '\n')
    console.table(comparisons)
    if (process.argv.includes('--assert-improvement')) {
      for (const scenario of [
        'ordering/10000/already-ordered',
        'metadata/unchanged',
        'metadata/append-1KiB',
        'subagent/poll-latest'
      ]) {
        const comparison = comparisons.find((row) => row.scenario === scenario)
        assert.ok(
          comparison.speedup >= 3,
          `${scenario}: expected >=3x elapsed-time improvement, got ${comparison.speedup}x`
        )
      }
      console.log(
        'PASS: identical ordering outputs, bounded metadata/subagent reads, and >=3x warm-path speedups.'
      )
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
