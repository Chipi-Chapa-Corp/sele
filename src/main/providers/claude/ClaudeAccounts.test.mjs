import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'
import { ClaudeAccountStore, getClaudeAccountEnvironment } from './ClaudeAccountStore.ts'
import { ClaudeAccountLogin, findClaudeAuthorizationUrl } from './ClaudeAccountLogin.ts'
import { fetchClaudeRateLimits } from './ClaudeUsage.ts'

const fixture = (initial = null) => {
  let saved = initial
  const directories = new Set()
  const removed = []
  const storage = {
    read: async () => saved,
    write: async (value) => {
      saved = value
    },
    createCredentials: async (id) => {
      directories.add(id)
    },
    removeCredentials: async (id) => {
      directories.delete(id)
      removed.push(id)
    },
    credentialDirectory: (id) => `/shared/sele/accounts/${id}`
  }
  return {
    store: new ClaudeAccountStore(storage),
    storage,
    directories,
    removed,
    saved: () => JSON.parse(saved)
  }
}

test('adding an account preserves selection until login completes; switching persists only metadata', async () => {
  const h = fixture()
  const a = await h.store.create('Work')
  assert.equal((await h.store.get()).accounts[0].active, true)
  assert.equal(await h.store.getSelection(), null)
  await h.store.complete(a.accountId)
  const b = await h.store.create('Personal')
  assert.equal((await h.store.getSelection()).id, a.accountId)
  await h.store.complete(b.accountId)
  await h.store.select(a.accountId)
  assert.equal((await new ClaudeAccountStore(h.storage).getSelection()).id, a.accountId)
  assert.deepEqual(Object.keys(h.saved()).sort(), ['accounts', 'activeId'])
  await h.store.select('default')
  assert.equal(await h.store.getSelection(), null)
  assert.equal(h.directories.size, 2)
})

test('usage fallback reads only the selected credentials, including Default and inherited OAuth', async () => {
  const h = fixture()
  const reads = []
  h.storage.readCredentials = async (id) => {
    reads.push(id)
    return JSON.stringify({ claudeAiOauth: { accessToken: `token-for-${id}` } })
  }
  assert.equal(await h.store.getUsageAccessToken({}), 'token-for-default')
  assert.equal(
    await h.store.getUsageAccessToken({ CLAUDE_CODE_OAUTH_TOKEN: 'inherited' }),
    'inherited'
  )
  const { accountId } = await h.store.create('Work')
  await h.store.complete(accountId)
  assert.equal(
    await h.store.getUsageAccessToken({ CLAUDE_CODE_OAUTH_TOKEN: 'inherited' }),
    `token-for-${accountId}`
  )
  await h.store.select('default')
  assert.equal(await h.store.getUsageAccessToken({}), 'token-for-default')
  assert.deepEqual(reads, ['default', accountId, 'default'])
  h.storage.readCredentials = async () => '{sensitive-fragment'
  await assert.rejects(
    h.store.getUsageAccessToken({}),
    (error) => error.message === 'Unable to read Claude subscription credentials.'
  )
})

test('usage fallback reads the authenticated endpoint and does not hide unavailable limits', async () => {
  const limits = {
    five_hour: { utilization: 55, resets_at: null },
    seven_day: { utilization: 19, resets_at: null }
  }
  const actual = await fetchClaudeRateLimits('fixture-token', '2.1.281', async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/api/oauth/usage')
    assert.equal(options.headers.Authorization, 'Bearer fixture-token')
    assert.equal(options.headers['User-Agent'], 'claude-code/2.1.281')
    assert.equal(options.redirect, 'error')
    return Response.json(limits)
  })
  assert.deepEqual(actual, limits)
  await assert.rejects(
    fetchClaudeRateLimits('fixture-token', '2.1.281', async () =>
      Response.json({ error: 'sensitive body' }, { status: 429 })
    ),
    /HTTP 429/
  )
  await assert.rejects(
    fetchClaudeRateLimits('fixture-token', '2.1.281', async () =>
      Response.json({ error: 'sensitive body' })
    ),
    /did not return usage limits/
  )
  await assert.rejects(
    fetchClaudeRateLimits('fixture-token', '2.1.281', async () => {
      throw new Error('sensitive transport details')
    }),
    (error) => error.message === 'Unable to reach Claude usage. Please try again.'
  )
})

test('cancel and crash recovery remove only the pending credential store', async () => {
  const h = fixture()
  const a = await h.store.create('Work')
  await h.store.complete(a.accountId)
  const pending = await h.store.create('Canceled')
  await h.store.cancel(pending.accountId)
  assert.equal((await h.store.getSelection()).id, a.accountId)
  await assert.rejects(h.store.complete(pending.accountId), /canceled/)
  const interrupted = await h.store.create('Interrupted')
  const restored = new ClaudeAccountStore(h.storage)
  assert.equal((await restored.getSelection()).id, a.accountId)
  assert.equal(await restored.getPending(), null)
  assert.deepEqual(h.removed, [pending.accountId, interrupted.accountId])
  assert.deepEqual([...h.directories], [a.accountId])
})

test('deleting an inactive account keeps the selection; deleting active returns to Default', async () => {
  const h = fixture()
  const a = await h.store.create('A')
  await h.store.complete(a.accountId)
  const b = await h.store.create('B')
  await h.store.complete(b.accountId)
  await h.store.remove(a.accountId)
  assert.equal((await h.store.getSelection()).id, b.accountId)
  await h.store.remove(b.accountId)
  assert.equal(await h.store.getSelection(), null)
  await assert.rejects(h.store.remove('default'), /Invalid/)
})

test('invalid names, path traversal, duplicate names, and concurrent login creation are rejected', async () => {
  const h = fixture()
  await assert.rejects(h.store.create(' \n '))
  await assert.rejects(h.store.create('bad\nname'))
  const results = await Promise.allSettled([h.store.create('A'), h.store.create('B')])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  const id = (await h.store.getPending()).id
  await h.store.complete(id)
  await assert.rejects(h.store.create('a'), /already exists/)
  await assert.rejects(h.store.select('../default'), /not found/)
  await assert.rejects(h.store.cancel('../../projects'), /Invalid/)
  assert.equal(h.removed.length, 0)
})

test('a failed registry write does not change the active account in memory', async () => {
  const h = fixture()
  const a = await h.store.create('A')
  await h.store.complete(a.accountId)
  h.storage.write = async () => {
    throw new Error('disk full')
  }
  await assert.rejects(h.store.select('default'), /disk full/)
  assert.equal((await h.store.getSelection()).id, a.accountId)
})

test('managed accounts retain shared config and Default retains the original environment', () => {
  const original = {
    CLAUDE_CONFIG_DIR: '/shared',
    CLAUDE_SECURESTORAGE_CONFIG_DIR: '/external-default',
    ANTHROPIC_API_KEY: 'inherited-key',
    CLAUDE_CODE_OAUTH_TOKEN: 'inherited-token',
    PATH: '/bin'
  }
  const selected = getClaudeAccountEnvironment(original, '/credentials/work')
  assert.equal(selected.CLAUDE_CONFIG_DIR, '/shared')
  assert.equal(selected.CLAUDE_SECURESTORAGE_CONFIG_DIR, '/credentials/work')
  assert.equal(selected.ANTHROPIC_API_KEY, '')
  assert.equal(selected.CLAUDE_CODE_OAUTH_TOKEN, '')
  assert.strictEqual(getClaudeAccountEnvironment(original, null), original)
  assert.equal(original.ANTHROPIC_API_KEY, 'inherited-key')
})

test('both credential selections list and read the same shared transcript through the real SDK', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sele-claude-history-'))
  try {
    const shared = join(root, 'shared')
    const projects = join(shared, 'projects', '-shared-project')
    await mkdir(projects, { recursive: true })
    const id = '11111111-1111-4111-8111-111111111111'
    const transcript =
      JSON.stringify({
        type: 'user',
        uuid: '22222222-2222-4222-8222-222222222222',
        parentUuid: null,
        sessionId: id,
        cwd: '/shared-project',
        isSidechain: false,
        timestamp: '2026-09-24T10:00:00Z',
        message: { role: 'user', content: 'Shared chat' }
      }) + '\n'
    const file = join(projects, `${id}.jsonl`)
    await writeFile(file, transcript)
    const sdk = new URL(
      '../../../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs',
      import.meta.url
    ).href
    const script = `import {listSessions,getSessionMessages} from ${JSON.stringify(sdk)};
      console.log(JSON.stringify({sessions:(await listSessions()).map(s=>s.sessionId),
        messages:await getSessionMessages(${JSON.stringify(id)})}));`
    const outputs = []
    for (const name of ['work', 'personal']) {
      const env = getClaudeAccountEnvironment(
        { ...process.env, CLAUDE_CONFIG_DIR: shared },
        join(root, name)
      )
      const result = await promisify(execFile)(
        process.execPath,
        ['--input-type=module', '-e', script],
        { env }
      )
      outputs.push(JSON.parse(result.stdout))
    }
    assert.deepEqual(outputs[0], outputs[1])
    assert.deepEqual(outputs[0].sessions, [id])
    assert.equal(outputs[0].messages.length, 1)
    assert.equal(await readFile(file, 'utf8'), transcript)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

const authUrl =
  'https://claude.com/cai/oauth/authorize?code=true&client_id=fixture&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A46603%2Fcallback&scope=user%3Ainference&code_challenge=fixture&code_challenge_method=S256&state=fixture'
const loginProcess = (script, timeout) =>
  new ClaudeAccountLogin(
    {
      file: process.execPath,
      args: ['-e', script],
      env: process.env
    },
    timeout
  )

test('authorization URLs require a complete, allowlisted OAuth URL', () => {
  assert.equal(findClaudeAuthorizationUrl(authUrl), null)
  assert.equal(findClaudeAuthorizationUrl(`${authUrl}\n`), authUrl)
  assert.equal(
    findClaudeAuthorizationUrl(`\u001b]8;;${authUrl}\u0007link\u001b]8;;\u0007`),
    authUrl
  )
  assert.equal(
    findClaudeAuthorizationUrl(
      'https://attacker.test/oauth/authorize?response_type=code&state=x\n'
    ),
    null
  )
  for (const endpoint of [
    'https://claude.ai/oauth/authorize',
    'https://console.anthropic.com/oauth/authorize',
    'https://platform.claude.com/oauth/authorize'
  ]) {
    const legacy = `${endpoint}?response_type=code&state=fixture`
    assert.equal(findClaudeAuthorizationUrl(`${legacy}\n`), legacy)
  }
  for (const endpoint of [
    'https://claude.com.attacker.test/cai/oauth/authorize',
    'https://claude.com/unrelated',
    'https://user:password@claude.com/cai/oauth/authorize',
    'https://claude.com:8443/cai/oauth/authorize'
  ]) {
    assert.equal(findClaudeAuthorizationUrl(`${endpoint}?response_type=code&state=fixture\n`), null)
  }
})

test('recognizes the current CLI sign-in output before the login process exits', async () => {
  // Output shape captured from Claude Code 2.1.281; OAuth values are synthetic.
  const output = `Opening browser to sign in…\nIf the browser didn't open, visit: ${authUrl}\nPaste code here if prompted > `
  const login = loginProcess(
    `process.stdout.write(${JSON.stringify(output)});
    process.stdin.once('data', () => process.exit(0));`,
    2_000
  )
  try {
    assert.equal(await login.ready, authUrl)
    login.submitCode('fixture-code')
    assert.equal((await login.completion).success, true)
  } finally {
    await login.cancel()
  }
})

test('CLI login handles chunked URLs, code submission, and successful exit', async () => {
  const script = `const u=${JSON.stringify(authUrl)}; process.stdout.write(u.slice(0,25));
    setTimeout(()=>process.stdout.write(u.slice(25)+'\\n'),10);
    process.stdin.once('data',code=>process.exit(code.toString().trim()==='code#state'?0:1));`
  const login = loginProcess(script)
  try {
    assert.equal(await login.ready, authUrl)
    login.submitCode('code#state')
    assert.deepEqual(await login.completion, { success: true, error: null })
  } finally {
    await login.cancel()
  }
})

test('cancel waits for the CLI to stop and cannot complete account creation', async () => {
  const login = loginProcess(`console.log(${JSON.stringify(authUrl)}); setInterval(()=>{},1000)`)
  await login.ready
  await login.cancel()
  assert.equal((await login.completion).success, false)
  assert.throws(() => login.submitCode('late-code'), /no longer pending/)
})

test('CLI errors and timeout do not expose captured output', async () => {
  const failed = loginProcess("console.error('secret-token-value'); process.exit(1)")
  await assert.rejects(failed.ready, (error) => !error.message.includes('secret-token-value'))
  assert.equal((await failed.completion).success, false)
  const timeout = loginProcess('setInterval(()=>{},1000)', 100)
  await assert.rejects(timeout.ready, /timed out/)
  assert.equal((await timeout.completion).success, false)
})
