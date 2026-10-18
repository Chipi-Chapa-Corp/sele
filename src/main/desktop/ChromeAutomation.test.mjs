import assert from 'node:assert/strict'
import test from 'node:test'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { ChromeAutomation } from './ChromeAutomation.ts'

test('Chrome pairing authenticates the extension, limits tab ownership, and revokes on disconnect', async () => {
  const service = new ChromeAutomation()
  test.after(() => service.disconnect())
  await service.pair()
  const wrong = new WebSocket(service.status.pairingUrl.replace(/token=[^&]+/, 'token=wrong'), {
    origin: `chrome-extension://${'a'.repeat(32)}`
  })
  wrong.on('error', () => {})
  await new Promise((resolve) => wrong.once('close', resolve))
  assert.equal(service.status.connected, false)
  const extension = new WebSocket(service.status.pairingUrl, {
    origin: `chrome-extension://${'a'.repeat(32)}`
  })
  extension.on('message', (data) => {
    const request = JSON.parse(String(data))
    extension.send(
      JSON.stringify({
        id: request.id,
        result:
          request.method === 'getTabs'
            ? [{ id: 1, title: 'Shared tab', url: 'https://example.com', active: true }]
            : {}
      })
    )
  })
  await once(extension, 'open')
  const first = service.createClient({
    providerId: 'codex',
    sessionId: 'one',
    cwd: '',
    containerKey: 'host'
  })
  const second = service.createClient({
    providerId: 'claude',
    sessionId: 'two',
    cwd: '',
    containerKey: 'host'
  })
  assert.equal((await first.listTabs()).length, 1)
  await first.attach(1)
  assert.equal((await second.listTabs()).length, 0)
  await assert.rejects(
    second.executeCdp(1, 'Runtime.evaluate', { expression: '1' }),
    /not been shared|another conversation/
  )
  await assert.rejects(
    first.executeCdp(999, 'Page.navigate', { url: 'https://example.com' }),
    /not been shared/
  )
  await service.disconnect()
  await assert.rejects(first.listTabs(), /Pair the Sele/)
  first.close()
  second.close()
})
