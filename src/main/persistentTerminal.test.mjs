import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, test } from 'node:test'
import { build } from 'esbuild'

// Real PTYs and detached brokers; fixture shells only, no GUI or provider accounts.
const directory = await mkdtemp(join(tmpdir(), 'sele-terminal-restart-'))
await symlink(resolve('node_modules'), join(directory, 'node_modules'), 'dir')
const bundle = join(directory, 'terminal.mjs')
await build({
  entryPoints: [new URL('./persistentTerminal.ts', import.meta.url).pathname],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'raw',
      setup(builder) {
        builder.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: join(args.resolveDir, args.path.slice(0, -4)),
          namespace: 'raw'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => ({
          contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))}`
        }))
      }
    }
  ]
})
const { connectPersistentTerminal, listPersistentTerminalIds } = await import(
  pathToFileURL(bundle).href
)
const terminals = []
after(async () => {
  for (const terminal of terminals) {
    await terminal.stop().catch(() => {})
    terminal.detach()
  }
  await rm(directory, { recursive: true, force: true })
})
const waitFor = async (predicate) => {
  const deadline = Date.now() + 5000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'terminal output timed out')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

test('a workspace shell restores the same PID, scrollback, input and resize after frontend exit', async () => {
  const profile = join(directory, 'profile')
  const id = '12345678-1234-4234-8234-123456789abc'
  const first = await connectPersistentTerminal(profile, id, {
    command: {
      file: '/bin/sh',
      args: [
        '-c',
        'printf "started:%s\\n" "$$"; while IFS= read -r line; do printf "reply:%s\\n" "$line"; done'
      ]
    },
    options: { cols: 80, rows: 24, cwd: directory, env: process.env },
    metadata: {
      sessionId: id,
      workspaceKey: 'host\0/fixture',
      chatKey: 'codex:chat',
      label: 'Dev server',
      initialOutput: 'Previous agent output\r\n[process exited with code 7]\r\n',
      shell: 'sh',
      cols: 80,
      rows: 24
    }
  })
  let originalOutput = ''
  const originalChunks = []
  first.onData((data, replay) => {
    originalOutput += data
    originalChunks.push({ data, replay })
  })
  await first.attach()
  await waitFor(() => originalOutput.includes('started:'))
  assert.ok(originalOutput.startsWith('Previous agent output\r\n[process exited with code 7]\r\n'))
  assert.equal(originalChunks[0].replay, true)
  assert.equal(originalChunks.find(({ data }) => data.includes('started:')).replay, false)
  await assert.rejects(connectPersistentTerminal(profile, id), { code: 'EBUSY' })
  first.detach()
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.deepEqual(await listPersistentTerminalIds(profile), [id])
  // An attach-only connection has no command to accidentally replay.
  const restored = await connectPersistentTerminal(profile, id)
  terminals.push(restored)
  assert.equal(restored.pid, first.pid)
  assert.equal(restored.metadata.label, 'Dev server')
  assert.equal(restored.metadata.chatKey, 'codex:chat')
  let output = ''
  const restoredChunks = []
  restored.onData((data, replay) => {
    output += data
    restoredChunks.push({ data, replay })
  })
  await restored.attach()
  restored.resize(110, 35)
  restored.write('after-restart\n')
  await waitFor(() => output.includes('reply:after-restart'))
  assert.ok(output.startsWith('Previous agent output\r\n[process exited with code 7]\r\n'))
  assert.equal(output.split('Previous agent output').length, 2)
  assert.match(output, new RegExp(`started:${first.pid}`))
  assert.equal(restoredChunks[0].replay, true)
  assert.equal(
    restoredChunks.find(({ data }) => data.includes('reply:after-restart')).replay,
    false
  )
  await restored.refreshStatus()
  assert.ok(restored.process)
  let exit
  restored.onExit((value) => {
    exit = value
  })
  await restored.stop()
  await waitFor(() => exit)
})

test('a hard frontend crash preserves a controllable PTY without replaying its command', async (t) => {
  const profile = join(directory, 'crash')
  const id = '12345678-1234-4234-8234-123456789abd'
  const script = join(directory, 'frontend.mjs')
  await writeFile(
    script,
    `
    import { connectPersistentTerminal } from ${JSON.stringify(pathToFileURL(bundle).href)};
    const terminal = await connectPersistentTerminal(${JSON.stringify(profile)}, ${JSON.stringify(id)}, {
      command: { file: '/bin/sh', args: ['-c', 'while IFS= read -r line; do printf "CRASH_REPLY:%s\\n" "$line"; done'] },
      options: { cols: 80, rows: 24, cwd: ${JSON.stringify(directory)}, env: { PATH: '/usr/bin:/bin' } },
      metadata: { sessionId: ${JSON.stringify(id)}, workspaceKey: 'host', shell: 'sh', cols: 80, rows: 24 }
    });
    await terminal.attach();
    process.stdout.write(String(terminal.pid) + '\\n');
  `
  )
  const frontend = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => frontend.kill())
  const [chunk] = await once(frontend.stdout, 'data')
  const pid = Number(chunk.toString().trim())
  assert.ok(pid > 0)
  const died = once(frontend, 'exit')
  frontend.kill('SIGKILL')
  await died
  await new Promise((resolve) => setTimeout(resolve, 100))
  const terminal = await connectPersistentTerminal(profile, id)
  terminals.push(terminal)
  assert.equal(terminal.pid, pid)
  let output = ''
  terminal.onData((data) => {
    output += data
  })
  await terminal.attach()
  terminal.write('after-crash\n')
  await waitFor(() => output.includes('CRASH_REPLY:after-crash'))
})

test('discovery cannot relaunch a terminal whose runtime is absent', async () => {
  await assert.rejects(connectPersistentTerminal(join(directory, 'absent'), 'missing'), {
    code: 'ENOENT'
  })
})

test('explicit stop waits for and force-kills a shell that ignores hangup and termination', async () => {
  const terminal = await connectPersistentTerminal(join(directory, 'stubborn'), 'stubborn', {
    command: {
      file: '/usr/bin/python3',
      args: [
        '-u',
        '-c',
        'import signal,time; signal.signal(signal.SIGHUP,signal.SIG_IGN); signal.signal(signal.SIGTERM,signal.SIG_IGN); print("READY"); time.sleep(60)'
      ]
    },
    options: { cols: 80, rows: 24, cwd: directory, env: process.env },
    metadata: {
      sessionId: 'stubborn',
      workspaceKey: 'fixture',
      shell: 'python3',
      cols: 80,
      rows: 24
    }
  })
  let output = ''
  terminal.onData((data) => {
    output += data
  })
  await terminal.attach()
  await waitFor(() => output.includes('READY'))
  let exit
  terminal.onExit((event) => {
    exit = event
  })
  try {
    await terminal.stop()
    assert.equal(exit?.signal, 9, 'stop only succeeds after the resistant shell exits')
    assert.throws(() => process.kill(terminal.pid, 0), { code: 'ESRCH' })
  } finally {
    terminal.detach()
  }
})
