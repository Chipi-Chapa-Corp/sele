import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Duplex, PassThrough } from 'node:stream'
import test from 'node:test'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('./codexRuntime.cjs', import.meta.url), 'utf8')

const fixture = () => {
  let accept
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill() {}
  })
  const server = {
    on() {},
    listen(_options, ready) {
      ready()
    },
    address: () => ({ port: 1234 }),
    close() {}
  }
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module,
    require(id) {
      if (id === 'node:net')
        return {
          createServer(callback) {
            accept = callback
            return server
          }
        }
      if (id === 'node:fs') return { writeFileSync() {}, renameSync() {} }
      if (id === 'node:child_process') return { spawn: () => child }
      return require(id)
    },
    console: { error() {} },
    setTimeout: () => ({ unref() {} }),
    clearTimeout() {},
    process: { exit() {} }
  })
  module.exports.startRuntime({ endpointPath: '/fixture/endpoint', token: 'secret', command: {} })
  const messages = []
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, done) {
      messages.push(JSON.parse(chunk.toString()))
      done()
    }
  })
  return {
    child,
    socket,
    messages,
    async authenticate() {
      accept(socket)
      socket.push(JSON.stringify({ token: 'secret' }) + '\n')
      await new Promise(setImmediate)
    }
  }
}

test('startup stderr emitted before attachment reaches the authenticated client', async () => {
  const { child, messages, authenticate } = fixture()
  child.stderr.write('Select another account for this chat.')
  await authenticate()
  assert.deepEqual(messages, [
    { runtimeReady: true },
    { runtimeStderr: 'Select another account for this chat.' }
  ])
})

test('provider startup failure drains pending diagnostic messages before closing the socket', async () => {
  const { child, socket, messages, authenticate } = fixture()
  await authenticate()
  child.stderr.write('Provider failed to start.')
  child.emit('close', 1)
  assert.equal(messages.at(-1).runtimeStderr, 'Provider failed to start.')
  assert.equal(socket.writableEnded, true)
  assert.equal(socket.destroyed, false, 'queued diagnostics must be flushed before disconnecting')
})
