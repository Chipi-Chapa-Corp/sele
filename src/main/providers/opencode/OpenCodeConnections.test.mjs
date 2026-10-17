import assert from 'node:assert/strict'
import test from 'node:test'
import {
  listOpenCodeConnections,
  connectOpenCode,
  getOpenCodeConnectionAttempt,
  completeOpenCodeConnection,
  cancelOpenCodeConnection,
  deleteOpenCodeConnection
} from './OpenCodeConnections.ts'
import { isConnectionPromptVisible } from '../../../shared/providerConnections.ts'

const fixture = () => {
  const calls = []
  const run = (name, data) => async (input, options) => {
    calls.push({ name, input, options })
    return { data }
  }
  const client = {
    instance: { dispose: run('refresh', true) },
    auth: { set: run('key', true), remove: run('remove', true) },
    provider: {
      list: run('list', {
        all: [
          {
            id: 'openai',
            name: 'OpenAI',
            source: 'env',
            env: ['OPENAI_API_KEY'],
            key: 'secret-value'
          },
          { id: 'anthropic', name: 'Anthropic', source: 'api', env: [] }
        ],
        connected: ['openai', 'anthropic']
      }),
      auth: run('methods', { anthropic: [{ type: 'oauth', label: 'Browser sign-in' }] }),
      oauth: {
        authorize: run('oauth', {
          url: 'https://example.test/authorize',
          instructions: 'Authorize',
          method: 'code'
        }),
        callback: run('complete', true)
      }
    }
  }
  return {
    client,
    calls,
    readCredentials: async () => ({ openai: 'api', anthropic: 'oauth', disabled: 'api' })
  }
}

test('catalog includes saved, disabled, unknown and environment connections without returning secrets', async () => {
  const { client, readCredentials } = fixture()
  const list = await listOpenCodeConnections(client, readCredentials)
  assert.deepEqual(
    list.map((entry) => entry.id),
    ['anthropic', 'disabled', 'openai']
  )
  assert.deepEqual(list[2].connections, [
    { type: 'credential', id: 'openai', label: 'API key' },
    { type: 'env', name: 'OPENAI_API_KEY' }
  ])
  assert.deepEqual(list[0].methods, [
    { type: 'oauth', id: '0', label: 'Browser sign-in', prompts: undefined }
  ])
  assert.ok(!JSON.stringify(list).includes('secret-value'))
})

test('keys and removal use the same credential store as OpenCode /connect', async () => {
  const { client, calls } = fixture()
  assert.equal(
    await connectOpenCode(client, { integrationId: 'openai', method: 'key', key: 'test-key' }),
    null
  )
  assert.deepEqual(
    calls.find((call) => call.name === 'key'),
    {
      name: 'key',
      input: { providerID: 'openai', auth: { type: 'api', key: 'test-key' } },
      options: { throwOnError: true }
    }
  )
  await deleteOpenCodeConnection(client, 'openai')
  assert.deepEqual(
    calls.find((call) => call.name === 'remove'),
    {
      name: 'remove',
      input: { providerID: 'openai' },
      options: { throwOnError: true }
    }
  )
})

test('API provider form fields are stored as credential metadata', async () => {
  const { client, calls } = fixture()
  await connectOpenCode(client, {
    integrationId: 'openai',
    method: 'key',
    key: 'fixture-key',
    inputs: { resourceName: 'fixture-resource' }
  })
  assert.deepEqual(calls.find((call) => call.name === 'key').input.auth.metadata, {
    resourceName: 'fixture-resource'
  })
})

test('OAuth submits provider prompts and codes, and cancels pending attempts', async () => {
  const { client, calls } = fixture()
  const attempt = await connectOpenCode(client, {
    integrationId: 'anthropic',
    method: 'oauth',
    methodId: '0',
    inputs: { domain: 'example.test' }
  })
  assert.deepEqual(calls.at(-1).input, {
    providerID: 'anthropic',
    method: 0,
    inputs: { domain: 'example.test' }
  })
  assert.equal(attempt.mode, 'code')
  assert.deepEqual(await getOpenCodeConnectionAttempt(client, attempt.attemptId), {
    status: 'pending'
  })
  await completeOpenCodeConnection(client, attempt.attemptId, 'auth-code')
  assert.deepEqual(calls.find((call) => call.name === 'complete').input, {
    providerID: 'anthropic',
    method: 0,
    code: 'auth-code'
  })
  assert.deepEqual(await getOpenCodeConnectionAttempt(client, attempt.attemptId), {
    status: 'complete'
  })
  assert.deepEqual(await getOpenCodeConnectionAttempt(client, attempt.attemptId), {
    status: 'complete'
  })
  const pending = await connectOpenCode(client, {
    integrationId: 'anthropic',
    method: 'oauth',
    methodId: '0'
  })
  await cancelOpenCodeConnection(client, pending.attemptId)
  assert.deepEqual(await getOpenCodeConnectionAttempt(client, pending.attemptId), {
    status: 'expired'
  })
})

test('automatic OAuth completion is polled without exposing credentials', async () => {
  const { client } = fixture()
  client.provider.oauth.authorize = async () => ({
    data: { url: 'https://example.test', instructions: 'Authorize', method: 'auto' }
  })
  const attempt = await connectOpenCode(client, {
    integrationId: 'anthropic',
    method: 'oauth',
    methodId: '0'
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(await getOpenCodeConnectionAttempt(client, attempt.attemptId), {
    status: 'complete'
  })
})

test('failed SDK requests cannot leak submitted keys or codes', async () => {
  const { client } = fixture()
  const secret = 'do-not-log-this-key'
  client.auth.set = async () => {
    throw new Error(secret)
  }
  await assert.rejects(
    connectOpenCode(client, { integrationId: 'openai', method: 'key', key: secret }),
    (error) => !error.message.includes(secret) && error.message.includes('save the API key')
  )
})

test('conditional provider prompts support eq and neq', () => {
  const prompt = {
    type: 'text',
    key: 'domain',
    message: 'Domain',
    when: { key: 'enterprise', op: 'eq', value: 'yes' }
  }
  assert.equal(isConnectionPromptVisible(prompt, { enterprise: 'yes' }), true)
  assert.equal(isConnectionPromptVisible(prompt, { enterprise: 'no' }), false)
  assert.equal(
    isConnectionPromptVisible(
      { ...prompt, when: { ...prompt.when, op: 'neq' } },
      { enterprise: 'no' }
    ),
    true
  )
})

test('installed OpenCode stores, lists and deletes fixture credentials in isolated data directories', {
  skip: !process.env.SELE_OPENCODE_CONNECTIONS_RUNTIME,
  timeout: 30_000
}, async () => {
  const { mkdtemp, mkdir, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { spawn } = await import('node:child_process')
  const { pathToFileURL } = await import('node:url')
  const { createOpencodeClient } = await import('@opencode-ai/sdk/v2')
  const directory = await mkdtemp(join(tmpdir(), 'sele-connections-runtime-'))
  let child
  try {
    const env = { ...process.env }
    for (const name of ['CONFIG', 'CACHE', 'DATA', 'STATE'])
      env[`XDG_${name}_HOME`] = join(directory, name.toLowerCase())
    delete env.OPENCODE_CONFIG
    env.OPENCODE_CONFIG_DIR = join(directory, 'config')
    env.OPENCODE_DISABLE_MODELS_FETCH = 'true'
    env.OPENCODE_MODELS_PATH = join(directory, 'models.json')
    delete env.SELE_FIXTURE_API_KEY
    await writeFile(
      env.OPENCODE_MODELS_PATH,
      JSON.stringify({
        fixture: {
          id: 'fixture',
          name: 'Connection fixture',
          env: ['SELE_FIXTURE_API_KEY'],
          models: {}
        }
      })
    )
    env.OPENCODE_DISABLE_DEFAULT_PLUGINS = 'true'
    env.OPENCODE_SERVER_PASSWORD = 'fixture-password'
    env.OPENCODE_SERVER_USERNAME = 'opencode'
    const pluginPath = join(directory, 'auth-plugin.mjs')
    await writeFile(
      pluginPath,
      `export default async () => ({auth:{provider:'fixture',methods:[
      {type:'oauth',label:'Fixture code sign-in',authorize:async()=>({url:'https://example.test/auth',method:'code',instructions:'Enter fixture code',callback:async(code)=>code==='fixture-code'?{type:'success',key:'fixture-oauth-key'}:{type:'failed'}})},
      {type:'oauth',label:'Fixture automatic sign-in',authorize:async()=>({url:'https://example.test/auth',method:'auto',instructions:'Authorize',callback:async()=>({type:'success',key:'fixture-auto-key'})})}
    ]}})`
    )
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      plugin: [pathToFileURL(pluginPath).href],
      enabled_providers: ['fixture'],
      provider: {
        fixture: {
          name: 'Connection fixture',
          npm: '@ai-sdk/openai-compatible',
          options: { baseURL: 'http://127.0.0.1:1/v1' },
          models: { fixture: { name: 'Fixture' } }
        }
      }
    })
    await mkdir(join(directory, 'project'))
    child = spawn(
      process.env.SELE_OPENCODE_CONNECTIONS_RUNTIME,
      ['serve', '--hostname', '127.0.0.1', '--port', '0'],
      { env, cwd: join(directory, 'project'), stdio: ['ignore', 'pipe', 'pipe'] }
    )
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('OpenCode fixture startup timed out')),
        15_000
      )
      let output = ''
      const read = (chunk) => {
        output = (output + chunk.toString()).slice(-4000)
        const match = /opencode server listening on (https?:\/\/[^\s]+)/.exec(output)
        if (match) {
          clearTimeout(timer)
          resolve(match[1])
        }
      }
      child.stdout.on('data', read)
      child.stderr.on('data', read)
      child.once('error', () => {
        clearTimeout(timer)
        reject(new Error('Unable to start OpenCode fixture'))
      })
      child.once('exit', () => {
        clearTimeout(timer)
        reject(new Error('OpenCode fixture exited'))
      })
    })
    const client = createOpencodeClient({
      baseUrl: url,
      headers: {
        authorization: `Basic ${Buffer.from('opencode:fixture-password').toString('base64')}`
      },
      throwOnError: true
    })
    const readCredentials = async () => {
      try {
        return Object.fromEntries(
          Object.entries(
            JSON.parse(
              await (await import('node:fs/promises')).readFile(
                join(directory, 'data', 'opencode', 'auth.json'),
                'utf8'
              )
            )
          ).map(([id, value]) => [id, value.type])
        )
      } catch (error) {
        if (error.code === 'ENOENT') return {}
        throw error
      }
    }
    await listOpenCodeConnections(client, readCredentials)
    await connectOpenCode(client, {
      integrationId: 'fixture',
      method: 'key',
      key: 'fixture-only-key'
    })
    const connected = (await listOpenCodeConnections(client, readCredentials)).find(
      (entry) => entry.id === 'fixture'
    )
    const active = (await client.config.providers({}, { throwOnError: true })).data.providers.find(
      (entry) => entry.id === 'fixture'
    )
    assert.equal(
      active?.key,
      'fixture-only-key',
      'new credentials must be available to model requests immediately'
    )
    const saved = connected.connections.filter((entry) => entry.type === 'credential')
    assert.equal(saved.length, 1)
    assert.equal(JSON.stringify(connected).includes('fixture-only-key'), false)
    await deleteOpenCodeConnection(client, saved[0].id)
    const disconnected = (await listOpenCodeConnections(client, readCredentials)).find(
      (entry) => entry.id === 'fixture'
    )
    assert.equal(disconnected.connections.filter((entry) => entry.type === 'credential').length, 0)
    const removed = (await client.config.providers({}, { throwOnError: true })).data.providers.find(
      (entry) => entry.id === 'fixture'
    )
    assert.notEqual(
      removed?.key,
      'fixture-only-key',
      'removed keys must stop being used immediately'
    )
    assert.equal(disconnected.methods[0].type, 'oauth')
    const codeAttempt = await connectOpenCode(client, {
      integrationId: 'fixture',
      method: 'oauth',
      methodId: '0'
    })
    await completeOpenCodeConnection(client, codeAttempt.attemptId, 'fixture-code')
    assert.equal(
      (await client.config.providers({}, { throwOnError: true })).data.providers.find(
        (entry) => entry.id === 'fixture'
      )?.key,
      'fixture-oauth-key'
    )
    const autoAttempt = await connectOpenCode(client, {
      integrationId: 'fixture',
      method: 'oauth',
      methodId: '1'
    })
    let status
    for (let count = 0; count < 30; count++) {
      status = await getOpenCodeConnectionAttempt(client, autoAttempt.attemptId)
      if (status.status !== 'pending') break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(status.status, 'complete')
    assert.equal(
      (await client.config.providers({}, { throwOnError: true })).data.providers.find(
        (entry) => entry.id === 'fixture'
      )?.key,
      'fixture-auto-key'
    )
  } finally {
    if (child && child.exitCode === null) {
      const stopped = new Promise((resolve) => child.once('exit', resolve))
      child.kill()
      await stopped
    }
    await rm(directory, { recursive: true, force: true })
  }
})
