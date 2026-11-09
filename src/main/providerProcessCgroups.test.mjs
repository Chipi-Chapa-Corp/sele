import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { ProviderProcessStore } from './ProviderProcessStore.ts'

// Opt in only inside an isolated session with its own user systemd manager.
// No installed provider, real account, desktop application, or inherited bus is used.
test('real cgroups retain environment-cleared detached children and cleanup preserves another chat', {
  skip: !process.env.ISOLATED_GUI_SESSION || process.env.SELE_TEST_PROCESS_CGROUPS !== '1'
}, async (t) => {
  const run = promisify(execFile)
  const execute = async (file, args) => {
    try {
      return (await run(file, args, { timeout: 15000 })).stdout
    } catch (error) {
      if (
        file === 'systemctl' &&
        args.includes('show') &&
        /^LoadState=not-found$/m.test(error.stdout ?? '')
      )
        return error.stdout
      throw error
    }
  }
  try {
    await execute('systemctl', ['--user', 'show-environment'])
  } catch {
    t.skip('The private D-Bus session has no user systemd manager.')
    return
  }
  const directory = await mkdtemp(join(tmpdir(), 'sele-real-cgroups-'))
  const store = new ProviderProcessStore(join(directory, 'receipts'), execute)
  const scopes = [],
    launchers = []
  t.after(async () => {
    await Promise.allSettled(scopes.map((scope) => store.stop(scope.record.id)))
    for (const child of launchers) child.kill('SIGKILL')
    await rm(directory, { recursive: true, force: true })
  })
  const start = async (chatId) => {
    const scope = await store.create('claude', null, null)
    scopes.push(scope)
    await scope.bind(chatId)
    const pidFile = join(directory, `${chatId}.pid`)
    const log = join(directory, `${chatId}.log`)
    const source = `import os,sys,time
if os.fork(): sys.exit(0)
os.setsid()
os.environ.clear()
fd=os.open(sys.argv[2],os.O_CREAT|os.O_WRONLY,0o600)
os.dup2(fd,1); os.dup2(fd,2)
open(sys.argv[1],'w').write(str(os.getpid()))
time.sleep(60)
`
    const command = await scope.prepare('python3', ['-c', source, pidFile, log], {
      env: process.env
    })
    assert.equal(command.file, 'systemd-run', scope.record.unavailable)
    const child = spawn(command.file, command.args, { env: process.env, stdio: 'ignore' })
    launchers.push(child)
    child.on('error', () => {})
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      try {
        const pid = Number(await readFile(pidFile, 'utf8'))
        if (pid > 0) return { scope, pid, log }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error('Fixture service did not start.')
  }
  const first = await start('first'),
    second = await start('second')
  const restored = new ProviderProcessStore(join(directory, 'receipts'), execute)
  const groups = await restored.list('claude', 'first')
  const member = groups
    .flatMap((group) => group.processes)
    .find((member) => member.pid === first.pid)
  assert.ok(member, 'detached child is found through its exact cgroup after restart')
  assert.ok(member.logs.includes(first.log))
  const alive = async (pid) => {
    try {
      return !(await readFile(`/proc/${pid}/stat`, 'utf8')).split(') ').at(-1).startsWith('Z ')
    } catch (error) {
      if (error.code === 'ENOENT') return false
      throw error
    }
  }
  await restored.stop(first.scope.record.id)
  assert.equal(await alive(first.pid), false)
  assert.equal(await alive(second.pid), true)
  await restored.stop(second.scope.record.id)
  assert.equal(await alive(second.pid), false)
})
