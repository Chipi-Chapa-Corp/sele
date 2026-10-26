import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const directory = await mkdtemp(join(tmpdir(), 'sele-command-worker-'))
after(() => rm(directory, { recursive: true, force: true }))
const entry = join(directory, 'client.cjs')
await build({
  entryPoints: [new URL('./BufferedCommandWorker.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: entry,
  plugins: [require('../../scripts/tests/helpers/node-workers.cjs')(directory)]
})
const { BufferedCommandWorker } = require(entry)
const workerFile = join(directory, 'bufferedCommand.worker.cjs')
const workerSource = await readFile(workerFile, 'utf8')
const options = { timeout: 3000, maxBuffer: 1024 * 1024 }
const node = (source, env) => ({
  file: process.execPath,
  args: ['-e', source],
  cwd: directory,
  env
})

test('buffered commands preserve stdin, environment, cwd, output and process failures', async () => {
  const runner = new BufferedCommandWorker()
  try {
    const result = await runner.run(
      node(
        `let input='';process.stdin.on('data',v=>input+=v);process.stdin.on('end',()=>{process.stdout.write(JSON.stringify([process.cwd(),process.env.SELE_COMMAND_TEST_VALUE,input]));process.stderr.write('diagnostic')})`,
        { ...process.env, SELE_COMMAND_TEST_VALUE: 'fixture' }
      ),
      { ...options, input: 'exact input\n' }
    )
    assert.equal(result.error, null)
    assert.deepEqual(JSON.parse(result.stdout), [directory, 'fixture', 'exact input\n'])
    assert.equal(result.stderr, 'diagnostic')
    const failed = await runner.run(
      node("process.stdout.write('partial');process.stderr.write('failure');process.exit(7)"),
      options
    )
    assert.ok(failed.error instanceof Error)
    assert.equal(failed.error.code, 7)
    assert.equal(failed.stdout, 'partial')
    assert.equal(failed.stderr, 'failure')
    const missing = await runner.run({ file: join(directory, 'missing'), args: [] }, options)
    assert.equal(missing.error.code, 'ENOENT')
    const timeout = await runner.run(node('setInterval(()=>{},1000)'), { ...options, timeout: 100 })
    assert.equal(timeout.error.killed, true)
    const overflow = await runner.run(node("process.stdout.write('x'.repeat(10000))"), {
      ...options,
      maxBuffer: 32
    })
    assert.equal(overflow.error.code, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
  } finally {
    await runner.dispose()
  }
})

test('slow native spawn work does not block the caller event loop', async () => {
  // Inject a deterministic stand-in for a slow OS spawn in this private worker.
  await writeFile(
    workerFile,
    `const cp=require('node:child_process');const spawnCommand=cp.execFile;cp.execFile=(...args)=>{const start=performance.now();while(performance.now()-start<80){};return spawnCommand(...args)};\n` +
      workerSource
  )
  const runner = new BufferedCommandWorker()
  let ticks = 0
  const timer = setInterval(() => ticks++, 5)
  const start = performance.now()
  try {
    const results = await Promise.all(
      Array.from({ length: 3 }, () => runner.run(node("process.stdout.write('ready')"), options))
    )
    assert.ok(performance.now() - start >= 240, 'the fixture executed its delayed spawn path')
    assert.ok(ticks >= 15, `the caller kept servicing events (${ticks} ticks)`)
    assert.ok(results.every((result) => !result.error && result.stdout === 'ready'))
  } finally {
    clearInterval(timer)
    await runner.dispose()
    await writeFile(workerFile, workerSource)
  }
})

test('worker startup failure rejects requests and a later request can recover', async () => {
  await writeFile(workerFile, "throw new Error('Fixture worker failure')")
  const runner = new BufferedCommandWorker()
  try {
    await assert.rejects(runner.run(node(''), options), /Fixture worker failure/)
    await writeFile(workerFile, workerSource)
    assert.equal(
      (await runner.run(node("process.stdout.write('recovered')"), options)).stdout,
      'recovered'
    )
  } finally {
    await runner.dispose()
    await writeFile(workerFile, workerSource)
  }
})

test('disposing stops owned commands and rejects new work', async () => {
  const pidFile = join(directory, 'child.pid')
  const runner = new BufferedCommandWorker()
  const pending = runner.run(
    node(
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`
    ),
    options
  )
  let pid
  const deadline = Date.now() + 3000
  while (!pid && Date.now() < deadline) {
    pid = await readFile(pidFile, 'utf8')
      .then(Number)
      .catch(() => null)
    if (!pid) await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.ok(pid, 'the child started')
  await runner.dispose()
  const result = await pending
  assert.equal(result.error.signal, 'SIGKILL')
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  await assert.rejects(runner.run(node(''), options), /disposed/)
})
