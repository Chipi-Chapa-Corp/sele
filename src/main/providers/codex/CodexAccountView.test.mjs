import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { getCodexAccountViewCommand } from './CodexAccountView.ts'

const account = '00000000-0000-4000-8000-000000000001'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('a pinned Default Codex process survives changing the global account', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sele-pinned-codex-')))
  let child
  try {
    await mkdir(join(root, 'sele/accounts', account), { recursive: true })
    await writeFile(join(root, 'sele/accounts', account, 'auth.json'), '{}')
    const command = await getCodexAccountViewCommand(
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
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sele-missing-codex-')))
  try {
    const command = await getCodexAccountViewCommand(
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
    await assert.rejects(
      () => getCodexAccountViewCommand('codex', [], true, '../invalid'),
      /Invalid Codex account/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

for (const usePosix of [true, false]) {
  test(`${usePosix ? 'POSIX host' : 'native Windows path'} starts one provider and preserves stdio and account-private credential replacement`, async (t) => {
    const prefix = process.platform === 'win32' ? 'sele-shadow-stdio-' : 'sele-shadow-stdio-"\\-'
    const root = await realpath(await mkdtemp(join(tmpdir(), prefix)))
    t.after(() => rm(root, { recursive: true, force: true }))
    const shadow = join(root, 'sele/accounts', account)
    await mkdir(shadow, { recursive: true })
    await writeFile(join(shadow, 'auth.json'), 'old token')
    await writeFile(join(root, 'auth.json'), 'default token')
    await writeFile(join(root, 'auth.json.lock'), 'default lock')
    await writeFile(join(shadow, 'auth.json.lock'), 'account lock')
    const marketplace = '.tmp/bundled-marketplaces/openai-bundled'
    await mkdir(join(root, marketplace, '.agents/plugins'), { recursive: true })
    await writeFile(
      join(root, marketplace, '.agents/plugins/marketplace.json'),
      JSON.stringify({ name: 'openai-bundled', plugins: [{ name: 'unified-computer-use' }] })
    )
    const config = `[marketplaces.openai-bundled]\nsource_type = "local"\nsource = ${JSON.stringify(join(root, marketplace))}\n`
    await writeFile(join(root, 'config.toml'), config)
    const script = join(root, 'provider.cjs')
    await writeFile(
      script,
      `
      const fs = require('node:fs'); const path = require('node:path');
      fs.appendFileSync(path.join(process.env.FIXTURE_ROOT, 'starts'), 'started\\n');
      require('node:readline').createInterface({input: process.stdin}).once('line', line => {
        const prefix = 'marketplaces.openai-bundled.source=';
        const override = process.argv.find(value => value.startsWith(prefix));
        const source = override ? JSON.parse(override.slice(prefix.length)) : path.join(process.env.FIXTURE_ROOT, '${marketplace}');
        const expected = path.join(process.env.CODEX_HOME, '${marketplace}');
        const plugins = source === expected ? JSON.parse(fs.readFileSync(path.join(source, '.agents/plugins/marketplace.json'), 'utf8')).plugins : [];
        const auth = path.join(process.env.CODEX_HOME, 'auth.json');
        fs.writeFileSync(auth + '.new', 'rotated token'); fs.renameSync(auth + '.new', auth);
        process.stdout.write(JSON.stringify({line, home:process.env.CODEX_HOME, sqlite:process.env.CODEX_SQLITE_HOME, plugins}) + '\\n');
        process.stderr.write('fixture stderr'); process.exit(0);
      });
    `
    )
    const env = { ...process.env, CODEX_HOME: root, CODEX_SQLITE_HOME: root, FIXTURE_ROOT: root }
    const command = await getCodexAccountViewCommand(
      process.execPath,
      [script],
      usePosix,
      account,
      env
    )
    const child = spawn(command.file, command.args, { env: command.env })
    let stdout = '',
      stderr = ''
    child.stdout.on('data', (value) => {
      stdout += value
    })
    child.stderr.on('data', (value) => {
      stderr += value
    })
    child.stdin.end('fixture request\n')
    const [code] = await once(child, 'close')
    assert.equal(code, 0, stderr)
    assert.deepEqual(JSON.parse(stdout), {
      line: 'fixture request',
      home: shadow,
      sqlite: root,
      plugins: [{ name: 'unified-computer-use' }]
    })
    assert.equal(stderr, 'fixture stderr')
    assert.equal(await readFile(join(root, 'starts'), 'utf8'), 'started\n')
    assert.equal(await readFile(join(root, 'auth.json'), 'utf8'), 'default token')
    assert.equal(await readFile(join(shadow, 'auth.json'), 'utf8'), 'rotated token')
    assert.equal(await readFile(join(root, 'auth.json.lock'), 'utf8'), 'default lock')
    assert.equal(await readFile(join(shadow, 'auth.json.lock'), 'utf8'), 'account lock')
    assert.equal(await readFile(join(root, 'config.toml'), 'utf8'), config)

    await rm(join(shadow, 'auth.json.lock'))
    await symlink(join(root, 'auth.json.lock'), join(shadow, 'auth.json.lock'))
    const rejected = async () => {
      const invalid = await getCodexAccountViewCommand(
        'unused-provider',
        [],
        usePosix,
        account,
        env
      )
      const child = spawn(invalid.file, invalid.args, { env: invalid.env })
      let stderr = ''
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      const [code] = await once(child, 'close')
      assert.equal(code, 1)
      throw new Error(stderr.trim())
    }
    await assert.rejects(rejected, /Codex account auth\.json\.lock must be private\./)
  })
}
