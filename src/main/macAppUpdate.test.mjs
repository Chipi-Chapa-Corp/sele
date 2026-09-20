import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  selectMacUpdate,
  macInstallScript,
  macSupervisorScript,
  shellQuote,
  macAuthorizationScript,
  readMacUpdateResult
} from './macAppUpdate.ts'

const release = {
  tag_name: 'v2.16.0',
  assets: [
    {
      name: 'Sele-2.16.0-arm64-mac.zip',
      browser_download_url:
        'https://github.com/Chipi-Chapa-Corp/sele/releases/download/v2.16.0/Sele-2.16.0-arm64-mac.zip',
      digest: `sha256:${'a'.repeat(64)}`,
      size: 123
    }
  ]
}
test('release selection requires a newer stable version, matching architecture and trusted asset metadata', () => {
  assert.equal(selectMacUpdate(release, '2.15.0', 'arm64').version, '2.16.0')
  assert.equal(selectMacUpdate(release, '2.16.0', 'arm64'), null)
  assert.equal(selectMacUpdate({ ...release, prerelease: true }, '2.15.0', 'arm64'), null)
  assert.throws(() => selectMacUpdate(release, '2.15.0', 'x64'), /no update/)
  for (const patch of [
    { digest: undefined },
    { size: 0 },
    { browser_download_url: 'https://example.com/payload.zip' }
  ]) {
    assert.throws(
      () =>
        selectMacUpdate(
          { ...release, assets: [{ ...release.assets[0], ...patch }] },
          '2.15.0',
          'arm64'
        ),
      /metadata/
    )
  }
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const exists = async (path) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
async function waitFor(path) {
  for (let i = 0; i < 200; i++) {
    if (await exists(path)) return
    await sleep(50)
  }
  throw new Error(`Timed out: ${path}`)
}

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "sele update ' $() "))
  const target = join(root, 'Sele.app')
  const stage = join(root, 'stage')
  const source = join(stage, 'Sele.app')
  await mkdir(target)
  await mkdir(source, { recursive: true })
  await writeFile(join(target, 'version'), 'old')
  await writeFile(join(source, 'version'), 'new')
  const archive = join(stage, 'update.zip')
  execFileSync('/usr/bin/zip', ['-qr', archive, 'Sele.app'], { cwd: stage })
  const checksum = createHash('sha256')
    .update(await readFile(archive))
    .digest('hex')
  const parent = spawn('/bin/sleep', ['300'])
  const parentExit = once(parent, 'exit')
  let worker
  let completion
  t.after(async () => {
    parent.kill()
    await parentExit
    if (worker && worker.exitCode === null) worker.kill()
    if (completion) await completion
    await rm(root, { recursive: true, force: true })
  })
  let script = macInstallScript(
    target,
    archive,
    options.badHash ? '0'.repeat(64) : checksum,
    stage,
    parent.pid
  )
  if (process.platform !== 'darwin') {
    // Execute the actual transaction on Linux, substituting only platform-specific tools.
    script = script
      .replace(
        '/usr/bin/ditto --noqtn -x -k "$work/update.zip" "$work/unpacked"',
        '/usr/bin/unzip -q "$work/update.zip" -d "$work/unpacked"'
      )
      .replace('/usr/bin/xattr -dr com.apple.quarantine "$work/new.app"', ':')
  } else {
    // Exercise both attribute-present and attribute-absent cases on native macOS CI.
    execFileSync('/usr/bin/xattr', ['-w', 'com.apple.quarantine', '0081;00000000;Sele;', source])
    execFileSync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', source])
    execFileSync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', source])
  }
  if (options.failReplacement) {
    script = script.replace('/bin/mv "$work/new.app" "$target"', '/usr/bin/false')
  }
  if (options.supervisor) {
    script = macSupervisorScript(script, false, target, stage).replaceAll(
      '/usr/bin/open -n',
      '/usr/bin/true'
    )
  }
  execFileSync('/bin/bash', ['-n', '-c', script])
  worker = spawn('/bin/bash', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  worker.stdout.on('data', (chunk) => {
    output += chunk
  })
  worker.stderr.on('data', (chunk) => {
    output += chunk
  })
  completion = once(worker, 'exit')
  return {
    target,
    stage,
    completion,
    output: () => output,
    stopParent: async () => {
      parent.kill()
      await parentExit
    }
  }
}

test('helper waits for exit, installs, and supervisor records success with quoted paths', {
  timeout: 20000
}, async (t) => {
  const f = await fixture(t, { supervisor: true })
  await waitFor(join(f.stage, 'ready'))
  assert.equal(await readFile(join(f.target, 'version'), 'utf8'), 'old')
  await mkdir(join(f.stage, 'commit'))
  await f.stopParent()
  const [code] = await f.completion
  assert.equal(code, 0, f.output())
  assert.equal(await readFile(join(f.target, 'version'), 'utf8'), 'new')
  assert.equal((await readFile(join(f.stage, 'result'), 'utf8')).trim(), 'success')
})

test('cancel before quit preserves the installed app', { timeout: 20000 }, async (t) => {
  const f = await fixture(t)
  await waitFor(join(f.stage, 'ready'))
  await mkdir(join(f.stage, 'cancel'))
  assert.notEqual((await f.completion)[0], 0)
  assert.equal(await readFile(join(f.target, 'version'), 'utf8'), 'old')
})

test('failed relaunch rolls back the replacement', { timeout: 20000 }, async (t) => {
  const f = await fixture(t)
  await waitFor(join(f.stage, 'ready'))
  await mkdir(join(f.stage, 'commit'))
  await f.stopParent()
  await waitFor(join(f.stage, 'installed'))
  await mkdir(join(f.stage, 'launch-failed'))
  assert.notEqual((await f.completion)[0], 0)
  assert.equal(await readFile(join(f.target, 'version'), 'utf8'), 'old')
  assert.ok(await exists(join(f.stage, 'rolled-back')))
})

test('private-copy checksum mismatch never signals ready or replaces the app', {
  timeout: 20000
}, async (t) => {
  const f = await fixture(t, { badHash: true })
  assert.notEqual((await f.completion)[0], 0)
  assert.equal(await readFile(join(f.target, 'version'), 'utf8'), 'old')
  assert.equal(await exists(join(f.stage, 'ready')), false)
})

test('elevated command embeds the transaction inline and delegates credentials to macOS', () => {
  const script = macSupervisorScript(
    "echo 'test'\necho done",
    true,
    "/Applications/Sele's.app",
    '/tmp/stage'
  )
  execFileSync('/bin/bash', ['-n', '-c', script])
  assert.match(script, /with administrator privileges/)
  assert.match(script, /\/usr\/bin\/osascript/)
  assert.equal(
    execFileSync('/bin/bash', ['-c', `printf %s ${shellQuote("a'\n$(touch /tmp/not-executed)")}`], {
      encoding: 'utf8'
    }),
    "a'\n$(touch /tmp/not-executed)"
  )
})

test('rename failure restores the old bundle before reporting failure', {
  timeout: 20000
}, async (t) => {
  const f = await fixture(t, { failReplacement: true })
  await waitFor(join(f.stage, 'ready'))
  await mkdir(join(f.stage, 'commit'))
  await f.stopParent()
  assert.notEqual((await f.completion)[0], 0)
  assert.equal(await readFile(join(f.target, 'version'), 'utf8'), 'old')
  assert.ok(await exists(join(f.stage, 'rolled-back')))
})

test('post-exit results preserve failure diagnostics and clean successful staging', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sele-result-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const result of ['error', 'success']) {
    const stage = await mkdtemp(join(root, 'mac-update-'))
    await writeFile(
      join(root, 'mac-update-pending.json'),
      JSON.stringify({ stage, version: '2.16.0' })
    )
    await writeFile(join(stage, 'result'), result)
    await writeFile(join(stage, 'helper.log'), 'transaction diagnostics')
    const recovered = await readMacUpdateResult(root)
    assert.equal(recovered.version, '2.16.0')
    assert.equal(recovered.error === null, result === 'success')
    assert.equal(await exists(stage), result === 'error')
    assert.equal(await exists(join(root, 'mac-update-pending.json')), false)
  }
})

test('administrator AppleScript compiles on macOS without executing or prompting', {
  skip: process.platform !== 'darwin'
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sele-applescript-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  execFileSync('/usr/bin/osacompile', [
    '-o',
    join(root, 'helper.scpt'),
    '-e',
    macAuthorizationScript('/bin/bash -c ' + shellQuote('echo \'quoted\'\necho "done"'))
  ])
})
