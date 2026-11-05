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
    const file = path.resolve(directory, `.${url.pathname === '/' ? '/index.html' : url.pathname}`)
    if (path.relative(directory, file).startsWith('..')) return new Response('', { status: 404 })
    try {
      return new Response(await fs.readFile(file), {
        headers: { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }
      })
    } catch {
      return new Response('', { status: 404 })
    }
  })
  let window
  const errors = []
  const open = async () => {
    window = new BrowserWindow({
      show: true,
      width: 1200,
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
    await wait('Boolean(document.getElementById("sele-computer-address"))')
    await run(`(() => {
      document.querySelector('.mobile-connect__help').open=true;
      const input=document.getElementById('sele-computer-address');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(new URL(url).origin)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 100))
    await run('document.getElementById("sele-computer-address").form.requestSubmit()')
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
    await run(
      `document.querySelector('.chat-panel__composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}))`
    )
    await wait(
      'document.getElementById("chat-search-content")?.textContent.includes("Live answer over the LAN")'
    )
    assert.equal(sends(), 1)
    await run(`preferencesApi.setItem('sele:mobile-web-fixture','saved for this host')`)
    window.destroy()
    await open()
    await wait('Boolean(document.querySelector(\'[data-chat-id="lan-fixture"]\'))')
    assert.equal(
      await run(`preferencesApi.getItem('sele:mobile-web-fixture').value`),
      'saved for this host'
    )
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
    await wait('Boolean(document.getElementById("sele-computer-address"))')
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
