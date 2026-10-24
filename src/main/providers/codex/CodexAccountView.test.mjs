import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { getCodexAccountViewCommand } from './CodexAccountView.ts'
import { codexAccountViewHelperScript } from './CodexAccountViewHelper.ts'

const account = '00000000-0000-4000-8000-000000000001'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('a pinned Default Codex process survives changing the global account', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sele-pinned-codex-'))
  let child
  try {
    await mkdir(join(root, 'sele/accounts', account), { recursive: true })
    await writeFile(join(root, 'sele/accounts', account, 'auth.json'), '{}')
    const command = getCodexAccountViewCommand(
      process.execPath,
      ['-e', "console.log('ready');setInterval(()=>{},1000)"],
      true,
      'default'
    )
    child = spawn(command.file, command.args, { env: { ...process.env, CODEX_HOME: root } })
    let stderr = ''
    child.stderr.on('data', (value) => {
      stderr += value
    })
    const exited = once(child, 'exit')
    await Promise.race([
      once(child.stdout, 'data'),
      exited.then(([code]) => {
        throw new Error(`Early exit ${code}: ${stderr}`)
      })
    ])
    await writeFile(join(root, 'sele/active-account'), account)
    await sleep(1250)
    assert.equal(child.exitCode, null, stderr)
    child.kill('SIGTERM')
    await exited
  } finally {
    if (child?.exitCode === null) child.kill('SIGTERM')
    await rm(root, { recursive: true, force: true })
  }
})

test('missing pinned credentials fail instead of silently using the default account', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sele-missing-codex-'))
  try {
    const command = getCodexAccountViewCommand(
      process.execPath,
      ['-e', "console.log('WRONG ACCOUNT')"],
      true,
      account
    )
    const child = spawn(command.file, command.args, { env: { ...process.env, CODEX_HOME: root } })
    let output = ''
    child.stdout.on('data', (value) => {
      output += value
    })
    const [code] = await once(child, 'exit')
    assert.equal(code, 1)
    assert.equal(output, '')
    assert.throws(
      () => getCodexAccountViewCommand('codex', [], true, '../invalid'),
      /Invalid Codex account/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the privilege-dropping helper delegates account lifetime to the outer view', async () => {
  const child = spawn('sh', ['-n'])
  child.stdin.end(codexAccountViewHelperScript)
  const [code] = await once(child, 'exit')
  assert.equal(code, 0)
  assert.equal(codexAccountViewHelperScript.includes('active-account'), false)
})
