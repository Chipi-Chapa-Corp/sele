const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')

;(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sele-single-instance-'))
  const children = []
  try {
    await require('esbuild').build({
      entryPoints: ['src/main/index.ts'],
      outfile: path.join(directory, 'entry.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      plugins: [
        {
          name: 'application-fixture',
          setup(build) {
            build.onResolve({ filter: /^\.\/application$/ }, () => ({
              path: path.resolve('scripts/tests/fixtures/single-instance.ts')
            }))
          }
        }
      ]
    })
    fs.writeFileSync(
      path.join(directory, 'index.html'),
      '<html><body>Single-instance fixture</body></html>'
    )
    fs.writeFileSync(
      path.join(directory, 'launcher.cjs'),
      `
const {app} = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const [directory,token] = process.argv.slice(2)
app.setPath('userData', path.join(directory,'profile'))
app.disableHardwareAcceleration()
const record = event => fs.appendFileSync(path.join(directory,'events.jsonl'),JSON.stringify({event,token,pid:process.pid})+'\\n')
app.on('session-created',()=>record('session-created'))
app.on('before-quit',()=>record('before-quit'))
require('./entry.cjs')
`
    )
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const events = () => {
      if (!fs.existsSync(path.join(directory, 'events.jsonl'))) return []
      return fs
        .readFileSync(path.join(directory, 'events.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse)
    }
    const waitFor = async (description, predicate) => {
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        const found = predicate(events())
        if (found) return found
        await delay(25)
      }
      throw new Error('Timed out: ' + description + '\n' + JSON.stringify(events()))
    }
    const launch = (token, loadingDelay = 0, extraArgs = []) => {
      const child = spawn(
        require('electron'),
        [path.join(directory, 'launcher.cjs'), directory, token, '--no-sandbox', ...extraArgs],
        {
          env: { ...env, SELE_SINGLE_INSTANCE_FIXTURE_DELAY_MS: String(loadingDelay) },
          stdio: ['pipe', 'pipe', 'pipe']
        }
      )
      const launched = { child, token, stderr: '', stdout: '', done: false }
      launched.closed = new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code, signal) => {
          launched.done = true
          resolve({ code, signal })
        })
      })
      child.stderr.on('data', (data) => {
        launched.stderr += data
      })
      child.stdout.on('data', (data) => {
        launched.stdout += data
      })
      children.push(launched)
      return launched
    }
    const assertRejected = async (instance, code = 0) => {
      assert.equal((await instance.closed).code, code, instance.stderr)
      const activity = events().filter((event) => event.token === instance.token)
      assert.equal(
        activity.some((event) =>
          ['runtime-import', 'session-created', 'before-quit', 'ready'].includes(event.event)
        ),
        false,
        'A rejected instance initialized application state: ' + JSON.stringify(activity)
      )
      assert.doesNotMatch(instance.stderr, /Failed to delete the database|Database IO error/)
    }
    const closePrimary = async (instance) => {
      instance.child.stdin.write('quit\n')
      await waitFor(instance.token + ' shutting down', (rows) =>
        rows.find((event) => event.token === instance.token && event.event === 'closing')
      )
    }

    const primary = launch('primary', 1000)
    await waitFor('primary loading', (rows) =>
      rows.find((event) => event.token === primary.token && event.event === 'runtime-import')
    )
    const startupCompetitors = Array.from({ length: 6 }, (_, index) => launch('startup-' + index))
    await Promise.all(startupCompetitors.map((instance) => assertRejected(instance)))
    await waitFor('primary ready', (rows) =>
      rows.find((event) => event.token === primary.token && event.event === 'ready')
    )
    await waitFor('activation delivered', (rows) =>
      rows.find((event) => event.token === primary.token && event.event === 'focus')
    )
    console.log('Startup: six competing launches exited before loading runtime or storage.')

    await assertRejected(launch('provider-cli', 0, ['app-server']), 1)
    const focusCount = events().filter((event) => event.event === 'focus').length
    await assertRejected(launch('already-running'))
    await waitFor(
      'existing window activation',
      (rows) => rows.filter((event) => event.event === 'focus').length > focusCount
    )
    console.log(
      'Running: another launch activated the existing instance; CLI misuse stayed isolated.'
    )

    await closePrimary(primary)
    await assertRejected(launch('during-shutdown'))
    assert.equal((await primary.closed).code, 0, primary.stderr)
    const replacement = launch('replacement')
    const restored = await waitFor('replacement ready', (rows) =>
      rows.find((event) => event.token === replacement.token && event.event === 'ready')
    )
    assert.equal(restored.previous, 'saved')
    await closePrimary(replacement)
    assert.equal((await replacement.closed).code, 0, replacement.stderr)
    console.log(
      'Shutdown: competing launch rejected; restart after exit preserved Chromium settings.'
    )

    const racers = Array.from({ length: 4 }, (_, index) => launch('race-' + index))
    const winnerEvent = await waitFor('simultaneous launch winner', (rows) =>
      rows.find((event) => event.token.startsWith('race-') && event.event === 'ready')
    )
    const winner = racers.find((instance) => instance.token === winnerEvent.token)
    await Promise.all(
      racers.filter((instance) => instance !== winner).map((instance) => assertRejected(instance))
    )
    const loads = events().filter(
      (event) => event.token.startsWith('race-') && event.event === 'runtime-import'
    )
    assert.equal(loads.length, 1)
    assert.equal(winnerEvent.previous, 'saved')
    await closePrimary(winner)
    assert.equal((await winner.closed).code, 0, winner.stderr)
    for (const instance of children)
      assert.doesNotMatch(instance.stderr, /Failed to delete the database|Database IO error/)
    console.log('Simultaneous launches: exactly one runtime and profile owner.')
    console.log('Single-instance Electron checks passed')
  } finally {
    for (const instance of children) if (!instance.done) instance.child.kill('SIGTERM')
    await Promise.allSettled(children.map((instance) => instance.closed))
    fs.rmSync(directory, { recursive: true, force: true })
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
