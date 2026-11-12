import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { getCodexAccountViewCommand } from './CodexAccountView.ts'
import { getCodexExecutableError } from './CodexExecutable.ts'

const source = ts.createSourceFile(
  'CodexAppServerClient.ts',
  readFileSync(new URL('./CodexAppServerClient.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (item) => item.name.getText(source) === 'getAppServerCommand'
    )
)
const code = ts.transpile(`${declaration.getText(source)}; getAppServerCommand`, {
  target: ts.ScriptTarget.ES2022
})

const fixture = ({ platform = 'linux', env = {}, flatpak = false, resolve, scope } = {}) =>
  vm.runInNewContext(code, {
    process: { platform, pid: 123, env: { DBUS_SESSION_BUS_ADDRESS: 'fixture', ...env } },
    Date: { now: () => 12345 },
    randomUUID,
    providerProcessContext: { getStore: () => scope },
    isRunningInFlatpak: () => flatpak,
    resolveHostExecutable: resolve ?? (async (file, { env }) => ({ file, env })),
    getCodexExecutableError,
    getCodexAccountViewCommand,
    codexResourceMemoryHigh: '2G'
  })

test('systemd preserves the account shell script and gives concurrent launches unique units', async () => {
  const command = fixture()
  const accountId = '00000000-0000-4000-8000-000000000001'
  const [first, second] = await Promise.all([
    command('/fixture/codex', { accountId }),
    command('/fixture/codex', { accountId })
  ])
  assert.equal(first.command, 'systemd-run')
  assert.ok(first.args.includes('--expand-environment=no'))
  assert.notEqual(
    first.args.find((arg) => arg.startsWith('--unit=')),
    second.args.find((arg) => arg.startsWith('--unit=')),
    'launches in the same millisecond must not claim the same service'
  )
  const wrapper = await getCodexAccountViewCommand(
    '/fixture/codex',
    ['app-server', '-c', 'thread_unload_delay_secs=0', '--listen', 'stdio://'],
    true,
    accountId
  )
  assert.deepEqual(Array.from(first.args.slice(first.args.indexOf('sh'))), [
    wrapper.file,
    ...wrapper.args
  ])
  assert.ok(wrapper.args[1].includes('${target##*/}'))
})

test('resolves Codex before wrapping it and passes its environment through systemd', async () => {
  const env = { PATH: '/custom/node/bin:/usr/bin', CODEX_HOME: '/custom/codex' }
  const calls = []
  const command = await fixture({
    resolve: async (file, options) => {
      calls.push({ file, options })
      return { file: '/custom/node/bin/codex', env }
    }
  })('codex')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].file, 'codex')
  assert.ok(command.args.includes('/custom/node/bin/codex'))
  assert.ok(!command.args.includes('codex'))
  assert.equal(command.env, env)
  assert.ok(command.args.includes('--setenv=PATH'))
  assert.ok(command.args.includes('--setenv=CODEX_HOME'))
})

test('missing Codex fails before building a wrapper with an executable hint', async () => {
  const command = fixture({
    resolve: async () => {
      throw Object.assign(new Error('Executable was not found: codex.'), { code: 'ENOENT' })
    }
  })
  await assert.rejects(command('codex'), {
    code: 'ENOENT',
    message: /Executable was not found: codex.*SELE_CODEX_PATH/
  })
})

test('a saved container is authoritative before Codex lookup and account wrapping', async () => {
  const dev = { kind: 'container', tool: 'distrobox', name: 'dev' }
  const calls = []
  const command = await fixture({
    scope: { record: { container: dev } },
    resolve: async (file, options) => {
      calls.push({ file, options })
      return { file, env: options.env }
    }
  })('/host/bin/codex', { container: { kind: 'host' } })
  assert.equal(calls[0].file, 'codex')
  assert.equal(calls[0].options.container, dev)
  assert.equal(command.command, 'sh')
  assert.ok(command.args.includes('codex'))
  assert.ok(!command.args.includes('/host/bin/codex'))
})

test('reattaching an existing worker does not require the CLI to remain installed', async () => {
  const command = fixture({
    resolve: async () => {
      throw new Error('must not look up the CLI during reattachment')
    }
  })
  await command('codex', { existingOnly: true })
})

test('the account wrapper launches a CLI outside PATH with its resolved Node environment', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sele-codex-launch-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const nodeBin = join(root, 'node-bin')
  await mkdir(nodeBin)
  await symlink(process.execPath, join(nodeBin, 'node'))
  const binary = join(root, 'fixture-codex')
  await writeFile(
    binary,
    '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))\n'
  )
  await chmod(binary, 0o755)
  const env = { PATH: `${nodeBin}:/usr/bin:/bin`, HOME: root, CODEX_HOME: join(root, 'codex') }
  const command = await fixture({
    env: { SELE_DISABLE_CODEX_RESOURCE_ISOLATION: '1' },
    resolve: async () => ({ file: binary, env })
  })('sele-fixture-codex', { accountId: 'default' })
  const child = spawn(command.command, command.args, { env: command.env })
  let stdout = '',
    stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const [code] = await once(child, 'close')
  assert.equal(code, 0, stderr)
  assert.deepEqual(JSON.parse(stdout), [
    'app-server',
    '-c',
    'thread_unload_delay_secs=0',
    '--listen',
    'stdio://'
  ])
})

test('unsupported and disabled resource isolation keeps launching the account wrapper directly', async () => {
  for (const [settings, options] of [
    [{ platform: 'darwin' }, {}],
    [{ flatpak: true }, {}],
    [{ env: { DBUS_SESSION_BUS_ADDRESS: '' } }, {}],
    [{ env: { SELE_DISABLE_CODEX_RESOURCE_ISOLATION: '1' } }, {}],
    [{}, { container: { kind: 'container' } }]
  ]) {
    const result = await fixture(settings)('/fixture/codex', options)
    assert.equal(result.command, 'sh')
    assert.equal(result.args[0], '-c')
    assert.ok(!result.args.some((arg) => arg.startsWith('--unit=')))
  }
})
