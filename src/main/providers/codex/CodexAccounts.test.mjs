import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import test from 'node:test'
import { getCodexAccountViewCommand } from './CodexAccountView.ts'
import {
  isRecoverableCodexLoginAccountReadError,
  isRecoverableCodexStopError,
  normalizeCodexAccountName,
  parseCodexAccountsOutput
} from './CodexAccountConfig.ts'

test('parses environment-scoped Codex accounts and marks the active account', () => {
  const firstId = '123e4567-e89b-42d3-a456-426614174000'
  const secondId = '123e4567-e89b-42d3-a456-426614174001'
  const configuration = parseCodexAccountsOutput(
    ['Linux', secondId, firstId, 'Personal', secondId, 'Work', ''].join('\0')
  )

  assert.deepEqual(configuration, {
    available: true,
    unavailableMessage: null,
    accounts: [
      { id: 'default', name: 'Default', active: false },
      { id: firstId, name: 'Personal', active: false },
      { id: secondId, name: 'Work', active: true }
    ]
  })
})

test('always exposes Default and selects it when no configured account is active', () => {
  const accountId = '123e4567-e89b-42d3-a456-426614174000'
  const configuration = parseCodexAccountsOutput(
    ['Linux', 'pending-account', accountId, 'Personal', ''].join('\0')
  )

  assert.deepEqual(configuration.accounts, [
    { id: 'default', name: 'Default', active: true },
    { id: accountId, name: 'Personal', active: false }
  ])
})

test('reports non-Linux target platforms as unavailable', () => {
  assert.deepEqual(parseCodexAccountsOutput('Darwin\0'), {
    available: false,
    unavailableMessage: 'Accounts configuration is not available on MacOS',
    accounts: []
  })
})

test('normalizes and validates account names', () => {
  assert.equal(normalizeCodexAccountName('  Work  '), 'Work')
  assert.throws(() => normalizeCodexAccountName('   '), /required/)
  assert.throws(() => normalizeCodexAccountName('bad\nname'), /control characters/)
})

test('continues login when Codex treats a new auth placeholder as incomplete ChatGPT auth', () => {
  assert.equal(
    isRecoverableCodexLoginAccountReadError(
      new Error('plan type is required for chatgpt authentication')
    ),
    true
  )
  assert.equal(
    isRecoverableCodexLoginAccountReadError(
      new Error('email and plan type are required for chatgpt authentication')
    ),
    true
  )
  assert.equal(isRecoverableCodexLoginAccountReadError(new Error('connection failed')), false)
})

test('treats a missing thread after an account switch as already stopped', () => {
  assert.equal(isRecoverableCodexStopError(new Error('thread not found')), true)
  assert.equal(isRecoverableCodexStopError(new Error('Thread was not found')), true)
  assert.equal(isRecoverableCodexStopError(new Error('no active turn')), true)
  assert.equal(isRecoverableCodexStopError(new Error('connection failed')), false)
})

test('wraps Codex in the Linux account filesystem view only on Linux', () => {
  const linuxCommand = getCodexAccountViewCommand('/usr/bin/codex', ['app-server'], true)
  assert.equal(linuxCommand.file, 'sh')
  assert.match(linuxCommand.args[1], /--die-with-parent --bind \/ \/ --bind/)
  assert.deepEqual(linuxCommand.args.slice(-2), ['/usr/bin/codex', 'app-server'])

  assert.deepEqual(getCodexAccountViewCommand('codex', ['--version'], false), {
    file: 'codex',
    args: ['--version']
  })
})

test('the Codex account wrapper preserves stdio for app-server', () => {
  const command = getCodexAccountViewCommand('sh', [
    '-c',
    'IFS= read -r line; printf "<%s>" "$line"'
  ])
  const result = spawnSync(command.file, command.args, {
    encoding: 'utf8',
    input: 'initialize\n'
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '<initialize>')
})

test('the Linux view redirects auth writes while preserving the regular Codex home', async (t) => {
  if (process.platform !== 'linux') {
    t.skip('Linux-only filesystem view')
    return
  }

  const codexHome = await mkdtemp(join(tmpdir(), 'sele-codex-account-view-'))
  const accountId = '123e4567-e89b-42d3-a456-426614174000'
  const accountHome = join(codexHome, 'sele', 'accounts', accountId)

  try {
    await mkdir(accountHome, { recursive: true })
    await writeFile(join(codexHome, 'auth.json'), 'regular')
    await writeFile(join(codexHome, 'sele', 'active-account'), `${accountId}\n`)
    await writeFile(join(accountHome, 'auth.json'), 'account')

    const command = getCodexAccountViewCommand('sh', [
      '-c',
      'printf account-updated > "$CODEX_HOME/auth.json"'
    ])
    const result = spawnSync(command.file, command.args, {
      encoding: 'utf8',
      env: { ...process.env, CODEX_HOME: codexHome }
    })
    if (result.status !== 0 && /not permitted|bwrap.*not found/i.test(result.stderr)) {
      t.skip(`Filesystem namespaces are unavailable: ${result.stderr.trim()}`)
      return
    }

    assert.equal(result.status, 0, result.stderr)
    assert.equal(await readFile(join(accountHome, 'auth.json'), 'utf8'), 'account-updated')
    assert.equal(await readFile(join(codexHome, 'auth.json'), 'utf8'), 'regular')
  } finally {
    await rm(codexHome, { recursive: true, force: true })
  }
})

test('a running Linux view exits when the selected account changes', async (t) => {
  if (process.platform !== 'linux') {
    t.skip('Linux-only filesystem view')
    return
  }

  const codexHome = await mkdtemp(join(tmpdir(), 'sele-codex-account-switch-'))
  const firstId = '123e4567-e89b-42d3-a456-426614174000'
  const secondId = '123e4567-e89b-42d3-a456-426614174001'
  const firstHome = join(codexHome, 'sele', 'accounts', firstId)
  const secondHome = join(codexHome, 'sele', 'accounts', secondId)
  let child = null

  try {
    await mkdir(firstHome, { recursive: true })
    await mkdir(secondHome, { recursive: true })
    await writeFile(join(codexHome, 'auth.json'), 'regular')
    await writeFile(join(codexHome, 'sele', 'active-account'), `${firstId}\n`)
    await writeFile(join(firstHome, 'auth.json'), 'first')
    await writeFile(join(secondHome, 'auth.json'), 'second')

    const command = getCodexAccountViewCommand('sh', [
      '-c',
      'printf "%s\\n" "$$" > "$CODEX_HOME/view-child-pid"; sleep 30'
    ])
    child = spawn(command.file, command.args, {
      env: { ...process.env, CODEX_HOME: codexHome },
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    await new Promise((resolve) => setTimeout(resolve, 200))
    if (child.exitCode !== null && /not permitted|bwrap.*not found/i.test(stderr)) {
      t.skip(`Filesystem namespaces are unavailable: ${stderr.trim()}`)
      return
    }

    let childPid = Number.NaN
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        childPid = Number((await readFile(join(codexHome, 'view-child-pid'), 'utf8')).trim())
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    }
    assert.ok(Number.isInteger(childPid), 'Codex view child did not start')

    await writeFile(join(codexHome, 'sele', 'active-account'), `${secondId}\n`)
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Stale Codex view did not stop')), 3_000)
      child.once('close', (code, signal) => {
        clearTimeout(timeout)
        resolve({ code, signal })
      })
    })

    assert.notEqual(result.code, 0)
    assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' })
  } finally {
    child?.kill()
    await rm(codexHome, { recursive: true, force: true })
  }
})
