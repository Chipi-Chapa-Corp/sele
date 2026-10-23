// Queued and steering messages survive quitting Sele in the middle of a turn.
// The model server records which user messages reached the model: restored messages must
// wait (paused, as after Stop) and must never be delivered twice.
const assert = require('node:assert/strict')
const { sleep } = require('../harness.cjs')
const { scenarioTools } = require('./messaging.cjs')

module.exports = async function persistence(session) {
  const { runner, mock, providers } = session
  for (const provider of providers) {
    let tools
    await runner
      .check(
        `[${provider}] queued messages survive a restart; delivered steering is not repeated`,
        async (context) => {
          const { sele, page } = session
          tools = scenarioTools({ sele, page, mock, provider, context })
          const t = tools
          await t.startHeld()
          const chatId = await sele.q('window.__sele.selectedChatId()')
          await t.queue('A', { budget: false })
          await t.queue('B', { budget: false })
          await t.steer('S')
          // The held turn keeps running tools, so the provider folds the steer into it.
          await t.waitDelivered(['S'], 30000)
          // Some providers list a steer until it is echoed back, shortly after the model got it.
          const settled = Date.now() + 15000
          while (JSON.stringify(await t.pendingNames()) !== '["A","B"]' && Date.now() < settled)
            await sleep(200)
          assert.deepEqual(await t.pendingNames(), ['A', 'B'], 'queue before quitting')
          if (provider === 'codex') {
            // Codex keeps the thread's writer when Sele quits mid-turn, so the thread cannot take
            // new turns after a restart, with or without a queue. Stop first; the queue persists.
            await sele.page.click(`(window.__sele.byLabel('Stop response'))`)
            await sele.page.waitFor(`!window.__sele.byLabel('Stop response')`, {
              timeout: 15000,
              message: 'Codex turn did not stop'
            })
          }

          await session.launch()
          const restarted = session.sele
          await restarted.selectChat(chatId)
          await session.page.waitFor(
            `window.__sele.pending().filter(message => message.text.includes(${JSON.stringify(t.tag)})).length >= 2`,
            { timeout: 30000, message: 'queued messages were not restored' }
          )
          const restoredTools = { ...t, ...scenarioToolsView(restarted, t) }
          assert.deepEqual(await restoredTools.pendingNames(), ['A', 'B'], 'restored queue')

          // Some providers keep running the interrupted turn after a restart. Let it finish:
          // restored messages still wait for the user instead of sending on their own.
          t.release()
          await sleep(5000)
          t.assertNotDelivered(['A', 'B'], 'after the restart without a new send')
          assert.deepEqual(await restoredTools.pendingNames(), ['A', 'B'], 'queue still waits')

          // Sending again resumes the queue in its original order, each message once.
          await restarted.send(t.token('C'))
          for (const name of ['A', 'B', 'C']) await restarted.waitForReply(t.token(name))
          t.assertOrder(['H', 'S', 'A', 'B', 'C'])
          await restarted.waitIdle({ timeout: 60000 })
          assert.deepEqual(await restoredTools.pendingNames(), [], 'no pending messages remain')
          // The model server records each text once, so count repeats in the transcript.
          const sent = await restoredTools.transcriptNames()
          for (const name of ['A', 'B', 'C'])
            assert.equal(sent.filter((entry) => entry === name).length, 1, `${name} sent once`)
          assert.ok(sent.filter((entry) => entry === 'S').length <= 1, 'steering sent once')
        }
      )
      .finally(() => tools?.cleanup())
  }
}

/** Pending rows from the relaunched app's page, using the scenario's message names. */
function scenarioToolsView(sele, t) {
  const pattern = new RegExp(`\\b${t.tag}-([A-Za-z0-9]+)\\b`, 'g')
  return {
    async pendingNames() {
      return (await sele.pending()).flatMap((message) =>
        [...message.text.matchAll(pattern)].map((match) => match[1])
      )
    },
    async transcriptNames() {
      return (await sele.messages())
        .filter((message) => message.role === 'user' && !message.pending)
        .flatMap((message) => [...message.text.matchAll(pattern)].map((match) => match[1]))
    }
  }
}
