// Queue, steer and pending-message editing against each real provider.
// The model server records which user messages reached the model, which is the ground truth
// for "edited messages are locked": an original text that was edited must never arrive.
const assert = require('node:assert/strict')
const { sleep } = require('../harness.cjs')
const { budgets } = require('../runner.cjs')
const { frames, reportJumps } = require('../analysis.cjs')

let sequence = 0

function scenarioTools({ sele, page, mock, provider, context }) {
  const tag = `m${(++sequence).toString(36)}${provider.slice(0, 2)}${Date.now().toString(36).slice(-3)}`
  const token = (name) => `${tag}-${name}`
  const holds = []
  const pattern = new RegExp(`\\b${tag}-([A-Za-z0-9]+)\\b`, 'g')
  const deliveredNames = () => {
    const names = []
    for (const { text } of mock.delivered())
      for (const match of text.matchAll(pattern))
        if (!names.includes(match[1])) names.push(match[1])
    return names
  }
  const tools = {
    tag,
    token,
    deliveredNames,
    /** Start a chat whose first turn keeps running until released. */
    async startHeld(extra = '') {
      holds.push(tag)
      await sele.startChat(provider, `${token('H')} #hold ${tag} ${extra}`.trim())
      await sele.waitActive()
      await tools.waitDelivered(['H'])
    },
    release() {
      mock.release(tag)
    },
    async waitDelivered(names, timeout = 30000) {
      const deadline = Date.now() + timeout
      while (!names.every((name) => deliveredNames().includes(name))) {
        if (Date.now() > deadline)
          throw new Error(
            `Expected ${names.join(', ')} to reach the model; delivered: ${deliveredNames().join(', ')}`
          )
        await sleep(50)
      }
    },
    assertNotDelivered(names, why) {
      const leaked = names.filter((name) => deliveredNames().includes(name))
      assert.deepEqual(leaked, [], `${leaked.join(', ')} reached the model ${why}`)
    },
    /** Assert delivery order of the named messages (others may interleave). */
    assertOrder(names) {
      const order = deliveredNames().filter((name) => names.includes(name))
      assert.deepEqual(order, names, `delivery order`)
    },
    async queue(name, { budget = true } = {}) {
      const text = token(name)
      const acceptMs = await sele.send(text)
      const visibleMs = await page.latency(
        async () => {},
        `window.__sele.pending().some(message => message.text.includes(${JSON.stringify(text)})) || window.__sele.messages().some(message => !message.pending && message.text.includes(${JSON.stringify(text)}))`,
        { message: `Queued "${text}" did not appear` }
      )
      if (budget)
        context.metric(
          `pendingVisible.${name}`,
          acceptMs + visibleMs,
          budgets.pendingVisible + budgets.composerAccepts
        )
      return text
    },
    editPending(name, kind) {
      return sele.editPending(name, kind)
    },
    async steer(name) {
      const text = token(name)
      await sele.send(text, { steer: true })
      return text
    },
    async waitReply(name, timeout = 60000) {
      await sele.waitForReply(token(name), { timeout })
    },
    /** Pending rows of this scenario, in display order, as names. */
    async pendingNames() {
      return (await sele.pending()).flatMap((message) =>
        [...message.text.matchAll(pattern)].map((match) => match[1])
      )
    },
    /** User messages in the transcript, in order. */
    async transcriptNames() {
      return (await sele.messages())
        .filter((message) => message.role === 'user' && !message.pending)
        .flatMap((message) => [...message.text.matchAll(pattern)].map((match) => match[1]))
    },
    async settle() {
      await sele.waitIdle({ timeout: 60000 })
      await sleep(300)
      assert.deepEqual(await tools.pendingNames(), [], 'no pending messages remain')
    },
    cleanup() {
      for (const hold of holds) mock.release(hold)
    }
  }
  return tools
}

/** After the held turn ends, give the provider time it would need to (wrongly) drain more. */
async function afterTurn(t, name = 'H') {
  await t.waitReply(name)
  await sleep(2500)
}

const scenarios = [
  {
    name: 'queue messages are delivered once, in order, after the turn',
    async run(t, { sele, page, context }) {
      await t.startHeld()
      const lastId = (await sele.messages()).at(-1)?.id
      await page.startRecording(sele.trackMessage(lastId))
      for (const name of ['A', 'B', 'C']) await t.queue(name)
      const recording = await page.stopRecording()
      frames(context, recording, 'queue.')
      // Queued rows join the bottom; earlier content may only move up, never bounce.
      const problems = reportJumps(context, recording.tracks?.[0], 'up', {}, 'sendJumps')
      if (problems.length)
        context.note(
          'track: ' +
            JSON.stringify(
              recording.tracks[0].map((sample) => [
                Math.round(sample.top),
                Math.round(sample.scrollTop),
                sample.scrollHeight,
                sample.clientHeight,
                sample.turns,
                sample.pending
              ])
            )
        )
      assert.ok(
        await page.eval('window.__sele.atBottom()'),
        'conversation stays pinned to the bottom'
      )
      assert.deepEqual(
        await t.pendingNames(),
        ['A', 'B', 'C'],
        'pending rows keep submission order'
      )
      t.assertNotDelivered(['A', 'B', 'C'], 'while the turn was still running')
      t.release()
      for (const name of ['A', 'B', 'C']) await t.waitReply(name)
      t.assertOrder(['H', 'A', 'B', 'C'])
      await t.settle()
      assert.deepEqual(await t.transcriptNames(), ['H', 'A', 'B', 'C'])
    }
  },
  {
    name: 'composer accepts a queued message immediately after sending',
    async run(t, { sele, context }) {
      await t.startHeld()
      // Send twice in quick succession, as a user typing ahead would.
      await sele.send(t.token('A'))
      await sele.page.fillComposer(t.token('B'))
      const started = Date.now()
      await sele.page.press('Enter')
      const accepted = await sele.page
        .waitFor(`window.__sele.composer()?.value === ''`, { timeout: 3000 })
        .then(() => Date.now() - started)
        .catch(() => null)
      context.metric('composerAccepts', accepted ?? 3000, budgets.composerAccepts)
      if (accepted === null) {
        context.note('first Enter was ignored while the previous send was in flight')
        await sele.send(t.token('B'))
      }
      t.release()
      await t.waitReply('B')
      t.assertOrder(['H', 'A', 'B'])
      await t.settle()
    }
  },
  ...['first', 'middle', 'last'].map((position) => ({
    name: `editing the ${position} queued message locks it and its successors only`,
    async run(t, { sele, context }) {
      await t.startHeld()
      for (const name of ['A', 'B', 'C']) await t.queue(name, { budget: false })
      const edited = { first: 'A', middle: 'B', last: 'C' }[position]
      const names = ['A', 'B', 'C']
      const before = names.slice(0, names.indexOf(edited))
      const held = names.slice(names.indexOf(edited))
      context.metric('editOpen', await t.editPending(t.token(edited)), budgets.editOpen)
      t.release()
      await t.waitReply('H')
      for (const name of before) await t.waitReply(name)
      await sleep(2500)
      t.assertNotDelivered(held, `while ${edited} was being edited`)
      assert.deepEqual(await t.pendingNames(), held, 'edited and later messages stay pending')
      await sele.saveEdit(t.token(`${edited}2`))
      const expected = names.map((name) => (name === edited ? `${edited}2` : name))
      for (const name of expected) await t.waitReply(name)
      t.assertOrder(['H', ...expected])
      t.assertNotDelivered([edited], 'after being replaced by its edit')
      await t.settle()
      assert.deepEqual(await t.transcriptNames(), ['H', ...expected])
    }
  })),
  {
    name: 'queued edit saved before the turn ends waits for the turn',
    async run(t, { sele }) {
      await t.startHeld()
      for (const name of ['A', 'B']) await t.queue(name, { budget: false })
      await t.editPending(t.token('B'))
      await sele.saveEdit(t.token('B2'))
      await sleep(1000)
      t.assertNotDelivered(['A', 'B', 'B2'], 'before the running turn finished')
      assert.deepEqual(await t.pendingNames(), ['A', 'B2'])
      t.release()
      await t.waitReply('B2')
      t.assertOrder(['H', 'A', 'B2'])
      t.assertNotDelivered(['B'], 'after being replaced by its edit')
      await t.settle()
    }
  },
  {
    name: 'cancelling a queued edit releases the original messages',
    async run(t, { sele }) {
      await t.startHeld()
      for (const name of ['A', 'B']) await t.queue(name, { budget: false })
      await t.editPending(t.token('A'))
      t.release()
      await afterTurn(t)
      t.assertNotDelivered(['A', 'B'], 'while A was being edited')
      await sele.cancelEdit()
      await t.waitReply('B')
      t.assertOrder(['H', 'A', 'B'])
      await t.settle()
    }
  },
  {
    name: 'steer joins the running turn',
    async run(t, { sele, context }) {
      await t.startHeld()
      // Watch every frame: a steer must not end the turn or flash a reply in the middle of it.
      await sele.q(`(() => {
        const watch = window.__steerWatch = { stopped: 0, flashedReplies: new Set(), done: false }
        const deadline = performance.now() + 30000
        const tick = () => {
          if (watch.done || performance.now() > deadline) return
          if (!window.__sele.byLabel('Stop response')) watch.stopped++
          for (const message of window.__sele.messages())
            if (message.role === 'assistant' && message.text.includes(${JSON.stringify(t.token('S'))}) && !message.text.includes(${JSON.stringify(t.token('H'))}))
              watch.flashedReplies.add(message.text.slice(0, 80))
          requestAnimationFrame(tick)
        }
        tick()
        return true
      })()`)
      const started = Date.now()
      await t.steer('S')
      await t.waitDelivered(['S'], 20000)
      context.metric('steerDeliveredMs', Date.now() - started)
      await sleep(1500)
      const watch = await sele.q(
        `(() => { const watch = window.__steerWatch; watch.done = true; return { stopped: watch.stopped, flashed: [...watch.flashedReplies] } })()`
      )
      context.metric('framesWithoutRunningTurn', watch.stopped, 0)
      if (watch.flashed.length)
        context.fail(
          `a separate reply to the steer flashed mid-turn: ${JSON.stringify(watch.flashed)}`
        )
      t.release()
      await t.waitReply('H')
      assert.ok(
        await sele.q(`window.__sele.replyCount(${JSON.stringify(t.token('S'))}) > 0`),
        'the running turn answered the steering message'
      )
      t.assertOrder(['H', 'S'])
      await t.settle()
    }
  },
  {
    name: 'steer after queue overtakes the queue',
    async run(t) {
      await t.startHeld()
      await t.queue('A', { budget: false })
      await t.steer('S')
      await t.waitDelivered(['S'], 20000)
      t.assertNotDelivered(['A'], 'before the running turn finished')
      t.release()
      await t.waitReply('A')
      t.assertOrder(['H', 'S', 'A'])
      await t.settle()
    }
  },
  {
    name: 'steer before queue keeps the queue for the next turn',
    async run(t) {
      await t.startHeld()
      await t.steer('S')
      await t.queue('A', { budget: false })
      await t.waitDelivered(['S'], 20000)
      t.assertNotDelivered(['A'], 'before the running turn finished')
      t.release()
      await t.waitReply('A')
      t.assertOrder(['H', 'S', 'A'])
      await t.settle()
    }
  },
  {
    name: 'editing a steer before the turn ends locks it until saved',
    async run(t, { sele, context }) {
      // Slow tools keep the steering message pending long enough to start an edit.
      await t.startHeld('#slow 4000')
      await sleep(600)
      await t.steer('S')
      const editable = await sele.page
        .waitFor(sele.pendingButton(t.token('S'), 'Edit steering message'), { timeout: 2000 })
        .then(() => true)
        .catch(() => false)
      if (!editable) {
        // Some providers accept a steer immediately; then it must simply join the turn.
        context.note('steering message was accepted by the provider before it could be edited')
        t.release()
        await t.waitReply('H')
        await t.waitDelivered(['S'])
        await t.settle()
        return
      }
      let editMs
      try {
        editMs = await t.editPending(t.token('S'), 'steering')
      } catch (error) {
        // The provider may accept the steer between showing the button and the click.
        const stillEditable = await sele
          .q(
            `Boolean(${sele.pendingButton(t.token('S'), 'Edit steering message')}) && window.__sele.visible(${sele.pendingButton(t.token('S'), 'Edit steering message')})`
          )
          .catch(() => false)
        if (!stillEditable) {
          context.note('steering message was accepted while the edit was opening')
          t.release()
          await t.waitReply('H')
          await t.waitDelivered(['S'])
          await t.settle()
          return
        }
        throw error
      }
      context.metric('editOpen', editMs, budgets.editOpen)
      t.release()
      await afterTurn(t)
      t.assertNotDelivered(['S'], 'while the steering message was being edited')
      assert.equal(
        await sele.q(`window.__sele.replyCount(${JSON.stringify(t.token('S'))})`),
        0,
        'the finished turn did not answer the locked steer'
      )
      await sele.saveEdit(t.token('S2'))
      await t.waitReply('S2')
      t.assertNotDelivered(['S'], 'after being replaced by its edit')
      await t.settle()
    }
  },
  {
    name: 'queued message can be turned into a steer',
    async run(t, { sele }) {
      await t.startHeld()
      await t.queue('A', { budget: false })
      await t.queue('B', { budget: false })
      await sele.pendingAction(t.token('B'), 'Steer with queued message')
      await t.waitDelivered(['B'], 20000)
      t.assertNotDelivered(['A'], 'before the running turn finished')
      t.release()
      await t.waitReply('A')
      t.assertOrder(['H', 'B', 'A'])
      await t.settle()
    }
  }
]

module.exports = async function messaging({ runner, sele, page, mock, providers }) {
  for (const provider of providers) {
    for (const scenario of scenarios) {
      let tools
      await runner.check(`[${provider}] ${scenario.name}`, async (context) => {
        tools = scenarioTools({ sele, page, mock, provider, context })
        try {
          await scenario.run(tools, { sele, page, mock, provider, context })
        } finally {
          tools.cleanup()
          // Leave no edit session or running turn behind for the next scenario.
          if (await sele.q(`Boolean(window.__sele.byLabel('Save edit'))`).catch(() => false))
            await sele.cancelEdit().catch(() => {})
        }
      })
    }
  }
}

module.exports.scenarios = scenarios
