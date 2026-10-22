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
    if (process.env.BROWSER !== 'true') throw new Error('Automatic browser launch must be disabled');
    const directory = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
    console.log('https://claude.com/cai/oauth/authorize?code=true&response_type=code&state=fixture&client_id=fixture');
    process.stdin.once('data', code => {
      if (code.toString().trim() !== 'fixture-code') process.exit(1);
      if (directory) fs.writeFileSync(require('node:path').join(directory,'.credentials.json'), 'fixture-only');
      process.exit(0);
    });`
  )
  const stores = new Map()
  const commands = []
  const fixture = {
    version: '2.1.281',
    authenticated: true,
    authMethod: 'claude.ai',
    usageCalls: [],
    profileCalls: [],
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
        : JSON.stringify({ loggedIn: fixture.authenticated, authMethod: fixture.authMethod }),
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
    // Shared so tests can move the clock for cache expiry.
    Date,
    URL,
    Buffer,
    AbortSignal,
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.anthropic.com/api/oauth/profile')
      fixture.profileCalls.push(options.headers.Authorization)
      return {
        ok: true,
        json: async () => ({
          account: {
            display_name:
              options.headers.Authorization === 'Bearer fixture-default'
                ? 'Personal Name'
                : 'Work Name'
          }
        })
      }
    },
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
    root,
    // A second instance over the same fixture, as after an app restart.
    restart: () => new module.exports.ClaudeAccounts(),
    fixture,
    commands,
    supports: module.exports.supportsClaudeAccounts,
    cleanup: async () => {
      accounts.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }
}

test('auth status uses the selected credentials and rejects an unsigned account before sending', async () => {
  const h = await setup()
  try {
    assert.equal(await h.accounts.getAuthenticationMethod(), 'claude.ai')
    const { accountId } = await h.accounts.create()
    await h.accounts.complete(accountId)
    assert.equal(await h.accounts.getAuthenticationMethod(), 'claude.ai')
    const command = h.commands.findLast((command) => command.args[1] === 'status')
    assert.ok(command.options.env.CLAUDE_SECURESTORAGE_CONFIG_DIR.endsWith(accountId))
    assert.equal(command.options.env.ANTHROPIC_API_KEY, '')
    assert.equal(command.options.env.CLAUDE_CONFIG_DIR, '/shared-config')
    h.fixture.authenticated = false
    h.fixture.authMethod = 'none'
    await assert.rejects(
      h.accounts.getAuthenticationMethod(),
      (error) => error.code === 'authentication_failed'
    )
    h.fixture.authenticated = true
    h.fixture.authMethod = 'api_key'
    assert.equal(await h.accounts.getAuthenticationMethod(), 'api_key')
  } finally {
    await h.cleanup()
  }
})

test('complete CLI sign-in keeps the shared home and activates only after verified completion', async () => {
  const h = await setup()
  try {
    const { accountId } = await h.accounts.create()
    const login = await h.accounts.login()
    assert.equal(login.acceptsCode, true)
    assert.equal((await h.accounts.get()).accounts.length, 1)
    const command = h.commands.find((command) => command.args[1] === 'login')
    assert.equal(command.options.env.BROWSER, 'true')
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
    assert.equal(
      (await h.accounts.getWithDisplayNames()).accounts.find((account) => account.active)
        .displayName,
      'Work Name'
    )
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

for (const named of [false, true]) {
  test(`reauthentication refreshes ${named ? 'a named account' : 'Default'} without creating an account`, async () => {
    const h = await setup()
    try {
      if (named) {
        const { accountId } = await h.accounts.create()
        await h.accounts.complete(accountId)
      }
      const before = JSON.stringify(await h.accounts.get())
      const { accountId, login } = await h.accounts.reauthenticate()
      assert.equal(accountId === 'default', !named)
      assert.equal(login.status, 'pending')
      assert.equal(JSON.stringify(await h.accounts.get()), before)
      await assert.rejects(h.accounts.complete(accountId), /not been verified/)
      const waiting = h.accounts.waitForLogin(accountId, login.loginId)
      await h.accounts.submitCode(login.loginId, 'fixture-code')
      await waiting
      const configuration = await h.accounts.complete(accountId)
      assert.equal(JSON.stringify(configuration), before)
      const command = h.commands.find((command) => command.args[1] === 'login')
      assert.equal(Boolean(command.options.env.CLAUDE_SECURESTORAGE_CONFIG_DIR), named)
      if (named) assert.ok(command.options.env.CLAUDE_SECURESTORAGE_CONFIG_DIR.endsWith(accountId))
    } finally {
      await h.cleanup()
    }
  })

  test(`canceling ${named ? 'named' : 'Default'} reauthentication preserves the account and credentials`, async () => {
    const h = await setup()
    try {
      if (named) {
        const { accountId } = await h.accounts.create()
        await h.accounts.complete(accountId)
      }
      const before = JSON.stringify(await h.accounts.get())
      const { accountId, login } = await h.accounts.reauthenticate()
      const waiting = assert.rejects(h.accounts.waitForLogin(accountId, login.loginId), /canceled/)
      await h.accounts.cancel(accountId)
      await waiting
      await h.accounts.cancel(accountId)
      assert.equal(JSON.stringify(await h.accounts.get()), before)
      await assert.rejects(h.accounts.waitForLogin(accountId, login.loginId), /not found/)
    } finally {
      await h.cleanup()
    }
  })
}

test('fallback caching never carries usage from Default to the added account', async () => {
  const h = await setup()
  try {
    const defaults = await Promise.all([
      h.accounts.getUsageFallback(),
      h.accounts.getUsageFallback()
    ])
    assert.equal(defaults[0].seven_day.utilization, 19)
    assert.equal(h.fixture.usageCalls.length, 1)
    const { accountId } = await h.accounts.create()
    await h.accounts.complete(accountId)
    assert.equal((await h.accounts.getUsageFallback()).seven_day.utilization, 7)
    await h.accounts.select('default')
    assert.equal((await h.accounts.getUsageFallback()).seven_day.utilization, 19)
    assert.equal(h.fixture.usageCalls.length, 2)
  } finally {
    await h.cleanup()
  }
})

test('a rate-limited usage refresh keeps the last limits and waits before retrying', async () => {
  const h = await setup()
  const realNow = Date.now
  let now = realNow()
  Date.now = () => now
  try {
    assert.equal((await h.accounts.getUsageFallback()).seven_day.utilization, 19)
    const working = h.fixture.usage
    h.fixture.usage = async (token) => {
      h.fixture.usageCalls.push(token)
      throw Object.assign(new Error('Claude usage request failed (HTTP 429). Please try again.'), {
        retryAfterMs: 300_000
      })
    }
    now += 61_000
    assert.equal((await h.accounts.getUsageFallback()).seven_day.utilization, 19)
    assert.equal(h.fixture.usageCalls.length, 2)
    // Retry-After is respected: no new request until it passes.
    now += 120_000
    await h.accounts.getUsageFallback()
    assert.equal(h.fixture.usageCalls.length, 2)
    h.fixture.usage = working
    now += 181_000
    assert.equal((await h.accounts.getUsageFallback()).seven_day.utilization, 19)
    assert.equal(h.fixture.usageCalls.length, 3)
  } finally {
    Date.now = realNow
    await h.cleanup()
  }
})

test('saved limits and retry time survive a restart', async () => {
  const h = await setup()
  const second = h.restart()
  try {
    const file = join(h.root, 'claude-usage-cache.json')
    h.accounts.setUsageCacheFile(file)
    second.setUsageCacheFile(file)
    assert.equal((await h.accounts.getUsageFallback()).seven_day.utilization, 19)
    h.fixture.usage = async (token) => {
      h.fixture.usageCalls.push(token)
      throw Object.assign(new Error('Claude usage request failed (HTTP 429). Please try again.'), {
        retryAfterMs: 600_000
      })
    }
    const realNow = Date.now
    const start = realNow()
    Date.now = () => start + 61_000
    try {
      assert.equal((await h.accounts.getUsageFallback()).seven_day.utilization, 19)
    } finally {
      Date.now = realNow
    }
    // Let the cache write finish, then "restart": no request until Retry-After passes.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const calls = h.fixture.usageCalls.length
    assert.equal((await second.getUsageFallback()).seven_day.utilization, 19)
    assert.equal((await second.getLastUsage()).seven_day.utilization, 19)
    assert.equal(h.fixture.usageCalls.length, calls)
  } finally {
    second.dispose()
    await h.cleanup()
  }
})

test('a failed first usage request is reported, but not repeated immediately', async () => {
  const h = await setup()
  try {
    h.fixture.usage = async (token) => {
      h.fixture.usageCalls.push(token)
      throw new Error('Claude usage request failed (HTTP 429). Please try again.')
    }
    await assert.rejects(h.accounts.getUsageFallback(), /HTTP 429/)
    await assert.rejects(h.accounts.getUsageFallback(), /HTTP 429/)
    assert.equal(h.fixture.usageCalls.length, 1)
  } finally {
    await h.cleanup()
  }
})

test('a login ID cannot authorize another environment; cancel cannot activate an account', async () => {
  const h = await setup()
  try {
    const remote = { container: { kind: 'container', tool: 'ssh', name: 'server' } }
    const { accountId } = await h.accounts.create()
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
    await assert.rejects(h.accounts.create(), /2\.1\.281/)
    assert.equal(h.supports('2.1.280'), false)
    assert.equal(h.supports('2.1.281'), true)
    assert.equal(h.supports('2.2.0'), true)
    assert.equal(h.supports('unknown'), false)
  } finally {
    await h.cleanup()
  }
})

test('display names read each account credential without activating it', async () => {
  const h = await setup()
  try {
    const { accountId } = await h.accounts.create()
    const login = await h.accounts.login()
    await h.accounts.submitCode(login.loginId, 'fixture-code')
    await h.accounts.complete(accountId)
    const configuration = await h.accounts.getWithDisplayNames()
    assert.equal(
      configuration.accounts.find((account) => account.id === 'default').displayName,
      'Personal Name'
    )
    assert.equal(
      configuration.accounts.find((account) => account.id === accountId).displayName,
      'Work Name'
    )
    assert.equal(configuration.accounts.find((account) => account.active).id, accountId)
    assert.deepEqual(
      h.fixture.profileCalls.sort(),
      ['Bearer fixture-default', `Bearer fixture-${accountId}`].sort()
    )
  } finally {
    await h.cleanup()
  }
})

test('fetches display names for saved accounts that have not been selected', async () => {
  const h = await setup()
  try {
    const id = '00000000-0000-4000-8000-000000000001'
    const storage = await h.fixture.storage()
    await storage.write(
      JSON.stringify({ activeId: 'default', accounts: [{ id, name: 'Saved label' }] })
    )
    const configuration = await h.accounts.getWithDisplayNames()
    assert.equal(
      configuration.accounts.find((account) => account.id === id).displayName,
      'Work Name'
    )
    assert.equal(configuration.accounts.find((account) => account.active).id, 'default')
    assert.equal(
      h.commands.some((command) => command.args[0] === 'auth'),
      false
    )
  } finally {
    await h.cleanup()
  }
})
