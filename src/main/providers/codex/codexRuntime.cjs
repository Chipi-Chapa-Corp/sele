// Own the stdio connection independently of Electron. No Electron imports or UI state.
const net = require('node:net')
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const { createInterface } = require('node:readline')

function startRuntime(config) {
  let client = null
  let child = null
  let initialized = null
  let initializing = false
  const initializeWaiters = []
  let nextId = 1
  let idleTimer = null
  let stopping = false
  let stderr = ''
  const recordStartupError = (message) => {
    if (!initialized && config.startupErrorPath)
      fs.writeFileSync(config.startupErrorPath, message, { mode: 0o600 })
  }
  const requests = new Map()
  const approvals = new Map()
  const threads = new Map()
  const temporaryThreads = new Map()
  const active = new Set()
  const backgroundTerminals = new Map()
  const completedTurns = new Set()
  const send = (socket, message) => {
    if (socket && !socket.destroyed) {
      // A single transcript can exceed the socket buffer. Keep the connection
      // and slow the provider instead of discarding an in-flight JSON record.
      if (!socket.write(JSON.stringify(message) + '\n')) child?.stdout.pause()
    }
  }
  const write = (message) => {
    if (child?.stdin.writable) child.stdin.write(JSON.stringify(message) + '\n')
  }
  const stop = () => {
    if (stopping) return
    stopping = true
    clearTimeout(idleTimer)
    for (const request of requests.values()) clearTimeout(request.timer)
    client?.destroy()
    child?.kill()
    server.close()
    // The account-view wrapper may take a moment to reap its provider child.
    const timeout = setTimeout(() => process.exit(0), 3000)
    timeout.unref()
  }
  const scheduleIdle = () => {
    clearTimeout(idleTimer)
    if (!client && !active.size && !backgroundTerminals.size && !approvals.size && !requests.size)
      idleTimer = setTimeout(stop, config.idleTimeoutMs ?? 300_000)
  }
  const releaseTemporaryThread = (threadId) => {
    const turnId = temporaryThreads.get(threadId)
    if (turnId) write({ id: nextId++, method: 'turn/interrupt', params: { threadId, turnId } })
    write({ id: nextId++, method: 'thread/unsubscribe', params: { threadId } })
  }
  const disconnect = (socket) => {
    if (client !== socket) return
    client = null
    // Detached turns must keep running even if the frontend stopped reading.
    child?.stdout.resume()
    for (const threadId of temporaryThreads.keys()) releaseTemporaryThread(threadId)
    for (const [requestId, request] of requests) {
      if (request.socket === socket && request.method === 'thread/sample')
        write({ id: nextId++, method: 'thread/sample/cancel', params: { requestId } })
    }
    // Never repeat a client-side action whose result was lost during a crash.
    // Other server requests are approvals/questions, and remain pending for reattachment.
    for (const [id, request] of approvals) {
      if (request.method !== 'item/tool/call' || !request.dispatched) continue
      approvals.delete(id)
      write({
        id,
        result: {
          success: false,
          contentItems: [
            {
              type: 'inputText',
              text: 'Sele disconnected while this client tool was running. Its outcome is unknown. Inspect the current state before deciding whether to retry.'
            }
          ]
        }
      })
    }
    scheduleIdle()
  }
  const observe = (message) => {
    const params = message.params ?? {}
    if (
      ['item/started', 'item/completed'].includes(message.method) &&
      params.item?.type === 'commandExecution' &&
      params.item.processId
    ) {
      const key = `${params.threadId}:${params.item.processId}`
      if (params.item.exitCode != null || ['failed', 'interrupted'].includes(params.item.status))
        backgroundTerminals.delete(key)
      else backgroundTerminals.set(key, params.threadId)
    }
    if (message.method === 'turn/started') {
      active.add(params.threadId)
      if (temporaryThreads.has(params.threadId)) {
        temporaryThreads.set(params.threadId, params.turn?.id)
        if (!client) releaseTemporaryThread(params.threadId)
      }
    }
    if (message.method === 'turn/completed') {
      active.delete(params.threadId)
      completedTurns.add(params.turn?.id)
      if (completedTurns.size > 128) completedTurns.delete(completedTurns.values().next().value)
    }
    if (message.method === 'thread/closed') {
      for (const [key, threadId] of backgroundTerminals)
        if (threadId === params.threadId) backgroundTerminals.delete(key)
      threads.delete(params.threadId)
      temporaryThreads.delete(params.threadId)
      active.delete(params.threadId)
    }
    if (message.method === 'thread/status/changed' && threads.has(params.threadId))
      threads.get(params.threadId).thread.status = params.status
    if (message.method === 'serverRequest/resolved') approvals.delete(params.requestId)
  }
  const server = net.createServer((socket) => {
    let authenticated = false
    let ready = false
    const authTimeout = setTimeout(() => socket.destroy(), 5000)
    socket.on('error', () => socket.destroy())
    socket.on('drain', () => {
      if (client === socket) child?.stdout.resume()
    })
    socket.on('close', () => {
      clearTimeout(authTimeout)
      disconnect(socket)
    })
    const reader = createInterface({ input: socket })
    reader.on('error', () => socket.destroy())
    reader.on('line', (line) => {
      let message
      try {
        message = JSON.parse(line)
      } catch {
        socket.destroy()
        return
      }
      if (!authenticated) {
        clearTimeout(authTimeout)
        if (message.token !== config.token || (client && client !== socket)) {
          socket.destroy()
          return
        }
        authenticated = true
        client = socket
        clearTimeout(idleTimer)
        send(socket, { runtimeReady: true })
        return
      }
      if (message.runtimeStop === true) {
        stop()
        return
      }
      if (message.method === 'initialize' && initialized) {
        send(socket, {
          id: message.id,
          result: { ...initialized, seleRuntime: { threads: [...threads.values()] } }
        })
        return
      }
      if (message.method === 'initialize') {
        if (initializing) {
          initializeWaiters.push({ socket, id: message.id })
          return
        }
        initializing = true
      }
      if (message.method === 'initialized') {
        ready = true
        if (!initialized) write(message)
        for (const request of approvals.values()) {
          request.dispatched = true
          send(socket, { id: request.id, method: request.method, params: request.params })
        }
        return
      }
      if (message.method && typeof message.id === 'number') {
        if (message.method === 'thread/sample/cancel') {
          const target = [...requests].find(
            ([, request]) =>
              request.socket === socket &&
              request.method === 'thread/sample' &&
              request.id === message.params?.requestId
          )
          if (!target) {
            send(socket, { id: message.id, result: {} })
            return
          }
          message = { ...message, params: { ...message.params, requestId: target[0] } }
        }
        const id = nextId++
        const timer = setTimeout(
          () => {
            requests.delete(id)
            if (message.method === 'initialize') stop()
            else scheduleIdle()
          },
          message.method === 'initialize' ? 30_000 : 180_000
        )
        requests.set(id, {
          socket,
          id: message.id,
          method: message.method,
          params: message.params,
          timer
        })
        write({ ...message, id })
      } else if (!message.method && typeof message.id === 'number') {
        if (!approvals.has(message.id)) return
        approvals.delete(message.id)
        write(message)
      } else write(message)
    })
    socket.isReady = () => ready
  })
  server.on('error', (error) => {
    console.error('Codex runtime listener failed.', error.message)
    stop()
  })
  server.listen({ host: '127.0.0.1', port: 0 }, () => {
    child = spawn(config.command.file, config.command.args, {
      env: config.command.env,
      cwd: config.command.cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    child.stdin.on('error', stop)
    child.on('error', (error) => {
      recordStartupError(error.message)
      console.error('Codex runtime could not start the provider.', error.message)
      stop()
    })
    child.on('close', (code) => {
      if (stderr.trim() || !stopping)
        recordStartupError(
          stderr.trim() || `Codex app-server exited with code ${code ?? 'unknown'}`
        )
      if (!stopping) console.error('Codex provider stopped.', { code, stderr })
      stop()
    })
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-2000)
      send(client, { runtimeStderr: chunk.toString().slice(-2000) })
    })
    createInterface({ input: child.stdout }).on('line', (line) => {
      let message
      try {
        message = JSON.parse(line)
      } catch {
        return
      }
      observe(message)
      if (message.method === 'currentTime/read' && typeof message.id === 'number') {
        write({ id: message.id, result: { currentTimeAt: Math.floor(Date.now() / 1000) } })
        return
      }
      if (message.method && typeof message.id === 'number') {
        const request = { ...message, dispatched: Boolean(client?.isReady()) }
        approvals.set(message.id, request)
        if (request.dispatched) send(client, message)
      } else if (message.method) {
        if (client?.isReady()) send(client, message)
      } else {
        const request = requests.get(message.id)
        if (!request) return
        requests.delete(message.id)
        clearTimeout(request.timer)
        if (!message.error) {
          if (request.method === 'thread/backgroundTerminals/list') {
            // A first page begins a fresh snapshot; later pages add to it.
            if (!request.params?.cursor)
              for (const [key, threadId] of backgroundTerminals)
                if (threadId === request.params.threadId) backgroundTerminals.delete(key)
            for (const terminal of message.result?.data ?? [])
              backgroundTerminals.set(
                `${request.params.threadId}:${terminal.processId}`,
                request.params.threadId
              )
          }
          if (request.method === 'thread/backgroundTerminals/terminate')
            backgroundTerminals.delete(`${request.params.threadId}:${request.params.processId}`)
          if (request.method === 'initialize') {
            initialized = message.result
            // The underlying stdio transport is initialized exactly once.
            write({ method: 'initialized' })
          }
          const thread = message.result?.thread
          if (
            thread?.id &&
            ['thread/start', 'thread/resume', 'thread/fork'].includes(request.method)
          ) {
            const inherited = threads.get(request.params?.threadId)
            if (request.params?.ephemeral === true) {
              temporaryThreads.set(thread.id, null)
              if (request.socket !== client) releaseTemporaryThread(thread.id)
            } else {
              threads.set(thread.id, {
                thread: { ...thread, turns: [] },
                dynamicTools: request.params?.dynamicTools ?? inherited?.dynamicTools,
                readOnly: request.params?.sandbox === 'read-only'
              })
            }
          }
          if (request.method === 'turn/start' && !completedTurns.has(message.result?.turn?.id))
            active.add(request.params?.threadId)
          if (
            request.method === 'turn/start' &&
            request.params?.sandboxPolicy?.type &&
            threads.has(request.params.threadId)
          )
            threads.get(request.params.threadId).readOnly =
              request.params.sandboxPolicy.type === 'readOnly'
          if (request.method === 'thread/unsubscribe' && message.result?.status === 'notLoaded')
            threads.delete(request.params?.threadId)
        }
        if (request.method === 'initialize') {
          initializing = false
          for (const waiter of initializeWaiters.splice(0)) {
            if (waiter.socket !== client) continue
            send(client, {
              ...message,
              id: waiter.id,
              ...(message.error
                ? {}
                : { result: { ...initialized, seleRuntime: { threads: [...threads.values()] } } })
            })
          }
        }
        if (request.socket === client) send(client, { ...message, id: request.id })
      }
      scheduleIdle()
    })
    const endpointTemporary = config.endpointPath + '.tmp'
    fs.writeFileSync(endpointTemporary, JSON.stringify({ port: server.address().port }), {
      mode: 0o600
    })
    fs.renameSync(endpointTemporary, config.endpointPath)
    scheduleIdle()
  })
  return { stop, server }
}

module.exports = { startRuntime }
if (require.main === module) {
  const input = createInterface({ input: process.stdin })
  input.once('line', (line) => {
    input.close()
    process.stdin.destroy()
    try {
      startRuntime(JSON.parse(line))
    } catch (error) {
      console.error('Unable to start Codex runtime.', error.message)
      process.exit(1)
    }
  })
}
