import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Extract actual API methods with fake account storage. No real login or credential file is touched.
const source = ts.createSourceFile(
  'providerService.ts',
  readFileSync(new URL('../providerService.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
let api
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'providerApi')
    api = node.initializer
  ts.forEachChild(node, visit)
}
visit(source)
const methods = api.properties.filter((p) =>
  ['reauthenticateAccount', 'completeAccountCreation', 'cancelAccountCreation'].includes(
    p.name?.getText(source)
  )
)
function fixture() {
  const events = []
  const pending = new Map()
  const configuration = { accounts: [{ id: 'existing' }], activeAccountId: 'existing' }
  let sequence = 0
  const adapter = {
    reauthenticate: async () => {
      events.push('login')
      return { status: 'pending', loginId: 'login', authUrl: 'https://example.com' }
    },
    waitForLogin: async () => ({ success: true, error: null }),
    cancelLogin: async () => {
      events.push('cancel')
    },
    clearAuthenticationFailure: () => {
      events.push('clear')
    },
    resetClientsForContainer: () => {
      events.push('reset')
    }
  }
  const context = vm.createContext({
    codexAdapter: adapter,
    persistentChatHistory: { forgetAccount: () => {} },
    codexReauthentications: pending,
    randomUUID: () => String(++sequence),
    getContainerTargetKey: (container) => container?.id ?? 'host',
    getCodexAccounts: async () => configuration,
    removePendingCodexAccount: () => assert.fail('re-login must not remove the existing account'),
    finalizeCodexAccount: () => assert.fail('re-login must not create a second account'),
    console
  })
  vm.runInContext(
    ts.transpile(`globalThis.api={${methods.map((p) => p.getText(source)).join(',')}}`, {
      target: ts.ScriptTarget.ES2022
    }),
    context
  )
  return { api: context.api, events, adapter, configuration, pending, context }
}

test('Codex re-login preserves existing account on success, failure and cancel', async () => {
  for (const outcome of ['success', 'failure', 'cancel']) {
    const h = fixture()
    const login = await h.api.reauthenticateAccount('codex')
    assert.equal(h.configuration.activeAccountId, 'existing')
    await assert.rejects(h.api.reauthenticateAccount('codex'), /already in progress/)
    if (outcome === 'cancel') {
      assert.equal(
        await h.api.cancelAccountCreation('codex', login.accountId, 'login'),
        h.configuration
      )
      assert.deepEqual(h.events, ['login', 'cancel'])
    } else {
      h.adapter.waitForLogin = async () => ({
        success: outcome === 'success',
        error: outcome === 'failure' ? 'Canceled' : null
      })
      const result = await h.api.completeAccountCreation('codex', login.accountId, 'login')
      assert.equal(result.success, outcome === 'success')
      assert.equal(result.configuration, h.configuration)
      assert.deepEqual(h.events, outcome === 'success' ? ['login', 'clear', 'reset'] : ['login'])
    }
    assert.equal(h.pending.size, 0)
  }
})

test('Codex re-login cannot cross environments or publish a canceled late completion', async () => {
  const h = fixture()
  const login = await h.api.reauthenticateAccount('codex')
  await assert.rejects(
    h.api.completeAccountCreation('codex', login.accountId, 'login', {
      container: { id: 'remote' }
    }),
    /no longer pending/
  )
  let finish
  h.adapter.waitForLogin = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const completion = h.api.completeAccountCreation('codex', login.accountId, 'login')
  await h.api.cancelAccountCreation('codex', login.accountId, 'login')
  finish({ success: true, error: null })
  await assert.rejects(completion, /canceled/)
  assert.deepEqual(h.events, ['login', 'cancel'])
})

test('chat reauthentication and cancellation use its pinned runtime rather than the default', async () => {
  const h = fixture()
  const scopedCalls = []
  const scoped = {
    reauthenticate: async () => {
      scopedCalls.push('login')
      return { status: 'pending', loginId: 'scoped' }
    },
    waitForLogin: async () => {
      scopedCalls.push('wait')
      return { success: true, error: null }
    },
    cancelLogin: async () => {
      scopedCalls.push('cancel')
    },
    clearAuthenticationFailure: () => {
      scopedCalls.push('clear')
    }
  }
  h.context.accountRuntimes = {
    codex: {
      account: async (id) => {
        assert.equal(id, 'chat')
        return 'saved'
      }
    }
  }
  h.context.codexAccountAdapter = (account) => {
    assert.equal(account, 'saved')
    return scoped
  }
  const options = { chatId: 'chat' }
  const first = await h.api.reauthenticateAccount('codex', options)
  await h.api.completeAccountCreation('codex', first.accountId, 'scoped', options)
  const next = await h.api.reauthenticateAccount('codex', options)
  await h.api.cancelAccountCreation('codex', next.accountId, 'scoped', options)
  assert.deepEqual(scopedCalls, ['login', 'wait', 'clear', 'login', 'cancel'])
  assert.deepEqual(h.events, ['reset'])
})
