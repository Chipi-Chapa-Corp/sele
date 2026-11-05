const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs/promises')
const { homedir } = require('node:os')
const path = require('node:path')
const { WebSocket } = require('ws')

module.exports = async ({
  link,
  port,
  configure,
  sends,
  getState,
  decidePairing,
  revokeDevice,
  exercise
}) => {
  const serial = process.env.SELE_ANDROID_TEST_SERIAL
  assert.match(
    serial,
    /^emulator-\d+$/,
    'this fixture only operates on an explicitly selected emulator'
  )
  const sdk = process.env.ANDROID_HOME || path.join(homedir(), 'Android/Sdk')
  const binary = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
  const apk =
    process.env.SELE_ANDROID_TEST_APK ||
    path.resolve(`dist/sele-${require('../../package.json').version}-android-debug.apk`)
  const appId = 'com.chipichapa.sele.android'
  const adb = (args, buffer = false) => {
    const result = spawnSync(
      binary,
      ['-P', process.env.SELE_ANDROID_ADB_PORT || '5037', '-s', serial, ...args],
      { encoding: buffer ? undefined : 'utf8', timeout: 45000, maxBuffer: 12 * 1024 * 1024 }
    )
    if (result.status !== 0 || result.error)
      throw new Error(`adb ${args.join(' ')}: ${result.stderr || result.stdout || result.error || result.signal || result.status}`)
    return buffer ? result.stdout : result.stdout.trim()
  }
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const keyboardVisible = () => /mInputShown=true|isInputViewShown=true/.test(adb(['shell', 'dumpsys', 'input_method']))
  const dismissKeyboard = async () => {
    if (keyboardVisible()) {
      adb(['shell', 'input', 'keyevent', '4'])
      const deadline = Date.now() + 10000
      while (Date.now() < deadline && keyboardVisible()) await delay(100)
      assert.equal(keyboardVisible(), false, 'native keyboard closes')
    }
    // Layout resizes before Android removes the IME's native touch region.
    await delay(500)
  }
  const launch = () => adb(['shell', 'am', 'start', '-W', '-n', `${appId}/.MainActivity`])
  let socket
  let forwarded
  let nextId = 1
  const pending = new Map()
  const command = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 30000)
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
  const run = async (expression) => {
    const result = await command('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description || result.exceptionDetails.text
      )
    return result.result?.value
  }
  const waitFor = async (expression) => {
    const start = Date.now()
    while (Date.now() - start < 30000) {
      if (await run(expression)) return
      await delay(150)
    }
    throw new Error(
      `Android UI timeout: ${expression}\n${await run('document.body.innerText')}\n${await run('JSON.stringify({active:document.activeElement?.outerHTML.slice(0,600),terminal:window.__phoneTerminalOutput})')}`
    )
  }
  const nativeViewBounds = new Map()
  const calibrateTouch = async () => {
    const metrics = await run(
      '({width:innerWidth,height:innerHeight,orientation:screen.orientation?.type})'
    )
    const key = JSON.stringify(metrics)
    let bounds = nativeViewBounds.get(key)
    if (!bounds) {
      for (let attempt = 0; ; attempt++) {
        try {
          adb(['shell', 'uiautomator', 'dump', '--compressed', '/sdcard/sele-touch.xml'])
          break
        } catch (error) {
          if (attempt === 2) throw error
          await delay(300)
        }
      }
      const xml = adb(['shell', 'cat', '/sdcard/sele-touch.xml'])
      const nodes = (xml.match(/<node\b[^>]*>/g) ?? []).filter(node=>node.includes('class="android.webkit.WebView"'))
      const node = nodes.find(node=>node.includes('resource-id="com.chipichapa.sele.android:id/webview"')) ?? nodes[0]
      assert.ok(node, 'native WebView bounds are available')
      bounds = node
        .match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
        .slice(1)
        .map(Number)
      const settled = await run('({width:innerWidth,height:innerHeight,orientation:screen.orientation?.type})')
      if (JSON.stringify(settled) !== key) return calibrateTouch()
      nativeViewBounds.set(key, bounds)
    }
    return { width: metrics.width, bounds }
  }
  const touchPoint = async (point, calibration) => {
    if (process.env.SELE_ANDROID_NATIVE_TOUCH !== '0') {
      const { width, bounds } = calibration ?? await calibrateTouch()
      const scale = (bounds[2] - bounds[0]) / width
      adb([
        'shell',
        'input',
        'tap',
        String(Math.round(bounds[0] + point.x * scale)),
        String(Math.round(bounds[1] + point.y * scale))
      ])
    } else {
      await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
      await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    await delay(100)
  }
  const tap = async (selector) => {
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)
    const calibration = process.env.SELE_ANDROID_NATIVE_TOUCH !== '0' ? await calibrateTouch() : undefined
    const locate = () =>
      run(`(() => {
      const element=document.querySelector(${JSON.stringify(selector)});
      let rect=element.getBoundingClientRect();
      if(rect.top<0||rect.bottom>innerHeight||rect.left<0||rect.right>innerWidth){
        element.scrollIntoView({block:'nearest',inline:'nearest'});
        rect=element.getBoundingClientRect();
      }
      const x=rect.left+rect.width/2,y=rect.top+rect.height/2;
      if(element.disabled || !rect.width || !rect.height || !element.contains(document.elementFromPoint(x,y))) return null;
      return {x,y,width:innerWidth,height:innerHeight};
    })()`)
    let point
    let previous
    let stableSince=Date.now()
    const targetDeadline = Date.now() + 5000
    while (Date.now() < targetDeadline) {
      point = await locate()
      if (point && previous && Math.abs(point.x-previous.x)<1 && Math.abs(point.y-previous.y)<1 && point.width===previous.width && point.height===previous.height) {
        if(Date.now()-stableSince>=200)break
      } else stableSince=Date.now()
      previous=point
      await delay(50)
    }
    assert.ok(
      point,
      `tap target is visible and unobstructed: ${selector}\n${await run(`JSON.stringify({pane:document.querySelector('main.chat')?.dataset.mobilePane, target:document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect().toJSON(), hit:document.elementFromPoint(180,230)?.outerHTML.slice(0,700)})`)}`
    )
    await run(`(()=>{window.__lastNativeTap=[];if(!window.__tapRecorder){window.__tapRecorder=true;for(const type of ['pointerdown','pointerup','pointercancel','touchstart','touchend','click','focusin','focusout','keydown'])document.addEventListener(type,event=>{window.__lastNativeTap.push({type,defaultPrevented:event.defaultPrevented,pointerType:event.pointerType,isPrimary:event.isPrimary,key:event.key,target:event.target.outerHTML?.slice(0,250),x:event.clientX,y:event.clientY,active:document.activeElement?.outerHTML.slice(0,150)});window.__lastNativeTap=window.__lastNativeTap.slice(-15)},true)}window.__tapPoint=${JSON.stringify(point)};window.__tapViewport={width:innerWidth,height:innerHeight,offset:visualViewport?.offsetTop,scale:visualViewport?.scale}})()`)
    await touchPoint(point, calibration)
  }
  const swipe = async (from, to, duration = 280, calibration) => {
    const { width, bounds } = calibration ?? await calibrateTouch()
    const scale = (bounds[2] - bounds[0]) / width
    const native = (point) => [String(Math.round(bounds[0] + point.x * scale)), String(Math.round(bounds[1] + point.y * scale))]
    adb(['shell', 'input', 'swipe', ...native(from), ...native(to), String(duration)])
    await delay(200)
  }
  const navigate = async (destination) => {
    let pane = await run('document.querySelector("main.chat")?.dataset.mobilePane')
    if (destination === 'Chats' || destination === 'Open settings') {
      if (pane !== 'chats') await tap('.mobile-conversation-header button[aria-label="Open sidebar"]')
      await waitFor('document.querySelector("main.chat")?.dataset.mobilePane==="chats" && document.getElementById("sidebar").getBoundingClientRect().left>=-1')
      if (destination === 'Open settings') await tap('.mobile-sidebar-footer button[aria-label="Open settings"]')
      return
    }
    if (pane === 'chats') {
      await tap('.mobile-sidebar-heading button[aria-label="Close sidebar"]')
      await waitFor('document.querySelector("main.chat")?.dataset.mobilePane!=="chats"')
    }
    pane = await run('document.querySelector("main.chat")?.dataset.mobilePane')
    if (destination === 'Workspace' && pane !== 'workspace')
      await tap('.mobile-conversation-header button[aria-label="Open workspace"]')
    if (destination === 'Conversation') {
      for (let index = 0; index < 30 && (await run('document.querySelector("main.chat")?.dataset.mobilePane')) === 'workspace'; index++)
        await tap('.mobile-conversation-header button[aria-label="Back"]')
    }
    await waitFor(`document.querySelector('main.chat')?.dataset.mobilePane===${JSON.stringify(destination === 'Workspace' ? 'workspace' : 'conversation')}`)
  }
  const hold = async (selector) => {
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)
    const calibration = await calibrateTouch()
    let point
    let previous
    let stableSince=Date.now()
    const deadline = Date.now()+5000
    while(Date.now()<deadline) {
      point = await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;let r=e.getBoundingClientRect();if(r.top<0||r.bottom>innerHeight){e.scrollIntoView({block:'nearest'});r=e.getBoundingClientRect()}const x=r.x+r.width/2,y=r.y+r.height/2;return r.width>0&&r.height>0&&e.contains(document.elementFromPoint(x,y))?{x,y,width:innerWidth,height:innerHeight}:null})()`)
      if(point&&previous&&Math.abs(point.x-previous.x)<1&&Math.abs(point.y-previous.y)<1&&point.width===previous.width&&point.height===previous.height){
        if(Date.now()-stableSince>=200)break
      } else stableSince=Date.now()
      previous=point
      await delay(50)
    }
    assert.ok(point, `hold target is visible and unobstructed after layout settles: ${selector}`)
    await swipe(point, point, 650, calibration)
  }
  const selectChat = async () => {
    if (process.env.SELE_ANDROID_TEST_LIVE_CSS) {
      const css = await fs.readFile(
        path.resolve('src/renderer/src/workspace/styles/mobile.css'),
        'utf8'
      )
      await run(
        `(() => {const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style)})()`
      )
    }
    await navigate('Chats')
    await waitFor(`document.querySelector('main.chat')?.dataset.mobilePane === 'chats'`)
    if (process.env.SELE_ANDROID_POLISH_ONLY) {
      await tap('.chat-home__filter-tabs button[aria-label="All chats"]')
      for (let i=0;i<10&&await run('Boolean(document.querySelector(\'.chat-sidebar .chat-list-group__toggle[aria-expanded="false"]\'))');i++)
        await tap('.chat-sidebar .chat-list-group__toggle[aria-expanded="false"]')
    }
    await tap('[data-chat-id="lan-fixture"] .chat-list-item__main')
    await waitFor(
      `document.querySelector('main.chat')?.dataset.mobilePane === 'conversation'`
    )
    await delay(300)
    assert.equal(await run(`getComputedStyle(document.getElementById('detail')).display`), 'flex')
  }
  const attach = async () => {
    const start = Date.now()
    let targets
    while (Date.now() - start < 30000) {
      const pid = adb(['shell', `pidof ${appId} || true`])
      if (pid && !forwarded)
        forwarded = adb(['forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`])
      if (forwarded) {
        try {
          targets = await (await fetch(`http://127.0.0.1:${forwarded}/json`)).json()
          if (targets.some((target) => target.type === 'page' && target.webSocketDebuggerUrl)) break
        } catch {
          /* The WebView debug socket appears after the Activity starts. */
        }
      }
      await delay(200)
    }
    const target = targets?.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
    assert.ok(target, 'the APK must expose its debug WebView on the selected emulator')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString())
      if (
        message.method === 'Runtime.consoleAPICalled' &&
        ['error', 'warning'].includes(message.params.type)
      ) {
        const output = message.params.args
          .map((arg) => arg.value ?? arg.description ?? '')
          .join(' ')
        if (!output.includes('codex account authentication required to read rate limits'))
          console.log('ANDROID CONSOLE:', output.slice(0, 1800))
      }
      const request = pending.get(message.id)
      if (!request) return
      clearTimeout(request.timer)
      pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.result)
    })
    await command('Runtime.enable')
  }
  const detach = () => {
    socket?.close()
    if (forwarded) adb(['forward', '--remove', `tcp:${forwarded}`])
    forwarded = null
  }
  const connect = async (value) => {
    await waitFor('Boolean(document.getElementById("sele-computer-address"))')
    await delay(500)
    await run(`(() => {
      document.querySelector('.mobile-connect__help').open=true;
      const input=document.getElementById('sele-computer-address');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(new URL(value).origin)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`)
    await delay(100)
    await run('document.getElementById("sele-computer-address").form.requestSubmit()')
    await waitFor('document.body.innerText.includes("Allow this device on")')
    let request
    for (let i = 0; i < 100; i++) {
      request = (await getState()).pairingRequests?.[0]
      if (request) break
      await delay(100)
    }
    assert.ok(request, 'Android must request desktop approval')
    assert.equal(
      await run('Boolean(window.providerApi)'),
      false,
      'no provider access before approval'
    )
    await decidePairing(request.id, true)
    await waitFor(
      exercise || process.env.SELE_ANDROID_POLISH_ONLY
        ? 'Boolean(document.querySelector("main.chat"))'
        : 'Boolean(document.querySelector(\'[data-chat-id="lan-fixture"]\'))'
    )
  }
  try {
    adb(['install', '-r', apk])
    adb(['shell', 'pm', 'clear', appId])
    launch()
    await attach()
    assert.equal(await run('location.origin'), 'http://sele.localhost')
    assert.equal(await run('Capacitor.isNativePlatform()'), true)
    await waitFor('Boolean(document.getElementById("sele-computer-address"))')
    await delay(500)
    await fs.mkdir(path.resolve('test-results/mobile-ui'), { recursive: true })
    await fs.writeFile(path.resolve('test-results/mobile-ui/nearby-computers.png'), adb(['exec-out', 'screencap', '-p'], true))
    assert.equal(await run('Boolean(document.querySelector(".mobile-connect footer"))'),false,'connection has no extra bottom label')
    assert.ok(await run('(()=>{const r=document.querySelector(".mobile-connect__content.chat-panel").getBoundingClientRect();return r.width>=innerWidth*.85&&r.height>=innerHeight*.85})()'),'connection controls live inside a full-size shared chat pane')
    await connect(link)
    const ui = {
        run,
        waitFor,
        tap,
        navigate,
        hold,
        swipe,
        restart: async () => {
          await run('preferencesApi.flush()')
          detach()
          adb(['shell', 'am', 'force-stop', appId])
          launch()
          await attach()
          await waitFor('Boolean(document.querySelector("main.chat"))')
        },
        touchPoint,
        invalidateTouchBounds: () => nativeViewBounds.clear(),
        keyboardVisible,
        dismissKeyboard,
        adb,
        command,
        delay,
        screenshot: async (file) => {
          await fs.mkdir(path.dirname(file), { recursive: true })
          await fs.writeFile(file, adb(['exec-out', 'screencap', '-p'], true))
        }
      }
    if (exercise) { await exercise(ui); return }
    if (process.env.SELE_ANDROID_WORKSPACE_ONLY) {
      await selectChat()
      await require('./android-workspace-layout.cjs')(ui, path.resolve('test-results/android/workspace'))
      console.log('ANDROID APK PASSED: workspace layout')
      return
    }
    if (process.env.SELE_ANDROID_POLISH_ONLY) {
      await selectChat()
      await require('./android-polish.cjs')(ui, path.resolve('test-results/android/polish'))
      console.log('ANDROID APK PASSED: mobile polish')
      return
    }
    if (process.env.SELE_ANDROID_TOUCH_FOLLOWUP_ONLY) {
      await selectChat()
      await require('./android-touch-followup.cjs')(ui, path.resolve('test-results/android/ui'))
      console.log('ANDROID APK PASSED: focused touch follow-up')
      return
    }
    if (process.env.SELE_ANDROID_TEST_UI_ONLY) {
      await selectChat()
      await require('./android-ui.cjs')(ui, path.resolve('test-results/android/ui'))
      console.log('ANDROID APK PASSED: focused mobile UI')
      return
    }
    if (process.env.SELE_ANDROID_REFINEMENTS_ONLY) {
      await selectChat()
      await require('./android-mobile-refinements.cjs')(ui, path.resolve('test-results/android/ui'))
      if (process.env.SELE_ANDROID_TOUCH_AFTER_REFINEMENTS) await require('./android-touch-followup.cjs')(ui, path.resolve('test-results/android/ui'))
      console.log('ANDROID APK PASSED: focused mobile refinements')
      return
    }
    await selectChat()
    await waitFor(
      'document.getElementById("chat-search-content")?.textContent.includes("Saved LAN answer")'
    )
    await run(`(() => { const input=document.querySelector('.chat-panel__composer textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Hello from the phone');
      input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
    await delay(150)
    await run(
      `document.querySelector('.chat-panel__composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}))`
    )
    await waitFor(
      'document.getElementById("chat-search-content")?.textContent.includes("Live answer over the LAN")'
    )
    assert.equal(sends(), 1)
    await run(`preferencesApi.setItem('sele:android-fixture-draft','saved on Android')`)
    assert.equal(
      (await run('preferencesApi.flush()')).ok,
      true,
      'native storage acknowledges durable writes'
    )
    const upload = await run(
      `appApi.getDroppedMessageAttachments([new File(['Android attachment'],'android.txt',{type:'text/plain'})])`
    )
    assert.equal(await fs.readFile(upload[0].path, 'utf8'), 'Android attachment')
    // Reopen the Activity and WebView: the selected host and access key must
    // persist without loading the UI from that host or resending the message.
    detach()
    adb(['shell', 'am', 'force-stop', appId])
    launch()
    await attach()
    await waitFor('Boolean(document.querySelector(\'[data-chat-id="lan-fixture"]\'))')
    assert.equal(
      await run(`preferencesApi.getItem('sele:android-fixture-draft').value`),
      'saved on Android'
    )
    await configure({ enabled: false, port })
    await waitFor('Boolean(document.getElementById("sele-connection-status"))')
    await delay(500)
    await fs.writeFile(path.resolve('test-results/mobile-ui/reconnecting.png'), adb(['exec-out', 'screencap', '-p'], true))
    await configure({ enabled: true, port })
    await waitFor(
      '!document.getElementById("sele-connection-status") && Boolean(document.querySelector(\'[data-chat-id="lan-fixture"]\'))'
    )
    assert.equal(sends(), 1)
    const device = (await getState()).devices[0]
    assert.ok(device, 'a paired Android device is persisted on the host')
    await revokeDevice(device.id)
    await waitFor('Boolean(document.getElementById("sele-computer-address"))')
    await connect(link)
    assert.equal(sends(), 1)
    await selectChat()
    await waitFor(
      'document.getElementById("chat-search-content")?.textContent.includes("Live answer over the LAN")'
    )
    const output = path.resolve('test-results/android')
    await fs.mkdir(output, { recursive: true })
    await fs.writeFile(
      path.join(output, 'sele-android.png'),
      adb(['exec-out', 'screencap', '-p'], true)
    )
    if (process.env.SELE_ANDROID_TEST_ALL_UI) {
      await require('./android-ui.cjs')(ui, path.resolve('test-results/android/ui'))
    }
    // The user can select another host without clearing Android application data.
    await navigate('Open settings')
    await waitFor('Boolean(document.getElementById("settings-tab-localNetwork"))')
    await run('document.getElementById("settings-tab-localNetwork").click()')
    await waitFor(
      'Array.from(document.querySelectorAll("button")).some(button=>button.textContent.includes("Connect to another computer"))'
    )
    await run(
      'Array.from(document.querySelectorAll("button")).find(button=>button.textContent.includes("Connect to another computer")).click()'
    )
    await waitFor('Boolean(document.getElementById("sele-computer-address"))')
    console.log(
      'ANDROID APK PASSED: native WebView, pairing, chat send/stream, upload, saved host, restart, reconnect, revocation, host switching'
    )
  } catch (error) {
    try { console.log('ANDROID TOUCH DIAGNOSTIC', await run('JSON.stringify({point:window.__tapPoint,before:window.__tapViewport,now:{width:innerWidth,height:innerHeight,offset:visualViewport?.offsetTop,scale:visualViewport?.scale},events:window.__lastNativeTap,active:document.activeElement?.outerHTML.slice(0,400)})')) } catch { /* Preserve original test error if the page closed. */ }
    await fs.mkdir(path.resolve('test-results/android'), { recursive: true })
    await fs.writeFile(
      path.resolve('test-results/android/failure.png'),
      adb(['exec-out', 'screencap', '-p'], true)
    )
    throw error
  } finally {
    detach()
    adb(['shell', 'am', 'force-stop', appId])
  }
}
