// Long transcripts: each provider's CLI writes real history (many turns, many tools, nested
// subagents); Sele is restarted and must open and scroll it instantly and without jumps.
const assert = require('node:assert/strict')
const { sleep } = require('../harness.cjs')
const { budgets } = require('../runner.cjs')
const { frames, reportJumps } = require('../analysis.cjs')
const { createLongTranscripts } = require('../transcripts.cjs')

const turns = Number(process.env.SELE_E2E_LONG_TURNS ?? 40)

/** Scroll with real wheel events until `done` holds; records frames and the top visible turn. */
async function wheelUntil(sele, deltaY, done, { maxSteps = 600 } = {}) {
  const page = sele.page
  await page.startRecording(sele.trackTopTurn())
  let steps = 0
  while (steps < maxSteps && !(await page.eval(done))) {
    await page.wheel('#chat-search-content', deltaY, { steps: 5, interval: 16 })
    steps += 5
  }
  await sleep(400)
  const recording = await page.stopRecording()
  return { recording, steps, reached: await page.eval(done) }
}

module.exports = async function transcripts(session) {
  const { runner, providers, env, dirs, executables } = session
  let created = {}

  await runner.check(`[transcripts] providers write ${turns}-turn histories`, async (context) => {
    const started = Date.now()
    const result = await createLongTranscripts({
      env,
      executables,
      cwd: dirs.work,
      providers,
      turns,
      log: (line) => context.note(line)
    })
    created = result.created
    context.metric('generationSeconds', Math.round((Date.now() - started) / 1000))
    for (const [provider, error] of Object.entries(result.errors))
      context.fail(`${provider}: ${error.message.slice(0, 800)}`)
  })

  await runner.check('[transcripts] Sele restarts with long histories', async (context) => {
    const started = Date.now()
    await session.launch()
    context.metric('restartMs', Date.now() - started)
  })

  for (const provider of providers) {
    const transcript = created[provider]
    const name = (check) => `[${provider}] long transcript: ${check}`
    if (!transcript) {
      runner.skip(name('open and scroll'), 'history was not generated')
      continue
    }
    const { sele, page } = session
    const first = `${transcript.marker} turn 0 `
    const last = `${transcript.marker} turn ${transcript.turns - 1} `
    let chatId = null

    await runner.check(name('appears in the sidebar'), async () => {
      chatId = await page.waitFor(
        `window.__sele.chatRows().find(row => row.title.includes(${JSON.stringify(transcript.marker)}))?.id ?? null`,
        { timeout: 30000, message: 'long chat is not listed' }
      )
    })
    if (!chatId) continue

    await runner.check(name('opens instantly at the latest turn'), async (context) => {
      await page.startProfile()
      await page.startRecording()
      const openMs = await page.latency(
        () => sele.selectChat(chatId),
        `window.__sele.selectedChatId() === ${JSON.stringify(chatId)} && window.__sele.hasText(${JSON.stringify(last.trim())})`,
        { timeout: 20000, message: 'latest turn did not render' }
      )
      // Never an empty transcript without a loader while history loads.
      await sleep(500)
      const recording = await page.stopRecording()
      const hot = await page.stopProfile(`${provider}-open`)
      context.metric('openMs', openMs, budgets.historyOpen)
      frames(context, recording)
      if (recording.maxFrame > budgets.maxFrame) context.note(`main thread while opening: ${hot.join(' | ')}`)
      assert.ok(await page.eval('window.__sele.atBottom()'), 'opened at the bottom')
      assert.ok(
        !(await sele.q(`window.__sele.hasText(${JSON.stringify(first.trim() + ' #')})`)) ||
          transcript.turns <= 20,
        'opens without rendering the whole history'
      )
    })

    await runner.check(name('scrolls up through all history without jumps'), async (context) => {
      const { recording, steps, reached } = await wheelUntil(
        sele,
        -240,
        `window.__sele.hasText(${JSON.stringify(first.trim())}) && window.__sele.scroller().scrollTop <= 1`
      )
      assert.ok(reached, `did not reach the first turn after ${steps} wheel steps`)
      context.metric('wheelSteps', steps)
      frames(context, recording)
      // Scrolling up, content only moves down; older pages must not shift what is visible.
      reportJumps(context, recording.tracks?.[0], 'down', { maxStep: 1500 })
    })

    await runner.check(name('nested tools expand and collapse smoothly'), async (context) => {
      const step = `([...window.__sele.scroller().querySelectorAll('details.chat-detail__working, details.chat-detail__tool-sequence')].find(window.__sele.visible))`
      const hasStep = await page.eval(`Boolean(${step})`)
      if (!hasStep) return context.note('no tool disclosure is visible at the top of history')
      for (let round = 0; round < 3; round++) {
        await page.startRecording(sele.trackTopTurn())
        const before = await page.eval(`${step}.open`)
        await page.click(`(${step}.querySelector('summary'))`)
        await page.waitFor(`${step}.open === ${!before}`, { message: 'disclosure did not toggle' })
        await sleep(300)
        const recording = await page.stopRecording()
        frames(context, recording, `toggle${round}.`)
      }
    })

    await runner.check(name('scrolls down to the latest turn without jumps'), async (context) => {
      const { recording, steps, reached } = await wheelUntil(
        sele,
        240,
        `window.__sele.hasText(${JSON.stringify(last.trim())}) && window.__sele.atBottom()`
      )
      assert.ok(reached, `did not reach the latest turn after ${steps} wheel steps`)
      frames(context, recording)
      reportJumps(context, recording.tracks?.[0], 'up', { maxStep: 1500 })
    })

    await runner.check(name('continues the conversation after reload'), async () => {
      const marker = `${transcript.marker} resumed`
      await sele.send(marker)
      await sele.waitForReply(marker, { timeout: 60000 })
      await sele.waitIdle()
      assert.ok(await page.eval('window.__sele.atBottom()'), 'stays at the bottom after the reply')
    })
  }

  await runner.check('[transcripts] switching between long chats', async (context) => {
    const ids = await session.page.eval(
      `window.__sele.chatRows().filter(row => /^long-/.test(row.title)).map(row => row.id)`
    )
    if (ids.length < 2) return context.note('needs two long chats')
    const samples = []
    await session.page.startRecording()
    for (let round = 0; round < 4; round++)
      for (const id of ids)
        samples.push(
          await session.page.latency(
            () => session.sele.selectChat(id),
            `window.__sele.selectedChatId() === ${JSON.stringify(id)} && document.querySelectorAll('#chat-search-content [data-chat-turn-id]').length > 0 && !document.querySelector('[role="status"][aria-label="Loading messages"]')`,
            { timeout: 10000 }
          )
        )
    const recording = await session.page.stopRecording()
    frames(context, recording)
    samples.sort((a, b) => a - b)
    context.metric('switchP95', samples[Math.floor(samples.length * 0.95)], budgets.chatContent)
  })
}
