// Real input and in-page instrumentation over the DevTools protocol.
const fs = require('node:fs')
const { sleep } = require('./harness.cjs')

const keys = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Escape: { code: 'Escape', keyCode: 27 },
  Tab: { code: 'Tab', keyCode: 9 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  End: { code: 'End', keyCode: 35 },
  Home: { code: 'Home', keyCode: 36 },
  a: { code: 'KeyA', keyCode: 65, text: 'a' },
  f: { code: 'KeyF', keyCode: 70, text: 'f' }
}
const modifierBits = { alt: 1, ctrl: 2, meta: 4, shift: 8 }

// Installed once per document. Records frames, long tasks, layout shifts and element motion.
const instrumentation = String.raw`(() => {
  if (window.__e2e) return true
  const state = { frames: [], longTasks: [], shifts: [], errors: [], recording: false, tracks: null }
  const observe = (type, sink) => {
    try { new PerformanceObserver(list => { for (const entry of list.getEntries()) sink(entry) }).observe({ type, buffered: false }) } catch {}
  }
  observe('longtask', entry => { if (state.recording) state.longTasks.push(Math.round(entry.duration)) })
  observe('layout-shift', entry => { if (state.recording && !entry.hadRecentInput) state.shifts.push(entry.value) })
  addEventListener('error', event => state.errors.push(String(event.error?.stack ?? event.message)))
  addEventListener('unhandledrejection', event => state.errors.push('unhandled: ' + String(event.reason?.stack ?? event.reason)))
  let last = 0
  // Positions are read after the frame is painted (a task posted from rAF runs after
  // ResizeObserver corrections and paint), so they reflect what the user actually saw.
  const channel = new MessageChannel()
  let pendingNow = 0
  channel.port1.onmessage = () => {
    if (!state.recording || !state.tracks) return
    for (const track of state.tracks) {
      const element = track.find()
      const top = element ? element.getBoundingClientRect().top : null
      const scroller = track.scroller()
      track.samples.push({ t: pendingNow, top, id: element ? track.key(element) : null, scrollTop: scroller?.scrollTop ?? null, scrollHeight: scroller?.scrollHeight ?? null, clientHeight: scroller?.clientHeight ?? null, turns: scroller?.querySelectorAll('[data-chat-turn-id]').length ?? null, pending: scroller?.querySelectorAll('.chat-detail__message-block--pending').length ?? null })
    }
  }
  const tick = now => {
    if (state.recording) {
      if (last) state.frames.push(now - last)
      if (state.tracks) { pendingNow = now; channel.port2.postMessage(0) }
    }
    last = now
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  window.__e2e = {
    state,
    start(tracks = null) {
      state.frames = []; state.longTasks = []; state.shifts = []; last = 0
      state.tracks = tracks
      state.recording = true
    },
    stop() {
      state.recording = false
      const frames = state.frames.slice(1)
      const sorted = [...frames].sort((a, b) => a - b)
      const result = {
        frames: frames.length,
        maxFrame: Math.round(sorted.at(-1) ?? 0),
        p95Frame: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
        slowFrames: frames.filter(frame => frame > 50).length,
        longTasks: state.longTasks.slice(),
        maxLongTask: Math.max(0, ...state.longTasks),
        layoutShift: Number(state.shifts.reduce((sum, value) => sum + value, 0).toFixed(4)),
        tracks: state.tracks?.map(track => track.samples) ?? null
      }
      state.tracks = null
      return result
    },
    nextFrames(count = 2) {
      return new Promise(resolve => { let left = count; const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step)); requestAnimationFrame(step) })
    }
  }
  return true
})()`

class Page {
  constructor(cdp, { artifacts }) {
    this.cdp = cdp
    this.artifacts = artifacts
    this.consoleErrors = []
    cdp.on((message) => {
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error')
        this.consoleErrors.push(
          message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')
        )
      if (message.method === 'Runtime.exceptionThrown')
        this.consoleErrors.push(
          'exception: ' +
            (message.params.exceptionDetails.exception?.description ??
              message.params.exceptionDetails.text)
        )
    })
  }

  /** Evaluate a script now and in every future document of this window. */
  async inject(source) {
    await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source })
    await this.cdp.evaluate(source)
  }

  async install() {
    if (this.installed) return
    this.installed = true
    await this.inject(instrumentation)
  }

  eval(expression, options) {
    return this.cdp.evaluate(expression, options)
  }

  /** Poll an expression each animation frame until it is truthy; returns its value. */
  async waitFor(expression, { timeout = 15000, message } = {}) {
    const deadline = Date.now() + timeout
    let lastError = null
    while (true) {
      const remaining = Math.max(0, deadline - Date.now())
      try {
        // rAF polling observes every painted frame; the timer fallback covers hidden documents.
        return await this.cdp.evaluate(
          `new Promise((resolve, reject) => {
            const deadline = performance.now() + ${remaining}
            // Exactly one pending check at a time: the next frame, or a timer fallback when
            // frames stall. Both are cancelled before rescheduling so checks never multiply.
            let frame = 0
            let timer = 0
            const check = () => {
              cancelAnimationFrame(frame)
              clearTimeout(timer)
              let value
              try { value = (${expression}) } catch (error) { value = undefined }
              if (value) return resolve(value instanceof Node ? true : value)
              if (performance.now() > deadline) return reject(new Error('e2e-timeout'))
              frame = requestAnimationFrame(check)
              timer = setTimeout(check, 100)
            }
            check()
          })`,
          { timeoutMs: remaining + 5000 }
        )
      } catch (error) {
        lastError = error
        if (/e2e-timeout/.test(error.message) || Date.now() >= deadline) break
        // The document may be reloading; try again in the new context.
        await sleep(100)
      }
    }
    const cause = /e2e-timeout/.test(lastError?.message ?? '')
      ? ''
      : ` [${lastError?.message.split('\n')[0]}]`
    throw new Error(
      `${message ?? 'Condition not met'} (waited ${timeout}ms for ${expression.slice(0, 160)})${cause}`
    )
  }

  /** Measure milliseconds from now until an expression becomes truthy (checked every frame). */
  async latency(action, expression, { timeout = 15000, message } = {}) {
    await this.cdp.evaluate(`window.__e2eLatencyStart = performance.now(); true`)
    await action()
    await this.waitFor(expression, { timeout, message })
    return Math.round(await this.cdp.evaluate(`performance.now() - window.__e2eLatencyStart`))
  }

  /** Center of an element once it has stopped moving (menus and rows animate into place). */
  async center(selector, { scroll = true } = {}) {
    const rect = await this.cdp.evaluate(`(async () => {
      const find = () => ${selector.startsWith('(') ? selector : `document.querySelector(${JSON.stringify(selector)})`}
      let element = find()
      if (!element) return null
      ${scroll ? "element.scrollIntoView({ block: 'nearest', inline: 'nearest' })" : ''}
      const read = () => { const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height } }
      let previous = read()
      for (let frame = 0; frame < 60; frame++) {
        await new Promise(resolve => requestAnimationFrame(resolve))
        element = find() ?? element
        const next = read()
        if (Math.abs(next.x - previous.x) < 0.5 && Math.abs(next.y - previous.y) < 0.5 && Math.abs(next.width - previous.width) < 0.5) return next
        previous = next
      }
      return previous
    })()`)
    if (!rect || rect.width === 0 || rect.height === 0)
      throw new Error(`Element not visible: ${selector.slice(0, 200)}`)
    return rect
  }

  async mouse(type, x, y, extra = {}) {
    await this.cdp.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      clickCount: 1,
      ...extra
    })
  }

  /** Click with real mouse events. The selector may be a CSS selector or a JS expression in parentheses. */
  async click(selector, { modifiers = [], scroll = true, offsetX = null } = {}) {
    const point = await this.center(selector, { scroll })
    if (offsetX !== null) point.x = point.x - point.width / 2 + offsetX
    const bits = modifiers.reduce((sum, name) => sum | modifierBits[name], 0)
    await this.mouse('mouseMoved', point.x, point.y, { button: 'none', modifiers: bits })
    await this.mouse('mousePressed', point.x, point.y, { modifiers: bits })
    await this.mouse('mouseReleased', point.x, point.y, { modifiers: bits })
  }

  async hover(selector) {
    const point = await this.center(selector)
    await this.mouse('mouseMoved', point.x, point.y, { button: 'none' })
  }

  async press(key, modifiers = []) {
    const definition = keys[key] ?? {
      code: key,
      keyCode: key.toUpperCase().charCodeAt(0),
      text: key
    }
    const bits = modifiers.reduce((sum, name) => sum | modifierBits[name], 0)
    const text =
      bits & (modifierBits.ctrl | modifierBits.meta | modifierBits.alt)
        ? undefined
        : definition.text
    await this.cdp.send('Input.dispatchKeyEvent', {
      type: text ? 'keyDown' : 'rawKeyDown',
      key,
      code: definition.code,
      windowsVirtualKeyCode: definition.keyCode,
      nativeVirtualKeyCode: definition.keyCode,
      modifiers: bits,
      ...(text ? { text, unmodifiedText: text } : {})
    })
    await this.cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code: definition.code,
      windowsVirtualKeyCode: definition.keyCode,
      nativeVirtualKeyCode: definition.keyCode,
      modifiers: bits
    })
  }

  async type(text) {
    await this.cdp.send('Input.insertText', { text })
  }

  /** Replace the composer text the way a user would: select all, then type. */
  async fillComposer(text) {
    await this.click('#message-input', { scroll: false })
    await this.press('a', ['ctrl'])
    await this.press('Backspace')
    if (text) await this.type(text)
  }

  async wheel(selector, deltaY, { steps = 1, interval = 16 } = {}) {
    const point = await this.center(selector, { scroll: false })
    for (let step = 0; step < steps; step++) {
      await this.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: point.x,
        y: point.y,
        deltaX: 0,
        deltaY
      })
      if (interval) await sleep(interval)
    }
  }

  async screenshot(name) {
    if (!this.artifacts) return null
    fs.mkdirSync(this.artifacts, { recursive: true })
    const file = `${this.artifacts}/${name.replace(/[^a-z0-9._-]+/gi, '-')}.png`
    try {
      const shot = await this.cdp.send('Page.captureScreenshot', { format: 'png' }, 5000)
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
      return file
    } catch {
      return null
    }
  }

  startRecording(tracksSource = 'null') {
    return this.cdp.evaluate(`window.__e2e.start(${tracksSource}); true`)
  }

  stopRecording() {
    return this.cdp.evaluate(`window.__e2e.stop()`)
  }

  frames(count = 2) {
    return this.cdp.evaluate(`window.__e2e.nextFrames(${count})`)
  }

  async startProfile() {
    await this.cdp.send('Profiler.enable')
    await this.cdp.send('Profiler.setSamplingInterval', { interval: 500 })
    await this.cdp.send('Profiler.start')
  }

  /** Stop profiling; save the profile and return the top functions by self time. */
  async stopProfile(name) {
    const { profile } = await this.cdp.send('Profiler.stop')
    if (this.artifacts) {
      fs.mkdirSync(this.artifacts, { recursive: true })
      fs.writeFileSync(`${this.artifacts}/${name.replace(/[^a-z0-9._-]+/gi, '-')}.cpuprofile`, JSON.stringify(profile))
    }
    const self = new Map()
    const byId = new Map(profile.nodes.map((node) => [node.id, node]))
    for (let index = 0; index < profile.samples.length; index++) {
      const node = byId.get(profile.samples[index])
      const frame = node.callFrame
      if (frame.functionName === '(idle)' || frame.functionName === '(program)') continue
      const key = `${frame.functionName || '(anonymous)'} ${frame.url.split('/').pop()}:${frame.lineNumber + 1}`
      self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[index] ?? 0))
    }
    return [...self]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([key, micros]) => `${Math.round(micros / 1000)}ms ${key}`)
  }

  async pageErrors() {
    return this.cdp.evaluate(`window.__e2e ? window.__e2e.state.errors.splice(0) : []`)
  }
}

module.exports = { Page }
