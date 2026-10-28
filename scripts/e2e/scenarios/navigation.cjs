// Sidebar behaviour with many real chats: fast switching while turns run, search, Done.
const assert = require('node:assert/strict')
const { sleep } = require('../harness.cjs')
const { budgets } = require('../runner.cjs')
const { frames } = require('../analysis.cjs')

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
}

/** Click a chat row and measure selection and content latency. */
async function openChat(sele, chat) {
  const page = sele.page
  const selected = `window.__sele.selectedChatId() === ${JSON.stringify(chat.id)}`
  const content = `${selected} && window.__sele.hasText(${JSON.stringify(chat.marker)})`
  await page.eval('window.__e2eSwitchStart = performance.now(); true')
  await sele.selectChat(chat.id)
  await page.waitFor(selected, { timeout: 5000, message: `${chat.marker} was not selected` })
  const selectMs = await page.eval('Math.round(performance.now() - window.__e2eSwitchStart)')
  await page.waitFor(content, { timeout: 10000, message: `${chat.marker} content did not appear` })
  const contentMs = await page.eval('Math.round(performance.now() - window.__e2eSwitchStart)')
  return { selectMs, contentMs }
}

module.exports = async function navigation({ runner, sele, page, mock, providers }) {
  const tag = `nav${Date.now().toString(36).slice(-4)}`
  const chats = []
  const chatCount = Math.max(providers.length * 2, Number(process.env.SELE_E2E_CHAT_COUNT) || 0)

  await runner.check('[navigation] start working chats on every provider', async () => {
    for (let index = 0; index < chatCount; index++) {
      const provider = providers[index % providers.length]
      const marker = `${tag}-${provider}-${index}`
      // Each chat keeps working (streaming tool calls) until released.
      const id = await sele.startChat(provider, `${marker} #hold ${marker}`)
      await sele.waitActive()
      chats.push({ id, provider, marker })
    }
    assert.equal(chats.length, chatCount)
  })

  await runner.check('[navigation] typing while chats work', async (context) => {
    assert.equal(chats.length, chatCount)
    await page.startRecording()
    const text = 'Typing while other providers run.'
    for (const provider of providers) {
      await openChat(
        sele,
        chats.find((chat) => chat.provider === provider)
      )
      await page.fillComposer('')
      const latencies = []
      for (const char of text) {
        const start = performance.now()
        await page.cdp.send('Input.dispatchKeyEvent', { type: 'char', text: char })
        await page.eval('new Promise(resolve=>requestAnimationFrame(resolve))')
        latencies.push(performance.now() - start)
        await sleep(20)
      }
      assert.equal(await page.eval('window.__sele.composer().value'), text)
      assert.equal(await page.eval('document.activeElement === window.__sele.composer()'), true)
      context.metric(
        `${provider}.typingP95`,
        Math.round(percentile(latencies, 0.95)),
        budgets.p95Frame
      )
      context.metric(`${provider}.typingMax`, Math.round(Math.max(...latencies)), budgets.maxFrame)
      await page.fillComposer('')
    }
    frames(context, await page.stopRecording())
    context.metric('workingChats', chats.length)
  })

  await runner.check('[navigation] switching chats fast while they work', async (context) => {
    assert.ok(chats.length >= 2, 'needs working chats')
    const samples = []
    await page.startRecording()
    // Rapid clicks without waiting: the last click must win and nothing may break.
    for (let round = 0; round < 3; round++)
      for (const chat of [...chats].reverse()) {
        await sele.selectChat(chat.id)
        await sleep(40)
      }
    const last = chats[0]
    await page.waitFor(
      `window.__sele.selectedChatId() === ${JSON.stringify(last.id)} && window.__sele.hasText(${JSON.stringify(last.marker)})`,
      {
        timeout: 10000,
        message: 'the last clicked chat did not end up displayed'
      }
    )
    // Then deliberate switches, each measured.
    for (let round = 0; round < 3; round++)
      for (const chat of chats) samples.push(await openChat(sele, chat))
    const recording = await page.stopRecording()
    frames(context, recording)
    context.metric(
      'switchSelectP95',
      percentile(
        samples.map((sample) => sample.selectMs),
        0.95
      ),
      budgets.chatSwitch
    )
    context.metric(
      'switchContentP95',
      percentile(
        samples.map((sample) => sample.contentMs),
        0.95
      ),
      budgets.chatContent
    )
    context.metric('switchContentMax', Math.max(...samples.map((sample) => sample.contentMs)))
    // Only the selected chat's transcript is shown.
    for (const chat of chats.slice(0, 2)) {
      await openChat(sele, chat)
      await sleep(300)
      const foreign = chats.filter((other) => other !== chat).filter((other) => other.marker)
      for (const other of foreign)
        assert.ok(
          !(await sele.q(`window.__sele.hasText(${JSON.stringify(other.marker + ' ')})`)),
          `${other.marker} leaked into ${chat.marker}`
        )
    }
  })

  await runner.check('[navigation] working chats finish correctly after switching', async () => {
    for (const chat of chats) mock.release(chat.marker)
    for (const chat of chats) {
      await openChat(sele, chat)
      await sele.waitForReply(chat.marker, { timeout: 60000 })
      await sele.waitIdle()
      assert.equal(
        await sele.q(`window.__sele.replyCount(${JSON.stringify(chat.marker)})`),
        1,
        `${chat.marker} answered once`
      )
    }
  })

  await runner.check('[navigation] search chats', async (context) => {
    const target = chats.at(-1)
    await page.click(`(window.__sele.byLabel('Search conversations'))`)
    await page.waitFor(`document.querySelector('#chat-search') === document.activeElement`, {
      message: 'search did not focus'
    })
    const filtered = `(() => { const rows = window.__sele.chatRows(); return rows.length > 0 && rows.every(row => row.title.toLowerCase().includes(${JSON.stringify(target.marker.toLowerCase())})) && rows.some(row => row.id === ${JSON.stringify(target.id)}) })()`
    const filterMs = await page.latency(() => page.type(target.marker), filtered, {
      message: 'search did not filter to the chat'
    })
    context.metric('searchFilter', filterMs, budgets.searchFilter)
    await page.press('a', ['ctrl'])
    const emptyMs = await page.latency(
      () => page.type(`${tag}-no-such-chat`),
      `document.querySelector('aside[aria-label="Recent conversations"]').innerText.includes('No matching chats.')`,
      { message: 'no-match state did not appear' }
    )
    context.metric('searchEmpty', emptyMs, budgets.searchFilter)
    await page.press('a', ['ctrl'])
    await page.type(target.marker)
    await page.waitFor(filtered, { message: 'search did not filter again' })
    await sele.selectChat(target.id)
    await page.waitFor(
      `window.__sele.selectedChatId() === ${JSON.stringify(target.id)} && !document.querySelector('#chat-search')`,
      {
        message: 'selecting a result did not open it and close search'
      }
    )
    assert.ok(
      await sele.q(`window.__sele.chatRows().length >= ${chats.length}`),
      'full list returns after search'
    )
  })

  await runner.check('[navigation] expand and collapse Done', async (context) => {
    const done = chats.slice(0, Math.min(3, chats.length))
    for (const chat of done) {
      await page.hover(`(window.__sele.chatRow(${JSON.stringify(chat.id)}))`)
      await page.click(
        `(window.__sele.chatRow(${JSON.stringify(chat.id)})?.querySelector('[aria-label="Mark chat done"]'))`
      )
      await page.waitFor(
        `!window.__sele.chatRow(${JSON.stringify(chat.id)}) || window.__sele.group('done')?.contains(window.__sele.chatRow(${JSON.stringify(chat.id)}))`,
        {
          message: `${chat.marker} did not move to Done`
        }
      )
    }
    const toggle = `(window.__sele.group('done')?.querySelector('[aria-expanded]'))`
    await page.waitFor(toggle, { message: 'Done group did not appear' })
    const open = `${toggle}?.getAttribute('aria-expanded') === 'true'`
    if (await sele.q(open)) await page.click(toggle)
    await page.waitFor(`!(${open})`)
    const doneVisible = done
      .map((chat) => `window.__sele.visible(window.__sele.chatRow(${JSON.stringify(chat.id)}))`)
      .join(' && ')
    const expand = []
    const collapse = []
    await page.startRecording()
    for (let round = 0; round < 5; round++) {
      expand.push(
        await page.latency(() => page.click(toggle), `${open} && ${doneVisible}`, {
          message: 'Done did not expand'
        })
      )
      await sleep(250)
      collapse.push(
        await page.latency(
          () => page.click(toggle),
          `!(${open}) && !window.__sele.visible(window.__sele.chatRow(${JSON.stringify(done[0].id)}))`,
          {
            message: 'Done did not collapse'
          }
        )
      )
      await sleep(250)
    }
    const recording = await page.stopRecording()
    frames(context, recording)
    context.metric('doneExpandMax', Math.max(...expand), budgets.doneToggle)
    context.metric('doneCollapseMax', Math.max(...collapse), budgets.doneToggle)
    // Restore one chat from Done.
    await page.click(toggle)
    await page.waitFor(`${open} && ${doneVisible}`)
    const restored = done[0]
    await page.hover(`(window.__sele.chatRow(${JSON.stringify(restored.id)}))`)
    await page.click(
      `(window.__sele.chatRow(${JSON.stringify(restored.id)})?.querySelector('[aria-label="Mark chat not done"]'))`
    )
    await page.waitFor(
      `window.__sele.chatRow(${JSON.stringify(restored.id)}) && !window.__sele.group('done')?.contains(window.__sele.chatRow(${JSON.stringify(restored.id)}))`,
      {
        message: 'chat did not leave Done'
      }
    )
  })
}
