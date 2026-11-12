import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { connectProcessRuntime, processRuntimeKey } from './processRuntime.ts'

for (const [reason, code] of [
  ['authentication', 'ESTALE'],
  ['busy', 'EBUSY'],
  [null, 'ERR_PROCESS_RUNTIME_REJECTED']
]) {
  test(`runtime handshake distinguishes ${reason ?? 'legacy rejection'} without replacing the listener`, async (t) => {
    const profile = await mkdtemp(join(tmpdir(), 'sele-runtime-rejection-'))
    const sockets = new Set()
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
      socket.once('data', () =>
        socket.end(reason ? JSON.stringify({ runtimeRejected: reason }) + '\n' : undefined)
      )
    })
    t.after(async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
      await rm(profile, { recursive: true, force: true })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const directory = join(profile, 'fixture', processRuntimeKey(profile, 'session'))
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'token'), 'a'.repeat(64), { mode: 0o600 })
    await writeFile(
      join(directory, 'endpoint.json'),
      JSON.stringify({ port: server.address().port })
    )
    await assert.rejects(
      connectProcessRuntime(profile, 'session', null, { namespace: 'fixture', source: '' }),
      { code }
    )
    assert.equal(server.listening, true)
  })
}
