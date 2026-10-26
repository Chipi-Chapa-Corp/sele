// Passive capture for the user's running Sele instance. Does not launch an app,
// pause JavaScript, navigate, click, read message contents, or invoke provider APIs.
// Start dev with: npm run dev -- --remoteDebuggingPort 9333 --inspect 9334
// Then run: node scripts/diagnostics/profile-chat-navigation.cjs
const fs = require('node:fs/promises')
const path = require('node:path')
const { Cdp, sleep } = require('../e2e/harness.cjs')

async function evaluate(client, expression, timeoutMs) {
  const result = await client.send(
    'Runtime.evaluate',
    {
      expression,
      awaitPromise: true,
      returnByValue: true
    },
    timeoutMs
  )
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

function waitForClick() {
  return new Promise((resolve) => {
    const finish = (clicked) => {
      clearTimeout(timer)
      document.removeEventListener('click', clickedChat, true)
      resolve(clicked)
    }
    const clickedChat = (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          '.chat-list-item__main, button[aria-label="New chat"], button[aria-label="New chat without a project"]'
        )
      )
        finish(true)
    }
    const timer = setTimeout(() => finish(false), 180_000)
    document.addEventListener('click', clickedChat, true)
  })
}

async function connect(port, accept) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(3000)
  })
  const targets = (await response.json()).filter(accept)
  if (targets.length !== 1) throw new Error(`Expected one profiling target on port ${port}`)
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  return new Cdp(socket)
}

function installProbe() {
  if (window.__seleNavigationCapture) throw new Error('A navigation capture is already running')
  const start = performance.now()
  const data = { start, navigations: [], frameGaps: [], longTasks: [] }
  const marks = []
  let previous = start
  let frame
  const tick = () => {
    const now = performance.now()
    data.frameGaps.push({ start: previous - start, duration: now - previous })
    previous = now
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  const observer = new PerformanceObserver((list) => {
    data.longTasks.push(
      ...list.getEntries().map((entry) => ({
        start: entry.startTime - start,
        duration: entry.duration
      }))
    )
  })
  observer.observe({ type: 'longtask' })
  const onClick = (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest(
            '.chat-list-item__main, button[aria-label="New chat"], button[aria-label="New chat without a project"]'
          )
        : null
    if (!button) return
    const navigation = {
      start: performance.now() - start,
      destination: button.closest('[data-chat-id]')?.dataset.chatId ?? 'new',
      firstFrame: null
    }
    data.navigations.push(navigation)
    const mark = `sele:navigation:${data.navigations.length}`
    marks.push(mark)
    performance.mark(mark)
    requestAnimationFrame(() => {
      navigation.firstFrame = performance.now() - start
    })
  }
  document.addEventListener('click', onClick, true)
  window.__seleNavigationCapture = () => {
    cancelAnimationFrame(frame)
    observer.disconnect()
    document.removeEventListener('click', onClick, true)
    for (const mark of marks) performance.clearMarks(mark)
    delete window.__seleNavigationCapture
    return data
  }
}

async function capture({
  renderer,
  main = null,
  directory,
  durationMs = 20_000,
  trace = true,
  cpuProfiles = true,
  onReady = () => {}
}) {
  await fs.mkdir(directory, { recursive: true })
  let probeInstalled = false
  let tracing = false
  const profilers = []
  const failures = []
  let traceComplete
  const traceEnded = new Promise((resolve) => {
    traceComplete = resolve
  })
  const stopListening = renderer.on((message) => {
    if (message.method === 'Tracing.tracingComplete') traceComplete(message.params)
  })
  try {
    for (const [name, client] of cpuProfiles
      ? [
          ['renderer', renderer],
          ['main', main]
        ]
      : []) {
      if (!client) continue
      await client.send('Profiler.enable')
      await client.send('Profiler.start')
      profilers.push([name, client])
    }
    if (trace) {
      await renderer.send('Tracing.start', {
        categories:
          'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline.stack',
        transferMode: 'ReturnAsStream'
      })
      tracing = true
    }
    await evaluate(renderer, `(${installProbe.toString()})()`)
    probeInstalled = true
    await onReady()
    await sleep(durationMs)
  } catch (error) {
    failures.push(error)
  } finally {
    try {
      if (probeInstalled) {
        const observations = await evaluate(renderer, 'window.__seleNavigationCapture?.() ?? null')
        await fs.writeFile(path.join(directory, 'navigation.json'), JSON.stringify(observations))
      }
    } catch (error) {
      failures.push(error)
    }
    try {
      if (tracing) {
        await renderer.send('Tracing.end')
        let timeout
        const { stream } = await Promise.race([
          traceEnded,
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Timed out ending browser trace')), 10_000)
          })
        ]).finally(() => clearTimeout(timeout))
        const file = await fs.open(path.join(directory, 'browser.trace.json'), 'w')
        try {
          let chunk
          do {
            chunk = await renderer.send('IO.read', { handle: stream })
            await file.writeFile(
              chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : chunk.data
            )
          } while (!chunk.eof)
        } finally {
          await file.close()
          await renderer.send('IO.close', { handle: stream })
        }
      }
    } catch (error) {
      failures.push(error)
    } finally {
      stopListening()
      for (const [name, client] of profilers) {
        try {
          const { profile } = await client.send('Profiler.stop')
          await fs.writeFile(path.join(directory, `${name}.cpuprofile`), JSON.stringify(profile))
        } catch (error) {
          failures.push(error)
        } finally {
          await client.send('Profiler.disable').catch((error) => failures.push(error))
        }
      }
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'Unable to finish navigation capture')
}

async function run() {
  const args = process.argv.slice(2)
  const option = (name, fallback) => {
    const index = args.indexOf(name)
    return index < 0 ? fallback : args[index + 1]
  }
  const seconds = Number(option('--seconds', 20))
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 60)
    throw new Error('--seconds must be between 1 and 60')
  const directory = path.resolve(option('--output', `test-results/navigation-${Date.now()}`))
  const renderer = await connect(
    Number(option('--renderer-port', 9333)),
    (target) =>
      target.type === 'page' &&
      (/^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(target.url) ||
        /out\/renderer\/index\.html/.test(target.url))
  ).catch((error) => {
    throw new Error(
      'Sele profiling is unavailable. Restart dev with --remoteDebuggingPort 9333 --inspect 9334',
      { cause: error }
    )
  })
  let main = null
  try {
    main = await connect(Number(option('--main-port', 9334)), (target) => target.type === 'node')
    if (args.includes('--wait-for-click')) {
      console.log('Armed. Recording will start on your next chat click (waiting up to 3 minutes).')
      if (!(await evaluate(renderer, `(${waitForClick.toString()})()`, 185_000)))
        throw new Error('No chat click detected; no recording was started')
    }
    await capture({
      renderer,
      main,
      directory,
      trace: !args.includes('--no-trace'),
      durationMs: seconds * 1000,
      onReady: () => console.log(`Recording for ${seconds}s. Switch chats normally now.`)
    })
    console.log(`Saved navigation timings and CPU profiles to ${directory}`)
  } finally {
    renderer.close()
    main?.close()
  }
}

module.exports = { capture, waitForClick, connect, evaluate }
if (require.main === module)
  run().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
