// End-to-end suite: the real built Sele app drives the real Codex, Claude Code, Copilot and
// OpenCode CLIs, which talk to a scripted local model server. Nothing touches real accounts:
// every provider home, the Sele profile and its database live in a temporary directory.
//
//   npm run test:e2e -- [--provider codex,claude] [--only "queue,steer"] [--phase messaging]
//                       [--skip-build] [--keep]
//
// Run it on a private display (Xvfb or the isolated-gui helper); it opens real windows.
// Results and failure screenshots go to test-results/e2e/<timestamp>/.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const harness = require('./harness.cjs')
const mock = require('./mock-model-server.cjs')
const { Page } = require('./page.cjs')
const { Sele } = require('./sele.cjs')
const { Runner, MainLog } = require('./runner.cjs')

const phases = {
  messaging: require('./scenarios/messaging.cjs'),
  persistence: require('./scenarios/persistence.cjs'),
  navigation: require('./scenarios/navigation.cjs'),
  transcripts: require('./scenarios/transcripts.cjs')
}

function parseArgs(argv) {
  const args = { provider: null, only: null, phase: null, skipBuild: false, keep: false }
  for (let index = 0; index < argv.length; index++) {
    const [key, inline] = argv[index].replace(/^--/, '').split('=')
    const value = () => inline ?? argv[++index]
    if (key === 'provider') args.provider = value().split(',')
    else if (key === 'only') args.only = value().split(',')
    else if (key === 'phase') args.phase = value().split(',')
    else if (key === 'skip-build') args.skipBuild = true
    else if (key === 'keep') args.keep = true
    else throw new Error(`Unknown argument: ${argv[index]}`)
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const artifacts = path.join(harness.root, 'test-results', 'e2e', stamp)
  // Provider homes (SQLite journals, rollouts, sessions) can grow to hundreds of MB; /tmp is
  // quota-limited on many systems, so allow pointing the run somewhere with real space.
  const tempRoot = process.env.SELE_E2E_TMP_DIR || os.tmpdir()
  fs.mkdirSync(tempRoot, { recursive: true })
  const directory = fs.mkdtempSync(path.join(tempRoot, 'sele-e2e-'))
  const space = fs.statfsSync(directory)
  const freeMb = Math.round((space.bavail * space.bsize) / 1024 / 1024)
  if (freeMb < 1024)
    throw new Error(
      `Only ${freeMb} MB free at ${directory}; long histories need space. ` +
        'Set SELE_E2E_TMP_DIR to a directory on a larger filesystem.'
    )
  console.log(`temp space: ${freeMb} MB free at ${directory}`)
  const outDir = path.join(harness.root, 'tmp', 'sele-e2e', 'out')
  fs.mkdirSync(artifacts, { recursive: true })

  if (!args.skipBuild) {
    process.stdout.write('Building Sele…\n')
    harness.buildApp(outDir, { force: true })
  }
  fs.writeFileSync(
    path.join(outDir, 'package.json'),
    JSON.stringify({ name: 'sele', productName: 'Sele', main: './main/index.js' })
  )

  const port = await mock.start({ logFile: path.join(artifacts, 'model-server.log') })
  const requested = args.provider ?? harness.providers
  const { env, executables, dirs } = harness.prepareEnvironment(directory, port)
  const providers = requested.filter((provider) => executables[provider])
  const missing = requested.filter((provider) => !providers.includes(provider))
  process.stdout.write(
    `Providers: ${providers.join(', ')}${missing.length ? ` (not installed: ${missing.join(', ')})` : ''}\n`
  )

  const runner = new Runner({ artifacts, filter: args.only })
  for (const provider of missing) runner.skip(`[${provider}] provider`, 'CLI is not installed')

  const appLog = path.join(artifacts, 'app.log')
  let app = null
  const session = {
    runner,
    mock,
    providers,
    directory,
    env,
    dirs,
    executables,
    page: null,
    sele: null,
    /** Quit Sele before another process writes history into the same provider homes. */
    async stop() {
      if (!app) return
      await app.close()
      app = null
      session.page = null
      session.sele = null
      runner.attach(null, null)
    },
    /** Start (or restart) Sele with the same profile, like a user reopening the app. */
    async launch() {
      if (app) await app.close()
      const mainLog = new MainLog(appLog)
      mainLog.offset = fs.existsSync(appLog) ? fs.statSync(appLog).size : 0
      app = await harness.launchApp({ outDir, env, logFile: appLog })
      session.page = new Page(app.cdp, { artifacts })
      session.sele = new Sele(session.page)
      runner.attach(session.page, mainLog)
      await session.sele.waitReady()
      return session
    }
  }

  runner.onFrozen(() => session.launch())

  let ok = false
  try {
    await runner.check('app starts with every provider', async (context) => {
      const started = Date.now()
      await session.launch()
      context.metric('startupMs', Date.now() - started)
      await session.page.waitFor(
        `(() => { const box = document.querySelector('[role="combobox"][aria-label="Provider"]'); return box && !box.disabled })()`,
        { timeout: 30000, message: 'Provider selector did not load' }
      )
      await session.page.click('[role="combobox"][aria-label="Provider"]')
      await session.page.waitFor(
        `[...document.querySelectorAll('[role="option"]')].some(window.__sele.visible)`,
        {
          message: 'Provider list did not open'
        }
      )
      const offered = await session.page.eval(
        `[...document.querySelectorAll('[role="option"]')].filter(window.__sele.visible).map(option => window.__sele.text(option))`
      )
      await session.page.press('Escape')
      const labels = {
        codex: 'Codex',
        claude: 'Claude',
        copilot: 'Copilot',
        'opencode-v2': 'OpenCode'
      }
      for (const provider of providers)
        if (!offered.some((label) => label.startsWith(labels[provider])))
          context.fail(`${labels[provider]} is not offered`)
    })
    for (const [name, phase] of Object.entries(phases)) {
      if (args.phase && !args.phase.includes(name)) continue
      if (!session.page) await session.launch()
      await phase(session)
    }
  } finally {
    ok = runner.write()
    if (app) await app.close()
    mock.server.close()
    if (args.keep) process.stdout.write(`Kept profile: ${directory}\n`)
    else fs.rmSync(directory, { recursive: true, force: true })
  }
  process.exit(ok ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
