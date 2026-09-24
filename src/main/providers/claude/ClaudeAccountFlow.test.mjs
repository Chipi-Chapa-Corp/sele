import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const bundled = await build({
  entryPoints: [new URL('./ClaudeAccounts.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  plugins: [
    {
      name: 'account-flow-fixture',
      setup(build) {
        build.onResolve(
          { filter: /^(\.\.\/\.\.\/hostProcess|\.\/ClaudeAccountStorage|\.\/ClaudeUsage)$/ },
          (args) => ({ path: args.path, namespace: 'test' })
        )
        build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({
          contents: path.endsWith('hostProcess')
            ? 'export const getHostCommand = (...args) => globalThis.fixture.command(...args);'
            : path.endsWith('ClaudeUsage')
              ? 'export const fetchClaudeRateLimits = (...args) => globalThis.fixture.usage(...args);'
              : `export const createClaudeAccountStorage = (...args) => globalThis.fixture.storage(...args);
         export const runClaudeAccountCommand = command => globalThis.fixture.run(command);`
        }))
      }
    }
  ]
})

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sele-account-flow-'))
  const script = join(root, 'fake-claude.cjs')
  await writeFile(
    script,
    `const fs = require('node:fs');
    const directory = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
    console.log('https://claude.com/cai/oauth/authorize?code=true&response_type=code&state=fixture&client_id=fixture');
    process.stdin.once('data', code => {
      if (code.toString().trim() !== 'fixture-code') process.exit(1);
      fs.writeFileSync(require('node:path').join(directory,'.credentials.json'), 'fixture-only');
      process.exit(0);
    });`
  )
  const stores = new Map()
  const commands = []
  const fixture = {
    version: '2.1.281',
    authenticated: true,
    usageCalls: [],
    usage: async (token) => {
      fixture.usageCalls.push(token)
      return { seven_day: { utilization: token === 'fixture-default' ? 19 : 7, resets_at: null } }
    },
    command: async (file, args, options) => {
      commands.push({ file, args, options })
      if (args[0] === 'auth' && args[1] === 'login')
        return {
          file: process.execPath,
          args: [script],
          env: options.env
        }
      return { file, args, env: options.env }
    },
    run: async (command) =>
      command.args[0] === '--version'
        ? fixture.version
        : JSON.stringify({ loggedIn: fixture.authenticated, authMethod: 'claude.ai' }),
    storage: async (container) => {
      const key = container?.name ?? 'host'
      if (!stores.has(key)) {
        let registry = null
        const directory = (id) => join(root, key, id)
        stores.set(key, {
          read: async () => registry,
          write: async (value) => {
            registry = value
          },
          credentialDirectory: directory,
          readCredentials: async (id) =>
            JSON.stringify({ claudeAiOauth: { accessToken: `fixture-${id}` } }),
          usageEnvironment: async (id, env) => ({
            ...env,
            CLAUDE_CONFIG_DIR: join(root, key, 'usage', id),
            CLAUDE_SECURESTORAGE_CONFIG_DIR:
              env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? env.CLAUDE_CONFIG_DIR ?? ''
          }),
          createCredentials: async (id) => {
            await mkdir(directory(id), { recursive: true })
          },
          removeCredentials: async (id) => {
            await rm(directory(id), { recursive: true, force: true })
          }
        })
      }
      return stores.get(key)
    }
  }
  const module = { exports: {} }
  vm.runInNewContext(bundled.outputFiles[0].text, {
    module,
    exports: module.exports,
    require,
    fixture,
    console,
    URL,
    Buffer,
    setTimeout,
    clearTimeout,
    process: {
      ...process,
      env: {
        PATH: process.env.PATH,
        CLAUDE_CONFIG_DIR: '/shared-config',
        SELE_CLAUDE_PATH: '/fixture/claude',
        ANTHROPIC_API_KEY: 'inherited-fixture'
      }
    }
  })
  const accounts = new module.exports.ClaudeAccounts()
  return {
    accounts,
    fixture,
    commands,
    supports: module.exports.supportsClaudeAccounts,
    cleanup: async () => {
      accounts.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }
}

test('complete CLI sign-in keeps the shared home and activates only after verified completion', async () => {
  const h = await setup()
  try {
    const { accountId } = await h.accounts.create('Work')
    const login = await h.accounts.login()
    assert.equal(login.acceptsCode, true)
    assert.equal((await h.accounts.get()).accounts.length, 1)
    const command = h.commands.find((command) => command.args[1] === 'login')
    assert.equal(command.options.env.CLAUDE_CONFIG_DIR, '/shared-config')
    assert.equal(command.options.env.ANTHROPIC_API_KEY, '')
    assert.ok(command.options.env.CLAUDE_SECURESTORAGE_CONFIG_DIR.endsWith(accountId))
    await h.accounts.submitCode(login.loginId, 'fixture-code')
    await h.accounts.waitForLogin(accountId, login.loginId)
    await h.accounts.complete(accountId)
    assert.equal(
      (await h.accounts.getEnvironment()).CLAUDE_SECURESTORAGE_CONFIG_DIR,
      command.options.env.CLAUDE_SECURESTORAGE_CONFIG_DIR
    )
    assert.equal(await h.accounts.getAccountLabel(), 'Work')
    const managedUsage = await h.accounts.getUsageEnvironment()
    assert.equal(
      managedUsage.CLAUDE_SECURESTORAGE_CONFIG_DIR,
      (await h.accounts.getEnvironment()).CLAUDE_SECURESTORAGE_CONFIG_DIR
    )
    assert.notEqual(managedUsage.CLAUDE_CONFIG_DIR, '/shared-config')
    assert.equal((await h.accounts.getEnvironment()).CLAUDE_CONFIG_DIR, '/shared-config')
    await h.accounts.select('default')
    assert.equal((await h.accounts.getEnvironment()).ANTHROPIC_API_KEY, 'inherited-fixture')
    const defaultUsage = await h.accounts.getUsageEnvironment()
    assert.notEqual(defaultUsage.CLAUDE_CONFIG_DIR, managedUsage.CLAUDE_CONFIG_DIR)
    assert.equal(defaultUsage.CLAUDE_SECURESTORAGE_CONFIG_DIR, '/shared-config')
    await h.accounts.select(accountId)
    assert.equal(
      (await h.accounts.getUsageEnvironment()).CLAUDE_CONFIG_DIR,
      managedUsage.CLAUDE_CONFIG_DIR
    )
  } finally {
    await h.cleanup()
  }
})

test('fallback caching never carries usage from Default to the added account', async () => {
  const h = await setup()
  try {
    const defaults = await Promise.all([
      h.accounts.getUsageFallback(),
      h.accounts.getUsageFallback()
    ])
    assert.equal(defaults[0].seven_day.utilization, 19)
    assert.equal(h.fixture.usageCalls.length, 1)
    const { accountId } = await h.accounts.create('Work')
    await h.accounts.complete(accountId)
    assert.equal((await h.accounts.getUsageFallback()).seven_day.utilization, 7)
    await h.accounts.select('default')
    assert.equal((await h.accounts.getUsageFallback()).seven_day.utilization, 19)
    assert.equal(h.fixture.usageCalls.length, 2)
  } finally {
    await h.cleanup()
  }
})

test('a login ID cannot authorize another environment; cancel cannot activate an account', async () => {
  const h = await setup()
  try {
    const remote = { container: { kind: 'container', tool: 'ssh', name: 'server' } }
    const { accountId } = await h.accounts.create('Work')
    const login = await h.accounts.login()
    await assert.rejects(
      h.accounts.submitCode(login.loginId, 'fixture-code', remote),
      /no longer pending/
    )
    await assert.rejects(h.accounts.waitForLogin(accountId, 'wrong-login'), /not found/)
    const waiting = h.accounts.waitForLogin(accountId, login.loginId)
    const rejected = assert.rejects(waiting, /canceled/)
    await h.accounts.cancel(accountId)
    await rejected
    assert.equal((await h.accounts.get()).accounts.length, 1)
    await assert.rejects(h.accounts.complete(accountId), /canceled/)
  } finally {
    await h.cleanup()
  }
})

test('old CLIs fail closed before creating a new credential store', async () => {
  const h = await setup()
  try {
    h.fixture.version = '2.1.100'
    assert.equal((await h.accounts.getUsageEnvironment()).CLAUDE_CONFIG_DIR, '/shared-config')
    await assert.rejects(h.accounts.create('Unsupported'), /2\.1\.281/)
    assert.equal(h.supports('2.1.280'), false)
    assert.equal(h.supports('2.1.281'), true)
    assert.equal(h.supports('2.2.0'), true)
    assert.equal(h.supports('unknown'), false)
  } finally {
    await h.cleanup()
  }
})
