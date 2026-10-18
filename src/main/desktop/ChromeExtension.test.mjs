import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

function fixture() {
  const listeners = {}
  const commands = []
  const chrome = {
    debugger: {
      attach: async () => {},
      detach: async () => {},
      sendCommand: async (...args) => {
        commands.push(args)
        return { result: 'fixture' }
      },
      onEvent: {
        addListener: (fn) => {
          listeners.event = fn
        }
      },
      onDetach: {
        addListener: (fn) => {
          listeners.detach = fn
        }
      }
    },
    tabs: {
      get: async (id) => ({ id, url: 'https://example.com' }),
      onRemoved: { addListener: () => {} }
    },
    downloads: {
      onCreated: {
        addListener: (fn) => {
          listeners.created = fn
        }
      },
      onChanged: {
        addListener: (fn) => {
          listeners.changed = fn
        }
      }
    },
    runtime: {
      onMessage: {
        addListener: (fn) => {
          listeners.message = fn
        }
      }
    }
  }
  const code = readFileSync(
    new URL('../../../resources/sele-chrome-extension/background.js', import.meta.url),
    'utf8'
  )
  const context = { chrome, URL, WebSocket: { OPEN: 1 }, setInterval, clearInterval, Date }
  vm.runInNewContext(
    `${code}\nglobalThis.fixture = {handle,shared,attached,downloads,allowedDownloads,disconnect};`,
    context
  )
  return { ...context.fixture, listeners, commands, chrome }
}

test('Chrome extension enforces explicit sharing and forwards flattened CDP sessions', async () => {
  const h = fixture()
  await assert.rejects(
    h.handle('executeCdp', { tabId: 3, method: 'Runtime.evaluate' }),
    /Share this tab/
  )
  h.shared.add(3)
  await h.handle('attach', { tabId: 3 })
  h.listeners.event({ tabId: 3 }, 'Target.attachedToTarget', {
    sessionId: 'child',
    targetInfo: { type: 'iframe', targetId: 'iframe' }
  })
  await h.handle('executeCdp', {
    tabId: 3,
    sessionId: 'child',
    method: 'Runtime.evaluate',
    params: { expression: '1+1' }
  })
  await assert.rejects(
    h.handle('executeCdp', { tabId: 3, method: 'Target.createTarget' }),
    /Unsupported CDP/
  )
  await assert.rejects(
    h.handle('executeCdp', { tabId: 3, sessionId: 'foreign', method: 'Runtime.evaluate' }),
    /outside this shared tab/
  )
  assert.deepEqual(JSON.parse(JSON.stringify(h.commands[0])), [
    { tabId: 3, sessionId: 'child' },
    'Runtime.evaluate',
    { expression: '1+1' }
  ])
  await h.handle('detach', { tabId: 3 })
  h.listeners.detach({ tabId: 3 }, 'canceled_by_user')
  assert.equal(h.shared.has(3), true, 'late intentional detach must not revoke a new lease')
  await h.handle('attach', { tabId: 3 })
  h.listeners.detach({ tabId: 3 }, 'canceled_by_user')
  assert.equal(h.shared.has(3), false)
  await assert.rejects(
    h.handle('executeCdp', { tabId: 3, method: 'Page.navigate' }),
    /Share this tab/
  )
})

test('Chrome download grants expire and are consumed once', async () => {
  const h = fixture()
  h.shared.add(3)
  await h.handle('allowDownload', { tabId: 3, url: 'https://example.com/file' })
  h.listeners.created({ id: 1, url: 'https://example.com/file', filename: 'file', totalBytes: 5 })
  h.listeners.created({ id: 2, url: 'https://example.com/file', filename: 'file', totalBytes: 5 })
  assert.equal(h.downloads.get(3).length, 1)
  h.listeners.changed({ id: 1, state: { current: 'complete' } })
  assert.equal(h.downloads.get(3)[0].status, 'complete')
  h.allowedDownloads.set('https://example.com/expired', { tabId: 3, expires: 0 })
  h.listeners.created({ id: 3, url: 'https://example.com/expired' })
  assert.equal(h.downloads.get(3).length, 1)
})

test('disconnect cancels a late debugger attachment instead of restoring access', async () => {
  const h = fixture()
  h.shared.add(3)
  let finish
  h.chrome.debugger.attach = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const pending = h.handle('executeCdp', { tabId: 3, method: 'Runtime.evaluate' })
  await new Promise((resolve) => setImmediate(resolve))
  await h.disconnect()
  finish()
  await assert.rejects(pending, /revoked/)
  assert.equal(h.attached.size, 0)
  assert.equal(h.commands.length, 0)
})
