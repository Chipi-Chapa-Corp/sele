// Minimal check runner: isolates failures, captures errors and screenshots, records metrics.
const fs = require('node:fs')
const path = require('node:path')

// Performance budgets in milliseconds. SELE_E2E_BUDGET_SCALE relaxes them on slow machines.
const scale = Number(process.env.SELE_E2E_BUDGET_SCALE ?? 1)
const budgets = Object.fromEntries(
  Object.entries({
    // User actions with local results must feel instant.
    messageVisible: 200,
    pendingVisible: 200,
    composerAccepts: 300,
    chatSwitch: 300,
    chatContent: 500,
    searchFilter: 300,
    doneToggle: 300,
    editOpen: 500,
    // Long chats from disk.
    historyOpen: 2500,
    // Frame pacing while interacting. Software rendering in Xvfb is slower than a GPU.
    maxFrame: 120,
    p95Frame: 50,
    maxLongTask: 150,
    slowFrameRatio: 0.1
  }).map(([key, value]) => [
    key,
    key === 'slowFrameRatio' ? value * scale : Math.round(value * scale)
  ])
)

// Failures that come from the scripted environment rather than from Sele's behaviour.
const environmentalErrors = [
  // API-key Codex has no ChatGPT plan, so it has no rate limits to read.
  /codex account authentication required to read rate limits/,
  // Copilot runs bring-your-own-key and offline: GitHub quota and catalog calls are unauthenticated.
  /account\.getQuota failed with message: Not authenticated/,
  /models\.list failed with message: Not authenticated/,
  /OpenCode Go API key not found/,
  // The harness hides the toolbox host bridge on purpose.
  /Command failed: distrobox-host-exec/,
  /Container probe failed/
]

// Main-process lines that indicate a real failure.
const mainErrorPattern =
  /Error occurred in handler for|Unhandled|uncaught|\[caught:|Unable to |failed:|TypeError|ReferenceError|RangeError/i
const mainNoise =
  /zygote|gpu_process|GPU process|viz_main|dbus\/bus\.cc|network_service|interface_endpoint_client|DevTools listening|ERROR:.*(sandbox|egl|gl_)|Provider availability command failed/

class MainLog {
  constructor(file) {
    this.file = file
    this.offset = 0
  }

  /** New error-looking lines since the last call, grouped with their stack frames. */
  take() {
    let text = ''
    try {
      const size = fs.statSync(this.file).size
      if (size <= this.offset) return []
      const fd = fs.openSync(this.file, 'r')
      const buffer = Buffer.alloc(size - this.offset)
      fs.readSync(fd, buffer, 0, buffer.length, this.offset)
      fs.closeSync(fd)
      this.offset = size
      text = buffer.toString('utf8')
    } catch {
      return []
    }
    const entries = []
    for (const line of text.split('\n')) {
      if (/^\s+at |^\s*[}{]|^\s+\w+: /.test(line) && entries.length) {
        entries[entries.length - 1] += '\n' + line
        continue
      }
      if (line.trim()) entries.push(line)
    }
    return entries.filter(
      (entry) => mainErrorPattern.test(entry.split('\n')[0]) && !mainNoise.test(entry)
    )
  }
}

const isEnvironmental = (message) => environmentalErrors.some((pattern) => pattern.test(message))

class Runner {
  constructor({ artifacts, filter = null, page = null, mainLog = null }) {
    this.artifacts = artifacts
    this.filter = filter
    this.page = page
    this.mainLog = mainLog
    this.results = []
    this.environmental = new Map()
  }

  attach(page, mainLog) {
    this.page = page
    this.mainLog = mainLog
  }

  /** Called when the renderer stopped responding; should restart the app. */
  onFrozen(handler) {
    this.frozenHandler = handler
  }

  /** Collect new renderer and main-process errors; environmental ones are only counted. */
  async drainErrors() {
    const errors = []
    if (this.page) {
      errors.push(...this.page.consoleErrors.splice(0).map((message) => 'renderer: ' + message))
      errors.push(
        ...(await this.page.pageErrors().catch(() => [])).map((message) => 'page: ' + message)
      )
    }
    if (this.mainLog) errors.push(...this.mainLog.take().map((message) => 'main: ' + message))
    return errors.filter((message) => {
      if (!isEnvironmental(message)) return true
      const key = environmentalErrors.find((pattern) => pattern.test(message)).source
      this.environmental.set(key, (this.environmental.get(key) ?? 0) + 1)
      return false
    })
  }

  selected(name) {
    return (
      !this.filter ||
      this.filter.some((pattern) => name.toLowerCase().includes(pattern.toLowerCase()))
    )
  }

  /**
   * Run one check. `fn` receives a context with `metric(name, value, budget)` and `note(text)`.
   * A check fails on an exception, an exceeded budget, or any unexpected error logged meanwhile.
   */
  async check(name, fn) {
    if (!this.selected(name)) return null
    const started = Date.now()
    const result = { name, status: 'passed', durationMs: 0, metrics: {}, notes: [], failures: [] }
    await this.drainErrors()
    const context = {
      metric: (key, value, budget) => {
        result.metrics[key] = budget === undefined ? value : { value, budget }
        if (budget !== undefined && value > budget)
          result.failures.push(`${key} ${value} exceeds budget ${budget}`)
      },
      note: (text) => result.notes.push(text),
      fail: (text) => result.failures.push(text)
    }
    process.stdout.write(`▶ ${name}\n`)
    try {
      await fn(context)
    } catch (error) {
      result.failures.push(
        String(error?.stack ?? error)
          .split('\n')
          .slice(0, 4)
          .join('\n')
      )
    }
    // A frozen main thread is the worst kind of lag: diagnose it, then recover for later checks.
    if (result.failures.length && this.page && !(await this.page.cdp.responsive())) {
      const stack = await this.page.cdp.captureStack().catch(() => null)
      result.failures.push(
        'renderer main thread is frozen' +
          (stack ? ':\n' + stack.join('\n') : ' (no stack: pause did not land)')
      )
      result.screenshot = await this.page.screenshot(name).catch(() => null)
      if (this.frozenHandler)
        await this.frozenHandler().catch((error) =>
          result.failures.push('restart failed: ' + error.message)
        )
    }
    const errors = await this.drainErrors()
    if (errors.length)
      result.failures.push(...errors.map((error) => 'logged error: ' + error.slice(0, 1500)))
    result.durationMs = Date.now() - started
    if (result.failures.length) {
      result.status = 'failed'
      result.screenshot ??= await this.page?.screenshot(name).catch(() => null)
    }
    this.results.push(result)
    const metrics = Object.entries(result.metrics)
      .map(
        ([key, value]) =>
          `${key}=${typeof value === 'object' ? `${value.value}/${value.budget}` : JSON.stringify(value)}`
      )
      .join(' ')
    process.stdout.write(
      `${result.status === 'passed' ? '✔' : '✘'} ${name} (${result.durationMs}ms)${metrics ? ' ' + metrics : ''}\n` +
        result.notes.map((note) => `    · ${note}\n`).join('') +
        result.failures.map((failure) => `    ✘ ${failure.replace(/\n/g, '\n      ')}\n`).join('')
    )
    return result
  }

  skip(name, reason) {
    if (!this.selected(name)) return
    this.results.push({ name, status: 'skipped', reason })
    process.stdout.write(`○ ${name}: ${reason}\n`)
  }

  write() {
    fs.mkdirSync(this.artifacts, { recursive: true })
    const report = {
      finishedAt: new Date().toISOString(),
      budgets,
      environmentalErrors: Object.fromEntries(this.environmental),
      results: this.results
    }
    fs.writeFileSync(path.join(this.artifacts, 'report.json'), JSON.stringify(report, null, 2))
    const passed = this.results.filter((result) => result.status === 'passed').length
    const failed = this.results.filter((result) => result.status === 'failed')
    const skipped = this.results.filter((result) => result.status === 'skipped').length
    process.stdout.write(
      `\n${passed} passed, ${failed.length} failed, ${skipped} skipped\n` +
        failed.map((result) => `  ✘ ${result.name}\n`).join('') +
        (this.environmental.size
          ? `Ignored environmental errors: ${[...this.environmental].map(([key, count]) => `${key} ×${count}`).join(', ')}\n`
          : '') +
        `Report: ${path.join(this.artifacts, 'report.json')}\n`
    )
    return failed.length === 0
  }
}

module.exports = { Runner, MainLog, budgets }
