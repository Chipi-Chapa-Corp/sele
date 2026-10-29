// Builds long native transcripts with each provider's own CLI, so Sele later loads exactly
// what a real user's history looks like on disk: many turns, many tool calls, nested subagents.
const path = require('node:path')
const { spawn } = require('node:child_process')

function run(command, args, { env, cwd, timeout = 180000, input = null }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      cwd,
      stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe']
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    if (input !== null) child.stdin.end(input)
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(output)
      else
        reject(
          new Error(
            `${path.basename(command)} ${args.slice(0, 3).join(' ')} exited ${code}:\n${output.slice(-2000)}`
          )
        )
    })
  })
}

/** Prompt for turn `index`: alternating many tools, nested subagents and long answers. */
function turnPrompt(marker, index) {
  const kind = index % 4
  if (kind === 0) return `${marker} turn ${index} #work 12`
  if (kind === 1) return `${marker} turn ${index} #agent 6`
  if (kind === 2) return `${marker} turn ${index} #work 3 #text 8`
  return `${marker} turn ${index} #text 3`
}

/**
 * Minimal Codex app-server JSON-RPC client. `codex exec` threads are hidden from interactive
 * listings by design, so long Codex chats are recorded through the app-server like Sele does.
 */
function codexAppServer(executable, { env, cwd }) {
  const child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
    env,
    cwd,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let buffer = ''
  let nextId = 1
  const pending = new Map()
  const listeners = new Set()
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (!line.trim()) continue
      const message = JSON.parse(line)
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id)
        pending.delete(message.id)
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
      } else if (message.id !== undefined && message.method) {
        // Approvals are off in the test config; answer anything else neutrally.
        child.stdin.write(JSON.stringify({ id: message.id, result: { decision: 'accept' } }) + '\n')
      } else if (message.method) for (const listener of listeners) listener(message)
    }
  })
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    })
  return {
    request,
    notify: (method, params) =>
      child.stdin.write(JSON.stringify({ method, ...(params ? { params } : {}) }) + '\n'),
    /** Resolve when a notification matching `predicate` arrives. */
    next: (predicate, timeout = 120000) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Codex app-server notification timed out')),
          timeout
        )
        const listener = (message) => {
          if (!predicate(message)) return
          clearTimeout(timer)
          listeners.delete(listener)
          resolve(message)
        }
        listeners.add(listener)
      }),
    /** Close stdin and wait, so Codex releases the thread's write lease before Sele opens it. */
    close: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve()
        const timer = setTimeout(() => child.kill('SIGKILL'), 10000)
        child.once('exit', () => (clearTimeout(timer), resolve()))
        child.stdin.end()
      })
  }
}

const providerRuns = {
  async codex({ env, cwd, executable, marker, turns }) {
    const server = codexAppServer(executable, { env, cwd })
    try {
      await server.request('initialize', {
        clientInfo: { name: 'sele-e2e', title: 'Sele e2e', version: '1.0.0' },
        capabilities: { experimentalApi: true }
      })
      server.notify('initialized')
      const { thread } = await server.request('thread/start', {
        cwd,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access'
      })
      for (let index = 0; index < turns; index++) {
        const completed = server.next(
          (message) => message.method === 'turn/completed' && message.params?.threadId === thread.id
        )
        await server.request('turn/start', {
          threadId: thread.id,
          input: [{ type: 'text', text: turnPrompt(marker, index), text_elements: [] }]
        })
        await completed
      }
      return thread.id
    } finally {
      await server.close()
    }
  },
  async claude({ env, cwd, executable, marker, turns }) {
    let session = null
    for (let index = 0; index < turns; index++) {
      const args = [
        '-p',
        '--dangerously-skip-permissions',
        '--output-format',
        'json',
        '--model',
        'claude-sonnet-4-5'
      ]
      if (session) args.push('--resume', session)
      args.push(turnPrompt(marker, index))
      const output = await run(executable, args, { env, cwd })
      session ??= JSON.parse(output.slice(output.indexOf('{'))).session_id
    }
    return session
  },
  async copilot({ env, cwd, executable, marker, turns }) {
    const session = require('node:crypto').randomUUID()
    for (let index = 0; index < turns; index++)
      await run(
        executable,
        ['-p', turnPrompt(marker, index), '--allow-all-tools', `--session-id=${session}`],
        { env, cwd }
      )
    return session
  },
  async opencode({ env, cwd, executable, marker, turns }) {
    let session = null
    for (let index = 0; index < turns; index++) {
      const args = ['run', '--format', 'json']
      if (session) args.push('--session', session)
      args.push(turnPrompt(marker, index))
      const output = await run(executable, args, { env, cwd })
      session ??= /"sessionID"\s*:\s*"([^"]+)"/.exec(output)?.[1]
      if (!session)
        throw new Error('OpenCode did not report a session id:\n' + output.slice(0, 2000))
    }
    return session
  },
  async 'opencode-v2'({ env, cwd, executable, marker, turns }) {
    let session = null
    for (let index = 0; index < turns; index++) {
      const args = ['run', '--standalone', '--auto', '--format', 'json']
      if (session) args.push('--session', session)
      args.push(turnPrompt(marker, index))
      const output = await run(executable, args, { env, cwd })
      session ??= /"sessionID"\s*:\s*"([^"]+)"/.exec(output)?.[1]
      if (!session) throw new Error('OpenCode v2 did not report a session id')
    }
    return session
  }
}

/** Create one long chat per provider. Returns {provider: {session, marker, turns}}. */
async function createLongTranscripts({ env, executables, cwd, providers, turns, log = () => {} }) {
  const created = {}
  const errors = {}
  await Promise.all(
    providers.map(async (provider) => {
      const marker = `long-${provider}`
      const started = Date.now()
      try {
        const session = await providerRuns[provider]({
          env,
          cwd,
          executable: executables[provider],
          marker,
          turns
        })
        created[provider] = { session, marker, turns }
        log(`${provider}: ${turns} turns in ${Math.round((Date.now() - started) / 1000)}s`)
      } catch (error) {
        errors[provider] = error
      }
    })
  )
  return { created, errors }
}

module.exports = { createLongTranscripts, turnPrompt }
