import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCodexAccountStore } from './CodexAccountStore.ts'
import { parseCodexAccountsOutput } from './CodexAccountConfig.ts'
import { getCodexAccountViewCommand } from './CodexAccountView.ts'

const a = '00000000-0000-4000-8000-000000000001'
const b = '00000000-0000-4000-8000-000000000002'

test('native account lifecycle preserves legacy credentials, names, cancellation and interrupted login rollback', async (t) => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'sele-native-accounts-')))
  t.after(() => rm(home, { recursive: true, force: true }))
  const store = createCodexAccountStore(home)
  await mkdir(join(home, 'sele/accounts', a), { recursive: true })
  await writeFile(join(home, 'auth.json'), 'default')
  await writeFile(join(home, 'sele/accounts', a, 'auth.json'), 'existing auth')
  await writeFile(join(home, 'sele/accounts', a, 'name'), 'legacy label')
  const get = async () => parseCodexAccountsOutput(await store('inspect'))
  assert.equal((await get()).available, true)
  assert.equal((await get()).accounts.length, 2)
  await store('use', [a])
  await store('create', [b])
  await writeFile(join(home, 'sele/accounts', b, 'auth.json'), 'new auth')
  await store('cancel', [b])
  assert.equal((await get()).accounts.find((account) => account.active).id, a)
  await store('create', [b])
  await store('finalize', [b])
  assert.equal((await get()).accounts.find((account) => account.active).id, b)
  assert.deepEqual((await store('names', ['default', a])).split('\0'), [
    'default',
    'default',
    a,
    'existing auth'
  ])
  await store('delete', [a])
  await store('create', [a])
  assert.equal((await get()).accounts.find((account) => account.active).id, b)
  await store('delete', [b])
  assert.equal((await get()).accounts.find((account) => account.active).id, 'default')
  assert.equal(await readFile(join(home, 'auth.json'), 'utf8'), 'default')
  await assert.rejects(store('delete', ['../escape']), /Invalid Codex account/)
})

test('native launch prepares a shadow without a shell, extra Codex invocation or parent environment changes', async (t) => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'sele-native-launch-')))
  t.after(() => rm(home, { recursive: true, force: true }))
  const store = createCodexAccountStore(home)
  await store('create', [a])
  await store('finalize', [a])
  const env = { CODEX_HOME: home, OPENAI_API_KEY: 'fixture', PATH: process.env.PATH }
  const command = await getCodexAccountViewCommand(
    'codex.exe',
    ['app-server', '--listen', 'stdio://'],
    false,
    a,
    env
  )
  assert.equal(command.file, 'codex.exe')
  assert.deepEqual(command.args, [
    'app-server',
    '--listen',
    'stdio://',
    '-c',
    'cli_auth_credentials_store="file"'
  ])
  assert.equal(command.env.CODEX_HOME, join(home, 'sele/accounts', a))
  assert.equal(command.env.CODEX_SQLITE_HOME, home)
  assert.equal(env.CODEX_HOME, home)
  const normal = await getCodexAccountViewCommand(
    'codex.exe',
    ['app-server'],
    false,
    'default',
    env
  )
  assert.equal(normal.env.CODEX_HOME, home)
  await store('delete', [a])
  await assert.rejects(
    getCodexAccountViewCommand('codex.exe', ['app-server'], false, a, env),
    /no longer available/
  )
})

test('account parsing enables macOS and Windows without accepting an unknown remote OS', () => {
  for (const platform of ['Linux', 'Darwin', 'Windows']) {
    const config = parseCodexAccountsOutput([platform, a, a].join('\0'))
    assert.equal(config.available, true)
    assert.equal(config.accounts.find((account) => account.active).id, a)
  }
  assert.equal(parseCodexAccountsOutput('Unknown\0').available, false)
})
