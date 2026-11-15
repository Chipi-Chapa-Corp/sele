const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { BrowserWindow, session } = require('electron')

module.exports = async ({
  link,
  port,
  configure,
  sends,
  getState,
  decidePairing,
  revokeDevice
}) => {
  const computer = await getState()
  let discoveryVisible = true
  const browser = session.fromPartition('persist:sele-android-web-fixture')
  const directory = path.resolve('out/mobile')
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf'
  }
  // Serve the actual APK assets at exactly Capacitor's configured app origin.
  // All backend traffic still crosses a real TCP WebSocket to the fixture host.
  browser.protocol.handle('http', async (request) => {
    const url = new URL(request.url)
    if (url.origin !== 'http://sele.localhost') return new Response('', { status: 403 })
    if (url.pathname === '/fixture-native.js')
      return new Response(
        `
      window.CapacitorCustomPlatform = { name: 'android' };
      window.fixtureServices = ${JSON.stringify(discoveryVisible ? [{ id: computer.computerId, name: computer.computerName, origin: new URL(link).origin }] : [])};
      const methods = ['startDiscovery','stopDiscovery','getServices','deviceInfo','readStorage','writeStorage','setSystemBars','showKeyboard','consumeKeyboardBack'];
      window.Capacitor = {
        PluginHeaders: [{ name: 'LocalNetwork', methods: methods.map(name => ({name,rtype:'promise'})) }],
        nativePromise: async (plugin, method, options) => {
          const storageKey = 'fixture-native-storage';
          const values = JSON.parse(localStorage.getItem(storageKey) || '{}');
          if (method === 'readStorage') return { values };
          if (method === 'writeStorage') {
            if (options.value === null) delete values[options.key]; else values[options.key] = options.value;
            localStorage.setItem(storageKey, JSON.stringify(values)); return {};
          }
          if (method === 'deviceInfo') return {id:'11111111-2222-3333-4444-555555555555', name:'Fixture phone'};
          if (method === 'getServices') return {services:window.fixtureServices};
          if (method === 'consumeKeyboardBack') return {consumed:false};
          return {};
        }
      };
    `,
        { headers: { 'Content-Type': 'text/javascript' } }
      )
    const file = path.resolve(directory, `.${url.pathname === '/' ? '/index.html' : url.pathname}`)
    if (path.relative(directory, file).startsWith('..')) return new Response('', { status: 404 })
    try {
      let content = await fs.readFile(file)
      if (url.pathname === '/')
        content = Buffer.from(
          content.toString().replace('<head>', '<head><script src="/fixture-native.js"></script>')
        )
      return new Response(content, {
        headers: { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }
      })
    } catch {
      return new Response('', { status: 404 })
    }
  })
  let window
  let openedAt
  const errors = []
  const open = async () => {
    openedAt = performance.now()
    window = new BrowserWindow({
      show: true,
      width: 440,
      height: 850,
      webPreferences: { session: browser, sandbox: true, contextIsolation: true }
    })
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error') errors.push(details.message)
    })
    await window.loadURL('http://sele.localhost')
  }
  const run = (expression) => window.webContents.executeJavaScript(expression)
  const wait = async (expression) => {
    const start = Date.now()
    while (Date.now() - start < 20000) {
      if (await run(expression)) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(
      `Mobile bundle timeout: ${expression}\n${await run('document.body.innerText')}\n${errors.join('\n')}`
    )
  }
  const connect = async (url) => {
    await wait('Boolean(document.querySelector(".mobile-connect__computers button"))')
    assert.equal(await run('Boolean(document.querySelector(".mobile-connect input"))'), false)
    await run('document.querySelector(".mobile-connect__computers button").click()')
    await wait('document.body.innerText.includes("Allow this device on")')
    let request
    for (let attempt = 0; attempt < 100; attempt++) {
      request = (await getState()).pairingRequests[0]
      if (request) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.ok(request)
    await decidePairing(request.id, true)
    await wait('Boolean(document.querySelector(\'[data-chat-id="lan-fixture"]\'))')
  }

  try {
    await open()
    assert.equal(await run('location.origin'), 'http://sele.localhost')
    await connect(link)
    await run(
      'document.querySelector(\'[data-chat-id="lan-fixture"] .chat-list-item__main\').click()'
    )
    await wait(
      'document.getElementById("chat-search-content")?.textContent.includes("Saved LAN answer")'
    )
    await run(`(() => { const input=document.querySelector('.chat-panel__composer textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Hello from the phone');
      input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
    await new Promise((resolve) => setTimeout(resolve, 150))
    await run(`document.querySelector('.chat-panel__composer [aria-label="Send message"]').click()`)
    await wait(
      'document.getElementById("chat-search-content")?.textContent.includes("Live answer over the LAN")'
    )
    assert.equal(sends(), 1)
    await run(`preferencesApi.setItem('sele:mobile-web-fixture','saved for this host')`)
    await run('preferencesApi.flush()')
    discoveryVisible = false
    window.destroy()
    await open()
    await wait('Boolean(document.querySelector(\'[data-chat-id="lan-fixture"]\'))')
    const startupMs = Math.round(performance.now() - openedAt)
    console.log('ANDROID SAVED STARTUP MS:', startupMs)
    assert.ok(startupMs < 2500, 'saved-device startup must not wait for a discovery timeout')
    discoveryVisible = true
    assert.equal(
      await run(`preferencesApi.getItem('sele:mobile-web-fixture').value`),
      'saved for this host'
    )
    await run(
      `window.retainedDocument = true; window.retainedComposer = document.querySelector('textarea');`
    )
    await configure({ enabled: false, port })
    await wait('Boolean(document.getElementById("sele-connection-status"))')
    await run(`preferencesApi.setItem('sele:offline-mobile-draft','draft typed while offline')`)
    await run('preferencesApi.flush()')
    await configure({ enabled: true, port })
    await wait('!document.getElementById("sele-connection-status")')
    assert.equal(await run('window.retainedDocument'), true, 'reconnect keeps the document')
    assert.equal(
      await run('window.retainedComposer === document.querySelector("textarea")'),
      true,
      'reconnect retains the composer'
    )
    assert.equal(
      await run(`preferencesApi.getItem('sele:offline-mobile-draft').value`),
      'draft typed while offline'
    )
    await run('preferencesApi.flush()')
    await revokeDevice((await getState()).devices[0].id)
    window.destroy()
    await open()
    await connect(link)
    assert.equal(sends(), 1)
    await run('document.querySelector(\'[aria-label="Settings"]\').click()')
    await wait('Boolean(document.getElementById("settings-tab-localNetwork"))')
    await run('document.getElementById("settings-tab-localNetwork").click()')
    await wait(
      'Array.from(document.querySelectorAll("button")).some(button=>button.textContent.includes("Connect to another computer"))'
    )
    await run(
      'Array.from(document.querySelectorAll("button")).find(button=>button.textContent.includes("Connect to another computer")).click()'
    )
    await wait('Boolean(document.querySelector(".mobile-connect__computers button"))')
    assert.deepEqual(
      errors.filter(
        (message) =>
          !message.includes('Connection lost.') && !message.includes('Sele is disconnected.')
      ),
      []
    )
    console.log(
      'ANDROID WEB BUNDLE PASSED: app origin, LAN pairing, chat send/stream, saved host, restart, key revocation, host switching'
    )
  } finally {
    window?.destroy()
    browser.protocol.unhandle('http')
  }
}
