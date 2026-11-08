// This process owns the PTY across Electron restarts. Disconnecting only detaches the UI.
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const { createInterface } = require('node:readline')

function startRuntime(config) {
  const { spawn } = require(config.ptyModule)
  const pty = spawn(config.command.file, config.command.args, config.ptyOptions)
  let client = null
  let output = (config.initialOutput ?? '').slice(-512 * 1024)
  let startupOutput = ''
  let attached = false
  let exit = null
  let paused = false
  let streaming = false
  let exitTimer = null
  let stopping = null
  let resolveExit
  const exited = new Promise((resolve) => {
    resolveExit = resolve
  })
  const stop = () => {
    if (exit) return Promise.resolve()
    if (!stopping) {
      pty.kill()
      const force = setTimeout(() => {
        if (!exit) pty.kill('SIGKILL')
      }, 500)
      stopping = exited.finally(() => clearTimeout(force))
    }
    return stopping
  }
  const send = (socket, message) => {
    if (!socket || socket.destroyed) return
    if (!socket.write(JSON.stringify(message) + '\n') && !paused) {
      paused = true
      pty.pause()
    }
  }
  pty.onData((data) => {
    output = (output + data).slice(-512 * 1024)
    if (!attached) startupOutput = (startupOutput + data).slice(-512 * 1024)
    if (streaming) send(client, { method: 'data', params: data })
  })
  pty.onExit((event) => {
    exit = event
    resolveExit()
    if (streaming) send(client, { method: 'exit', params: event })
    // Retain the final output briefly for a reconnect racing command completion.
    exitTimer = setTimeout(() => {
      client?.destroy()
      server.close()
    }, 120_000)
  })
  const server = net.createServer((socket) => {
    let authenticated = false
    const timeout = setTimeout(() => socket.destroy(), 5000)
    socket.on('error', () => socket.destroy())
    socket.on('drain', () => {
      if (client === socket && paused) {
        paused = false
        pty.resume()
      }
    })
    socket.on('close', () => {
      clearTimeout(timeout)
      if (client !== socket) return
      client = null
      streaming = false
      if (exit) {
        clearTimeout(exitTimer)
        server.close()
      }
      // Keep draining into bounded scrollback while the frontend is absent.
      if (paused) {
        paused = false
        pty.resume()
      }
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
        clearTimeout(timeout)
        if (message.token !== config.token || (client && client !== socket)) {
          socket.destroy()
          return
        }
        authenticated = true
        client = socket
        send(socket, { runtimeReady: true })
        return
      }
      if (message.runtimeStop) {
        void stop().finally(() => {
          clearTimeout(exitTimer)
          socket.destroy()
          server.close()
        })
        return
      }
      const reply = (result) => send(socket, { id: message.id, result })
      try {
        if (message.method === 'initialize') reply({ ...config.metadata, pid: pty.pid, exit })
        else if (message.method === 'attach') {
          reply({})
          streaming = true
          if (!attached) {
            // Fresh shell probes still need answers; only inherited scrollback is replay.
            attached = true
            if (config.initialOutput)
              send(socket, { method: 'data', params: config.initialOutput, replay: true })
            if (startupOutput) send(socket, { method: 'data', params: startupOutput })
            startupOutput = ''
          } else if (output) send(socket, { method: 'data', params: output, replay: true })
          if (exit) send(socket, { method: 'exit', params: exit })
        } else if (message.method === 'write' && !exit) pty.write(message.params)
        else if (message.method === 'resize' && !exit) pty.resize(...message.params)
        else if (message.method === 'status') reply({ process: exit ? '' : pty.process })
        else if (message.method === 'stop') {
          // Acknowledge process exit, not merely delivery of SIGHUP.
          void stop().then(() => reply({}))
        }
      } catch (error) {
        if (message.id != null) send(socket, { id: message.id, error: { message: error.message } })
      }
    })
  })
  server.on('error', () => {
    if (!exit) pty.kill()
    process.exit(1)
  })
  server.listen({ host: '127.0.0.1', port: 0 }, () => {
    fs.writeFileSync(
      path.join(path.dirname(config.endpointPath), 'session.json'),
      JSON.stringify({ sessionId: config.metadata.sessionId }),
      { mode: 0o600 }
    )
    fs.writeFileSync(
      config.endpointPath + '.tmp',
      JSON.stringify({ port: server.address().port }),
      { mode: 0o600 }
    )
    fs.renameSync(config.endpointPath + '.tmp', config.endpointPath)
  })
}

module.exports = { startRuntime }
if (require.main === module) {
  const input = createInterface({ input: process.stdin })
  input.once('line', (line) => {
    input.close()
    process.stdin.destroy()
    const config = JSON.parse(line)
    try {
      startRuntime(config)
    } catch (error) {
      fs.writeFileSync(config.startupErrorPath, error.message, { mode: 0o600 })
      process.exit(1)
    }
  })
}
