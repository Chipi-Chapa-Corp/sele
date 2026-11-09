import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { ProviderProcessStore, processListSource } from './ProviderProcessStore.ts'

const fixture = async (t, override) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-process-ownership-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const calls = [],
    units = new Set(),
    gates = new Set()
  const execute = async (file, args, container) => {
    calls.push({ file, args, container })
    if (override) {
      const result = await override(file, args)
      if (result !== undefined) return result
    }
    if (file === 'systemd-run') return 'systemd 257\n'
    if (args.includes('show-environment')) return ''
    if (file === 'python3') {
      if (args[1].includes('mkdtemp')) {
        const gate = `/tmp/sele-chat-${args[2]}-fixture/permit`
        gates.add(gate)
        return gate
      }
      if (args[1].includes('os.path.isfile')) return gates.has(args[2]) ? 'present' : 'missing'
      if (args[1].includes('os.unlink')) {
        gates.delete(args[2])
        return ''
      }
      return JSON.stringify([
        { pid: 123, command: 'fixture-server', cwd: '/fixture', logs: ['/fixture/output.log'] }
      ])
    }
    if (args.includes('show'))
      return units.has(args[2])
        ? `LoadState=loaded\nControlGroup=/fixture/${args[2]}\n`
        : 'LoadState=not-found\nControlGroup=\n'
    if (args.includes('stop')) {
      units.delete(args[2])
      return ''
    }
    throw new Error(`Unexpected fixture command ${file}`)
  }
  return {
    directory,
    execute,
    store: new ProviderProcessStore(directory, execute),
    calls,
    units,
    gates
  }
}

test('durable ownership survives restart; cleanup addresses only the recorded units in the saved environment', async (t) => {
  const h = await fixture(t)
  const container = { kind: 'container', tool: 'ssh', name: 'fixture' }
  const scope = await h.store.create('codex', 'account', container)
  await scope.bind('chat')
  const launch = await scope.prepare('/fixture/provider', ['--argument', 'literal $()'], {
    cwd: '/space path',
    env: { TOKEN: 'secret-value', PATH: '/fixture/bin' }
  })
  assert.equal(launch.file, 'systemd-run')
  assert.ok(launch.args.includes('--property=ExitType=cgroup'))
  assert.ok(launch.args.includes('--property=KillMode=control-group'))
  assert.ok(launch.args.includes(`--property=ConditionPathExists=${scope.record.gate}`))
  assert.ok(launch.args.includes('--setenv=TOKEN'))
  assert.ok(!launch.args.some((arg) => arg.includes('secret-value')))
  assert.deepEqual(launch.args.slice(-4), ['--', '/fixture/provider', '--argument', 'literal $()'])
  const receipt = JSON.parse(await readFile(join(h.directory, `${scope.record.id}.json`), 'utf8'))
  assert.deepEqual(
    receipt.units,
    scope.record.units,
    'ownership is persisted before the caller can spawn'
  )
  h.units.add(receipt.units[0])
  h.units.add('unrelated.service')
  const restarted = new ProviderProcessStore(h.directory, h.execute)
  assert.equal(await restarted.find('codex', 'other-account', 'chat', container), undefined)
  assert.equal(await restarted.find('codex', 'account', 'chat', null), undefined)
  assert.equal((await restarted.list('codex', 'chat'))[0].processes[0].pid, 123)
  await restarted.stop(scope.record.id)
  assert.deepEqual([...h.units], ['unrelated.service'])
  assert.equal(h.gates.size, 0, 'late starts cannot pass the target-side launch condition')
  assert.ok(
    h.calls.every(
      (call) =>
        call.container === container || JSON.stringify(call.container) === JSON.stringify(container)
    )
  )
  assert.equal(
    await restarted.find('codex', 'account', 'chat', container),
    undefined,
    'a stopped boundary cannot admit new launches'
  )
})

test('a lost launch permit after reboot retires the boundary before a fresh launch', async (t) => {
  const h = await fixture(t)
  const scope = await h.store.create('codex', null, null)
  await scope.bind('chat')
  await scope.prepare('provider', [], {})
  h.gates.clear()
  const restarted = new ProviderProcessStore(h.directory, h.execute)
  assert.equal(await restarted.find('codex', null, 'chat', null), undefined)
})

test('unavailable tracking is explicit and never silently downgrades an existing tracked boundary', async (t) => {
  let broken = false
  const h = await fixture(t, async (file) => {
    if (file === 'systemd-run' && broken) throw Error('No manager')
  })
  const tracked = await h.store.create('claude', null, null)
  await tracked.bind('tracked')
  await tracked.prepare('provider', [], {})
  broken = true
  await assert.rejects(tracked.prepare('provider', [], {}), /refusing an untracked launch/)
  const unavailable = await h.store.create('claude', null, null)
  await unavailable.bind('unavailable')
  assert.deepEqual(await unavailable.prepare('provider', ['arg'], {}), {
    file: 'provider',
    args: ['arg']
  })
  assert.equal((await h.store.list('claude', 'unavailable'))[0].status, 'unavailable')
  assert.equal((await h.store.list('claude', 'unavailable'))[0].canStop, false)
  await assert.rejects(h.store.stop(unavailable.record.id), /systemd/)
})

test('stop prevents an in-flight launch and cleanup failures stay retryable', async (t) => {
  let release, started
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const preparing = new Promise((resolve) => {
    started = resolve
  })
  let stopFailure = true
  const h = await fixture(t, async (file, args) => {
    if (file === 'python3' && args[1].includes('mkdtemp')) {
      started()
      await gate
    }
    if (args.includes('stop') && stopFailure) throw Error('stop failed')
  })
  const scope = await h.store.create('codex', null, null)
  await scope.bind('chat')
  const launch = scope.prepare('provider', [], {})
  await preparing
  const stopped = h.store.stop(scope.record.id)
  release()
  await assert.rejects(launch, /stopped/)
  await stopped
  assert.equal(scope.record.units.length, 0)
  const another = await h.store.create('codex', null, null)
  await another.bind('another')
  await another.prepare('provider', [], {})
  h.units.add(another.record.units[0])
  await assert.rejects(h.store.stop(another.record.id), (error) =>
    error.errors.some((failure) => /stop failed/.test(failure.message))
  )
  stopFailure = false
  await h.store.stop(another.record.id)
  assert.equal(h.units.size, 0)
})

test('process enumeration uses kernel membership, includes nested groups, and exposes only regular output files', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-cgroup-fixture-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const cgroups = join(directory, 'cgroups'),
    proc = join(directory, 'proc')
  await mkdir(join(cgroups, 'owned', 'child'), { recursive: true })
  await writeFile(join(cgroups, 'owned', 'cgroup.procs'), '101\n102\n')
  await writeFile(join(cgroups, 'owned', 'child', 'cgroup.procs'), '103\n')
  for (const [pid, group] of [
    [101, '/owned'],
    [102, '/unrelated'],
    [103, '/owned/child']
  ]) {
    const path = join(proc, String(pid))
    await mkdir(join(path, 'fd'), { recursive: true })
    await writeFile(join(path, 'cgroup'), `0::${group}\n`)
    await writeFile(join(path, 'cmdline'), 'server\0--fixture\0')
  }
  const source = processListSource
    .replace("Path('/sys/fs/cgroup')", `Path(${JSON.stringify(cgroups)})`)
    .replace("Path('/proc')", `Path(${JSON.stringify(proc)})`)
  const { stdout } = await promisify(execFile)('python3', ['-c', source, '/owned'])
  assert.deepEqual(
    JSON.parse(stdout)
      .map((p) => p.pid)
      .sort(),
    [101, 103]
  )
  await assert.rejects(
    promisify(execFile)('python3', ['-c', source, '/../outside']),
    /Invalid cgroup path/
  )
})

test('concurrent preflight cannot mix tracked and untracked launches in one boundary', async (t) => {
  let probes = 0
  const h = await fixture(t, async (file) => {
    if (file === 'systemd-run' && ++probes === 1) throw Error('Manager unavailable')
  })
  const scope = await h.store.create('claude', null, null)
  await scope.bind('chat')
  const results = await Promise.all([
    scope.prepare('provider-a', [], {}),
    scope.prepare('provider-b', [], {})
  ])
  assert.deepEqual(
    results.map((result) => result.file),
    ['provider-a', 'provider-b']
  )
  assert.equal(scope.record.units.length, 0)
  assert.ok(scope.record.unavailable)
})

test('unassigned launches remain visible globally without inventing chat ownership', async (t) => {
  const h = await fixture(t)
  const scope = await h.store.create('codex', 'account', null)
  await scope.prepare('fixture-provider', [], {})
  h.units.add(scope.record.units[0])
  assert.deepEqual(await h.store.list('codex', 'unrelated-chat'), [])
  const [group] = await h.store.list()
  assert.equal(group.chatId, null)
  assert.equal(group.id, scope.record.id)
  await h.store.stop(group.id)
  assert.deepEqual(await h.store.list(), [])
})

test('a recorded boundary can still be stopped when process inspection fails', async (t) => {
  const h = await fixture(t, async (file, args) => {
    if (file === 'python3' && args[1].includes('result = []')) throw Error('Cgroup not visible')
  })
  const scope = await h.store.create('codex', null, null)
  await scope.bind('chat')
  await scope.prepare('provider', [], {})
  h.units.add(scope.record.units[0])
  const [group] = await h.store.list('codex', 'chat')
  assert.equal(group.status, 'unavailable')
  assert.equal(group.canStop, true)
  await h.store.stop(group.id)
  assert.equal(h.units.size, 0)
})
