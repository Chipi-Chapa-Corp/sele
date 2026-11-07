import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { getCodexAccountViewCommand } from './CodexAccountView.ts'

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

const fixture = ({ platform = 'linux', env = {}, flatpak = false } = {}) =>
  vm.runInNewContext(code, {
    process: { platform, pid: 123, env: { DBUS_SESSION_BUS_ADDRESS: 'fixture', ...env } },
    Date: { now: () => 12345 },
    randomUUID,
    isRunningInFlatpak: () => flatpak,
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
