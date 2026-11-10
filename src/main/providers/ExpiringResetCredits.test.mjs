import assert from 'node:assert/strict'
import test from 'node:test'
import { ExpiringResetCredits } from './ExpiringResetCredits.ts'

const now = Date.UTC(2026, 10, 7, 12)
const credit = (id = 'credit', expiresAt = now + 120_000) => ({ id, expiresAt })
const usage = (credits = [credit()], patch = {}) => ({
  authenticationRequired: false,
  rateLimits: [],
  rateLimitResetCredits: { availableCount: credits.length, credits },
  ...patch
})
const fixture = (overrides = {}) => {
  const prompts = []
  const resets = []
  const reads = []
  const dependencies = {
    sources: async () => [null],
    available: async () => true,
    accounts: async () => ({
      available: true,
      accounts: [{ id: 'work', displayName: 'Work', active: false }]
    }),
    usage: async (options) => {
      reads.push(options)
      return usage()
    },
    reset: async (options) => {
      resets.push(options)
      return 'reset'
    },
    prompt: async (...args) => {
      prompts.push(args)
      return true
    },
    ...overrides
  }
  return {
    monitor: new ExpiringResetCredits(dependencies, () => now),
    prompts,
    resets,
    reads
  }
}
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

test('skips accounts and usage when Codex is absent, and resumes when it becomes available', async (t) => {
  const errors = t.mock.method(console, 'error', () => {})
  const container = { kind: 'container', tool: 'ssh', name: 'remote' }
  let hostAvailable = false
  const inspected = []
  const { monitor, reads, resets } = fixture({
    sources: async () => [null, container],
    available: async (source) => source === container || hostAvailable,
    accounts: async (source) => {
      inspected.push(source)
      return { available: true, accounts: [{ id: 'work', active: true }] }
    }
  })
  await monitor.tick()
  await monitor.tick()
  assert.deepEqual(inspected, [container, container])
  assert.ok(reads.every((options) => options.container === container))
  assert.equal(errors.mock.callCount(), 0)

  hostAvailable = true
  await monitor.tick()
  assert.deepEqual(
    resets.map((options) => options.container),
    [container, null]
  )
  await monitor.close()
})

test('shutdown during provider discovery prevents account and usage checks', async () => {
  let resolveAvailable
  let inspections = 0
  const { monitor, reads } = fixture({
    available: () =>
      new Promise((resolve) => {
        resolveAvailable = resolve
      }),
    accounts: async () => {
      inspections++
      throw new Error('Unexpected account check')
    }
  })
  const pending = monitor.tick()
  await flush()
  const closing = monitor.close()
  resolveAvailable(true)
  await Promise.all([pending, closing])
  assert.equal(inspections, 0)
  assert.equal(reads.length, 0)
})

test('OK resets an inactive account explicitly without switching the selected account', async () => {
  const { monitor, prompts, resets, reads } = fixture()
  await monitor.tick()
  assert.equal(prompts[0][0], 'Work')
  assert.equal(prompts[0][1], 30_000)
  assert.deepEqual(resets, [{ accountId: 'work', container: null, forceRefresh: true }])
  assert.equal(reads.length, 2, 'refreshes the credit before consuming it')
  await monitor.tick()
  assert.equal(prompts.length, 1)
  assert.equal(resets.length, 1, 'stale usage cannot redeem the same credit twice')
  await monitor.close()
})

test('Cancel skips this credit across polls, while a new credit still prompts', async () => {
  let credits = [credit()]
  let prompted = 0
  const { monitor, resets } = fixture({
    usage: async () => usage(credits),
    prompt: async () => {
      prompted++
      return false
    }
  })
  await monitor.tick()
  await monitor.tick()
  assert.equal(prompted, 1)
  assert.equal(resets.length, 0)
  credits = [credit('next-credit')]
  await monitor.tick()
  assert.equal(prompted, 2)
  await monitor.close()
})

test('ignoring the popup resets at 30 seconds and aborts the popup', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal
  const { monitor, resets } = fixture({
    prompt: async (_account, _wait, popupSignal) => {
      signal = popupSignal
      return new Promise(() => {})
    }
  })
  const pending = monitor.tick()
  await flush()
  t.mock.timers.tick(29_999)
  await flush()
  assert.equal(resets.length, 0)
  t.mock.timers.tick(1)
  await pending
  assert.equal(resets.length, 1)
  assert.equal(signal.aborted, true)
  await monitor.close()
})

test('shortens the response deadline to leave time before expiry, including seconds timestamps', async () => {
  const { monitor, prompts, resets } = fixture({
    usage: async () => usage([credit('soon', (now + 15_000) / 1_000)])
  })
  await monitor.tick()
  assert.equal(prompts[0][1], 5_000)
  assert.equal(resets.length, 1)
  await monitor.close()
})

test('only prompts for available, authenticated credits expiring in under three minutes', async () => {
  for (const snapshot of [
    usage([credit('boundary', now + 180_000)]),
    usage([credit('future', now + 180_001)]),
    usage([credit('expired', now)]),
    usage([credit('unknown', null)]),
    usage([credit('invalid', NaN)]),
    usage([credit()], { authenticationRequired: true }),
    usage([credit()], { rateLimitResetCredits: { availableCount: 0, credits: [credit()] } }),
    usage([], { rateLimitResetCredits: null })
  ]) {
    const { monitor, prompts, resets } = fixture({ usage: async () => snapshot })
    await monitor.tick()
    assert.equal(prompts.length, 0)
    assert.equal(resets.length, 0)
    await monitor.close()
  }
})

test('checks all accounts and environments independently, even if one account fails', async (t) => {
  t.mock.method(console, 'error', () => {})
  const container = { kind: 'container', tool: 'ssh', name: 'remote' }
  const { monitor, prompts, resets } = fixture({
    sources: async () => [null, container],
    accounts: async () => ({
      available: true,
      accounts: [
        { id: 'broken', active: true },
        { id: 'work', displayName: 'Work', active: false }
      ]
    }),
    usage: async (options) => {
      if (options.accountId === 'broken') throw new Error('Offline')
      return usage()
    }
  })
  await Promise.all([monitor.tick(), monitor.tick()])
  assert.equal(prompts.length, 2, 'overlapping polls do not duplicate prompts')
  assert.deepEqual(prompts.map(([label]) => label).sort(), ['Work', 'Work (remote)'])
  assert.deepEqual(
    resets.map((options) => options.container),
    [null, container]
  )
  await monitor.close()
})

test('does not consume a different credit if the original was manually used or expired', async () => {
  for (const replacement of [[], [credit('replacement')], [credit('credit', now - 1)]]) {
    let calls = 0
    const { monitor, resets } = fixture({
      usage: async () => usage(calls++ === 0 ? [credit()] : replacement)
    })
    await monitor.tick()
    assert.equal(resets.length, 0)
    await monitor.close()
  }
})

test('retries transient failures and nothingToReset without repeating an accepted popup', async (t) => {
  t.mock.method(console, 'error', () => {})
  let attempts = 0
  const { monitor, prompts } = fixture({
    reset: async () => {
      attempts++
      if (attempts === 1) throw new Error('Network unavailable')
      return attempts === 2 ? 'nothingToReset' : 'reset'
    }
  })
  for (let i = 0; i < 4; i++) await monitor.tick()
  assert.equal(attempts, 3)
  assert.equal(prompts.length, 1)
  await monitor.close()
})

test('shutdown closes pending popups and prevents a reset', async () => {
  let signal
  const { monitor, resets } = fixture({
    prompt: (_account, _wait, popupSignal) => {
      signal = popupSignal
      return new Promise((resolve) => popupSignal.addEventListener('abort', () => resolve(false)))
    }
  })
  const pending = monitor.tick()
  await flush()
  await monitor.close()
  await pending
  assert.equal(signal.aborted, true)
  assert.equal(resets.length, 0)
  await monitor.tick()
  assert.equal(resets.length, 0)
})
