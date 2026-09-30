const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sele-token-usage-'))
    try {
      const esbuild = require('esbuild')
      await esbuild.build({
        entryPoints: ['src/main/providers/sqliteUsage.worker.ts'],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['electron'],
        plugins: [
          {
            name: 'native-sqlite-worker',
            setup(build) {
              build.onResolve({ filter: /^better-sqlite3$/ }, () => ({
                path: require.resolve('better-sqlite3'),
                external: true
              }))
            }
          }
        ],
        outfile: path.join(directory, 'usage-worker.cjs')
      })
      await esbuild.build({
        stdin: {
          contents: `export * from './src/main/database/tokenUsage'; export * from './src/main/providers/modelPricing/ModelsDevPricing'; export * from './src/main/providers/modelPricing/TokenPricing'; export { disposeDatabase, getDatabase } from './src/main/database/sqlite'; export * from './src/main/providers/copilot/CopilotHistoricalUsage'; export { readSqliteUsage } from './src/main/providers/sqliteUsage.worker'; export { SqliteUsageReader } from './src/main/providers/SqliteUsageReader';`,
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'ts'
        },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['electron'],
        plugins: [
          {
            name: 'native-sqlite',
            setup(build) {
              build.onResolve({ filter: /\?nodeWorker$/ }, () => ({
                path: 'usage-worker',
                namespace: 'test-worker'
              }))
              build.onLoad({ filter: /.*/, namespace: 'test-worker' }, () => ({
                contents: `import {Worker} from 'node:worker_threads'; export default (options) => new Worker(${JSON.stringify(path.join(directory, 'usage-worker.cjs'))}, options);`,
                loader: 'js'
              }))
              build.onResolve({ filter: /^better-sqlite3$/ }, () => ({
                path: require.resolve('better-sqlite3'),
                external: true
              }))
            }
          }
        ],
        outfile: path.join(directory, 'accounting.cjs')
      })
      await esbuild.build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { MessageBox } from './src/renderer/src/components/MessageBox'
            import { WorkingElapsedTime } from './src/renderer/src/components/WorkingElapsedTime'
            import { fallbackProviderModels, fallbackProviderApprovalModes, fallbackProviderSandboxModes } from './src/shared/provider'
            import './src/renderer/src/assets/styles/tokens.css'
            const root = createRoot(document.getElementById('root'))
            const noop = () => {}
            window.renderUsage = (provider = 'codex', chatId = 'chat') => flushSync(() => root.render(<>
              <div id="time"><WorkingElapsedTime item={{ type: 'working', id:'turn', status:'worked', items: [], startedAt: 1000, completedAt: 6000, tokenUsage: {inputTokens: 400, cachedInputTokens: 800, outputTokens: 250, cost: {input:0.0008,cachedInput:0.00016,output:0.0025,total:0.00346}} }} /></div>
              <MessageBox draftScopeKey="chat" draftProjectKey="project" chatId={chatId}
                providerId={provider} model={fallbackProviderModels[0].id} models={fallbackProviderModels}
                agentMode="interactive" agentModes={[]} approvalMode="never" approvalModes={fallbackProviderApprovalModes}
                reasoningEffort="medium" serviceTier={null} sandboxMode="danger-full-access" sandboxModes={fallbackProviderSandboxModes}
                accountUsage={{ statisticsLoaded: true, summary: {lifetimeTokens:'10000', peakDailyTokens:'5000',lifetimeCostUSD:1.25,peakDailyCostUSD:0.42,lifetimeCostSample:{tokens:1000,usdPerMillionTokens:125},peakDailyCostSample:{tokens:1000,usdPerMillionTokens:84},longestRunningTurnSec:30,currentStreakDays:1,longestStreakDays:2}, rateLimits:[], errors:[], updatedAt:1 }} accountUsageError={null} accountUsageState="ready" displayUsage="chatContext"
                contextUsage={{source: 'exact', usedTokens: 1000, maxTokens: 200000}}
                showActions={false} showNotesButton={false} showModelSelector={false} showAccessSelector={false}
                showReviewSelector={false} showSpeedSelector={false} showReasoningSelector={false}
                onAgentModeChange={noop} onApprovalModeChange={noop} onModelChange={noop}
                onReasoningEffortChange={noop} onServiceTierChange={noop} onSandboxModeChange={noop}
                onSend={async () => true} />
            </>))
            window.renderUsage()
          `,
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx'
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'usage.js')
      })
      await fs.writeFile(
        path.join(directory, 'usage.html'),
        `<!doctype html><html data-color-scheme="dark"><link rel="stylesheet" href="usage.css"><style>
        body {margin:0; padding:20px; height:600px; box-sizing:border-box; display:flex; flex-direction:column; background:var(--paper); color:var(--ink); font-family:system-ui; font-size:14px;}
        #root {margin-top:auto; width:100%;} #time {padding-bottom:15px;}
      </style><div id="root"></div><script>
        window.requests = []; window.failUsage = false;
        window.usage = {chat:{inputTokens:400,cachedInputTokens:800,outputTokens:250},week:{inputTokens:20000,cachedInputTokens:80000,outputTokens:5000},month:{inputTokens:200000,cachedInputTokens:800000,outputTokens:50000},updatedAt:1};
        window.usage.chat.cost={input:0.0008,cachedInput:0.00016,output:0.0025,total:0.00346};
        window.usage.week.cost={input:0.04,cachedInput:0.016,output:0.05,total:0.106};
        window.usage.month.cost={input:0.4,cachedInput:0.16,output:0.5,total:1.06};
        window.providerApi = {getSkills:async()=>[],getApps:async()=>[],getTokenUsage:async (provider, chat)=>{window.requests.push([provider,chat]); if(window.failUsage)throw new Error('Usage read failed');return window.usage;}};
        window.appApi = {getClipboardImage:async()=>null};
      </script><script src="usage.js"></script></html>`
      )
      const env = { ...process.env, SELE_DATABASE_PATH: path.join(directory, 'usage.sqlite') }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (
        result.status !== 0 ||
        result.error ||
        !result.stdout.includes('Token usage checks passed')
      ) {
        process.stderr.write(result.stderr || String(result.error || 'Token usage check failed'))
        process.exitCode = 1
      }
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow } = require('electron')
  app
    .whenReady()
    .then(async () => {
      let win
      let accounting
      let code = 0
      try {
        accounting = require(path.join(process.argv[2], 'accounting.cjs'))
        const now = 1800000000000
        const usage = (input, cached, output) => ({
          inputTokens: input,
          cachedInputTokens: cached,
          outputTokens: output
        })
        const record = (provider, changes) =>
          accounting.recordTokenUsage(provider, {
            chatId: 'chat',
            sourceKey: 'host',
            turnId: 'turn-1',
            recordId: 'thread',
            timestamp: now,
            usage: usage(100, 50, 10),
            cumulative: true,
            ...changes
          })
        record('codex', {})
        record('codex', { timestamp: now + 1 })
        record('codex', { timestamp: now + 2, turnId: 'turn-2', usage: usage(130, 70, 15) })
        record('codex', { timestamp: now - 1, usage: usage(500, 500, 500) })
        await accounting.flushTokenUsage()
        let chat = await accounting.getChatTokenUsage('codex', 'host', 'chat')
        assert.deepEqual(chat.total, usage(130, 70, 15))
        assert.deepEqual(chat.byTurn.get('turn-2'), usage(30, 20, 5))
        await accounting.disposeDatabase()
        record('codex', { timestamp: now + 3, turnId: 'turn-3', usage: usage(130, 70, 15) })
        chat = await accounting.getChatTokenUsage('codex', 'host', 'chat')
        assert.deepEqual(
          chat.total,
          usage(130, 70, 15),
          'restart must not recount cumulative usage'
        )
        record('codex', {
          chatId: 'child',
          parentChatId: 'chat',
          parentTurnId: 'turn-2',
          turnId: 'child-turn',
          recordId: 'child',
          cumulative: false,
          usage: usage(30, 0, 10)
        })
        record('codex', {
          chatId: 'grandchild',
          parentChatId: 'child',
          parentTurnId: 'child-turn',
          turnId: 'grandchild-turn',
          recordId: 'nested',
          cumulative: false,
          usage: usage(20, 10, 5)
        })
        chat = await accounting.getChatTokenUsage('codex', 'host', 'chat')
        assert.deepEqual(chat.total, usage(180, 80, 30))
        assert.deepEqual(
          chat.byTurn.get('turn-2'),
          usage(80, 30, 20),
          'nested agents belong to the parent turn'
        )
        record('opencode', {
          chatId: 'history',
          recordId: 'request',
          cumulative: false,
          timestamp: now - 10 * 86400000,
          usage: usage(200, 50, 20)
        })
        record('opencode', {
          chatId: 'history',
          recordId: 'request',
          cumulative: false,
          timestamp: now - 10 * 86400000,
          usage: usage(200, 50, 20)
        })
        record('claude', {
          chatId: 'old',
          recordId: 'old',
          cumulative: false,
          timestamp: now - 40 * 86400000,
          usage: usage(999, 0, 0)
        })
        record('copilot', { recordId: 'request', cumulative: false, usage: usage(80, 20, 30) })
        record('copilot', { recordId: 'request', cumulative: false, usage: usage(80, 20, 40) })
        record('codex', {
          sourceKey: 'remote',
          recordId: 'request',
          cumulative: false,
          usage: usage(10, 0, 1)
        })
        const summary = await accounting.getTokenUsageSummary('codex', 'host', 'chat', now + 100)
        assert.deepEqual(
          summary.chat,
          usage(180, 80, 30),
          'selected chat isolates provider and source'
        )
        assert.deepEqual(
          summary.week,
          usage(190, 80, 31),
          'weekly totals isolate the selected provider across sources without replay inflation'
        )
        assert.deepEqual(
          summary.month,
          usage(190, 80, 31),
          'monthly totals isolate the selected provider'
        )
        const copilotSummary = await accounting.getTokenUsageSummary(
          'copilot',
          'host',
          null,
          now + 100
        )
        assert.deepEqual(copilotSummary.week, usage(80, 20, 40))
        assert.deepEqual(copilotSummary.month, usage(80, 20, 40))
        const openCodeSummary = await accounting.getTokenUsageSummary(
          'opencode',
          'host',
          null,
          now + 100
        )
        assert.deepEqual(openCodeSummary.week, usage(0, 0, 0))
        assert.deepEqual(
          openCodeSummary.month,
          usage(200, 50, 20),
          'period totals use request dates, not history load dates'
        )
        const cutoffNow = now + 100
        for (const [recordId, timestamp] of [
          ['week-boundary', cutoffNow - 7 * 86400000],
          ['month-boundary', cutoffNow - 30 * 86400000],
          ['too-old', cutoffNow - 30 * 86400000 - 1],
          ['future', cutoffNow + 1]
        ]) {
          record('opencode', {
            chatId: 'boundaries',
            recordId,
            timestamp,
            cumulative: false,
            usage: usage(1, 2, 3)
          })
        }
        const boundaries = await accounting.getTokenUsageSummary(
          'opencode',
          'host',
          null,
          cutoffNow
        )
        assert.deepEqual(
          boundaries.week,
          usage(1, 2, 3),
          'include the week boundary and exclude future usage'
        )
        assert.deepEqual(
          boundaries.month,
          usage(202, 54, 26),
          'include the month boundary and exclude older usage'
        )
        assert.equal(
          (await accounting.getTokenUsageSummary('claude', 'host', 'unknown', now)).chat,
          null
        )
        record('claude', {
          chatId: 'streaming',
          recordId: 'live-1',
          turnId: 'live-turn',
          cumulative: false,
          provisionalGroup: 'query',
          provisionalComplete: true,
          usage: usage(100, 80, 40)
        })
        assert.deepEqual(
          (await accounting.getChatTokenUsage('claude', 'host', 'streaming')).total,
          usage(100, 80, 40)
        )
        record('claude', {
          chatId: 'streaming',
          recordId: 'query',
          turnId: 'live-turn',
          cumulative: true,
          replaceProvisionalGroup: 'query',
          usage: usage(150, 100, 60)
        })
        assert.deepEqual(
          (await accounting.getChatTokenUsage('claude', 'host', 'streaming')).total,
          usage(150, 100, 60),
          'full pipeline results replace live snapshots'
        )
        record('claude', {
          chatId: 'streaming',
          recordId: 'live-2',
          turnId: 'next-turn',
          cumulative: false,
          provisionalGroup: 'query',
          provisionalComplete: true,
          timestamp: now + 1,
          usage: usage(30, 10, 20)
        })
        record('claude', {
          chatId: 'streaming',
          recordId: 'query',
          turnId: 'next-turn',
          timestamp: now + 2,
          cumulative: true,
          replaceProvisionalGroup: 'query',
          usage: usage(200, 120, 100)
        })
        assert.deepEqual(
          (await accounting.getChatTokenUsage('claude', 'host', 'streaming')).total,
          usage(200, 120, 100),
          'later results add only their pipeline delta'
        )
        record('claude', {
          chatId: 'background',
          recordId: 'child',
          turnId: 'turn',
          cumulative: false,
          provisionalGroup: 'background-query',
          usage: usage(20, 10, 0)
        })
        record('claude', {
          chatId: 'background',
          recordId: 'query',
          turnId: 'turn',
          cumulative: true,
          replaceProvisionalGroup: 'background-query',
          usage: usage(100, 50, 30)
        })
        assert.deepEqual(
          (await accounting.getChatTokenUsage('claude', 'host', 'background')).total,
          usage(120, 60, 30),
          'a foreground result retains in-flight background consumption'
        )
        record('claude', {
          chatId: 'background',
          recordId: 'child',
          turnId: 'turn',
          cumulative: false,
          provisionalGroup: 'background-query',
          provisionalComplete: true,
          usage: usage(20, 10, 5)
        })
        record('claude', {
          chatId: 'background',
          recordId: 'query',
          turnId: 'turn',
          cumulative: true,
          timestamp: now + 1,
          replaceProvisionalGroup: 'background-query',
          usage: usage(120, 60, 35)
        })
        assert.deepEqual(
          (await accounting.getChatTokenUsage('claude', 'host', 'background')).total,
          usage(120, 60, 35),
          'completed background consumption is reconciled exactly once'
        )
        await accounting.disposeDatabase()

        // Real SQLite + mocked HTTP verify durable catalog caching and quoted spend.
        const originalFetch = global.fetch
        const originalNow = Date.now
        let pricingTime = originalNow()
        Date.now = () => pricingTime
        let fetches = 0
        const catalog = {
          openai: {
            models: {
              a: { cost: { input: 2, cache_read: 0.2, output: 10 } },
              b: { cost: { input: 4, cache_read: 0.4, output: 20 } }
            }
          },
          anthropic: {
            models: {
              claude: { cost: { input: 3, cache_read: 0.3, cache_write: 3.75, output: 15 } }
            }
          }
        }
        global.fetch = async (url) => {
          assert.equal(url, 'https://models.dev/api.json?type=all')
          fetches++
          return { ok: true, json: async () => catalog }
        }
        await Promise.all([accounting.refreshModelPricing(), accounting.refreshModelPricing()])
        assert.equal(fetches, 1, 'concurrent refreshes share one fetch')
        const pricedRecord = (provider, chatId, changes) =>
          accounting.recordTokenUsage(provider, {
            chatId,
            sourceKey: 'host',
            turnId: 'turn',
            recordId: 'thread',
            timestamp: now,
            usage: usage(1000000, 1000000, 1000000),
            ...changes
          })
        pricedRecord('codex', 'priced', {
          cumulative: true,
          models: [
            {
              modelId: 'a',
              pricingProvider: 'openai',
              usage: usage(1000000, 1000000, 1000000)
            }
          ]
        })
        let priced = await accounting.getChatTokenUsage('codex', 'host', 'priced')
        assert.equal(priced.total.cost.total, 12.2)
        assert.deepEqual(priced.total.cost, { input: 2, cachedInput: 0.2, output: 10, total: 12.2 })
        pricedRecord('codex', 'priced', {
          cumulative: true,
          timestamp: now + 1,
          turnId: 'next',
          usage: usage(2000000, 2000000, 2000000),
          models: [
            {
              modelId: 'b',
              pricingProvider: 'openai',
              usage: usage(2000000, 2000000, 2000000)
            }
          ]
        })
        priced = await accounting.getChatTokenUsage('codex', 'host', 'priced')
        assert.ok(
          Math.abs(priced.total.cost.total - 36.6) < 1e-10,
          'model switch prices only the new delta'
        )
        assert.equal(priced.byTurn.get('next').cost.total, 24.4)
        pricedRecord('claude', 'native-cost', {
          cumulative: true,
          models: [
            {
              modelId: 'claude',
              pricingProvider: 'anthropic',
              usage: usage(1000000, 1000000, 1000000),
              totalUSD: 36.6
            }
          ]
        })
        pricedRecord('claude', 'native-cost', {
          cumulative: true,
          timestamp: now + 1,
          models: [
            {
              modelId: 'claude',
              pricingProvider: 'anthropic',
              usage: usage(1000000, 1000000, 1000000),
              totalUSD: 36.6
            }
          ]
        })
        const native = (await accounting.getChatTokenUsage('claude', 'host', 'native-cost')).total
        assert.equal(
          native.cost.total,
          36.6,
          'native total is retained and duplicate results are not summed'
        )
        assert.ok(Math.abs(native.cost.output - 30) < 1e-10)
        pricedRecord('copilot', 'late-native-rates', {
          models: [
            {
              modelId: 'native',
              nativePricingKey: 'copilot:host:native',
              usage: usage(1000000, 1000000, 1000000),
              totalUSD: 24.4
            }
          ]
        })
        assert.equal(
          (await accounting.getChatTokenUsage('copilot', 'host', 'late-native-rates')).total.cost
            .total,
          24.4
        )
        accounting.setNativeModelPricing('copilot:host:native', {
          input: 2,
          cacheRead: 0.2,
          output: 10
        })
        const lateNative = (
          await accounting.getChatTokenUsage('copilot', 'host', 'late-native-rates')
        ).total
        assert.ok(
          Math.abs(lateNative.cost.output - 20) < 1e-10,
          'native rates arriving after a usage event fill its category estimates'
        )
        const statisticsRates = { input: 2, cacheRead: 0.2, output: 10 }
        const statisticsRecord = (recordId, timestamp, counts) =>
          pricedRecord('copilot', 'statistics', {
            sourceKey: 'statistics',
            recordId,
            timestamp,
            usage: counts,
            models: [{ modelId: 'native', rates: statisticsRates, usage: counts }]
          })
        statisticsRecord('peak', now, usage(1000000, 1000000, 1000000))
        statisticsRecord('other-day', now - 86400000, usage(1000, 1000, 1000))
        const accountSummary = { lifetimeTokens: '3003000', peakDailyTokens: '3000000' }
        const accountCosts = await accounting.getAccountUsageCosts(
          'copilot',
          'statistics',
          accountSummary
        )
        assert.ok(Math.abs(accountCosts.lifetimeCostUSD - 1.83183) < 1e-10)
        assert.ok(Math.abs(accountCosts.peakDailyCostUSD - 1.83) < 1e-10)
        assert.equal(accountCosts.lifetimeCostSample.tokens, 3003000)
        assert.equal(accountCosts.lifetimeCostSample.usdPerMillionTokens, 0.61)
        assert.ok(
          Math.abs(
            (
              await accounting.getAccountUsageCosts('copilot', 'statistics', {
                ...accountSummary,
                lifetimeTokens: '9999999'
              })
            ).lifetimeCostUSD - 6.09999939
          ) < 1e-10,
          'historical totals use the fixed split without requiring matching recorded coverage'
        )
        assert.equal(
          (await accounting.getAccountUsageCosts('codex', 'statistics', accountSummary))
            .lifetimeCostUSD,
          null,
          'saved model rates are isolated by provider and source'
        )
        assert.equal(
          (await accounting.getAccountUsageCosts('copilot', 'other-source', accountSummary))
            .lifetimeCostUSD,
          null,
          'another source does not inherit recorded model prices'
        )
        pricedRecord('copilot', 'statistics', {
          sourceKey: 'statistics',
          recordId: 'unpriced',
          usage: usage(10, 0, 0)
        })
        assert.ok(
          Math.abs(
            (
              await accounting.getAccountUsageCosts('copilot', 'statistics', {
                ...accountSummary,
                lifetimeTokens: '3003010'
              })
            ).lifetimeCostUSD - 1.8318361
          ) < 1e-10,
          'older records without models no longer block a statistics estimate'
        )
        const defaultEstimate = await accounting.getAccountUsageCosts(
          'codex',
          'fresh-source',
          accountSummary,
          async () => ({ modelId: 'default', rates: statisticsRates, usage: usage(0, 0, 0) })
        )
        assert.ok(Math.abs(defaultEstimate.lifetimeCostUSD - 1.83183) < 1e-10)
        assert.equal(
          defaultEstimate.lifetimeCostSample.tokens,
          0,
          'default model works before any priced turn'
        )
        assert.equal(
          (
            await accounting.getAccountUsageCosts('codex', 'fresh-source', {
              lifetimeTokens: '0',
              peakDailyTokens: '0'
            })
          ).lifetimeCostUSD,
          0
        )
        pricedRecord('codex', 'late-price', {
          models: [
            {
              modelId: 'late',
              pricingProvider: 'openai',
              usage: usage(1000000, 1000000, 1000000)
            }
          ]
        })
        assert.equal(
          (await accounting.getChatTokenUsage('codex', 'host', 'late-price')).total.cost?.total ??
            null,
          null
        )
        await accounting.disposeDatabase()
        delete require.cache[require.resolve(path.join(process.argv[2], 'accounting.cjs'))]
        accounting = require(path.join(process.argv[2], 'accounting.cjs'))
        await accounting.refreshModelPricing()
        assert.equal(fetches, 1, 'restart reads saved prices without fetching again')
        pricingTime += 2 * 86400000
        const previousError = console.error
        console.error = () => {}
        global.fetch = async () => {
          fetches++
          return { ok: true, json: async () => ({ openai: { models: {} } }) }
        }
        await accounting.refreshModelPricing()
        console.error = previousError
        const saved = await accounting.resolveModelPricing([
          { modelId: 'a', pricingProvider: 'openai', usage: usage(1, 0, 0) }
        ])
        assert.equal(saved[0].rates.input, 2, 'invalid refresh retains valid saved prices')
        pricingTime += 2 * 86400000
        catalog.openai.models.a.cost.input = 200
        catalog.openai.models.late = { cost: { input: 2, cache_read: 0.2, output: 10 } }
        global.fetch = async () => {
          fetches++
          return { ok: true, json: async () => catalog }
        }
        await accounting.refreshModelPricing()
        assert.equal(fetches, 3, 'expired pricing is refetched, with retries after failures')
        priced = await accounting.getChatTokenUsage('codex', 'host', 'priced')
        assert.ok(
          Math.abs(priced.total.cost.total - 36.6) < 1e-10,
          'refresh never reprices recorded spend'
        )
        assert.equal(
          (await accounting.getChatTokenUsage('codex', 'host', 'late-price')).total.cost.total,
          12.2,
          'usage recorded before rates arrive is filled once pricing becomes available'
        )
        global.fetch = originalFetch
        Date.now = originalNow

        // Reproduce a priced current turn alongside old token-only records in a clean ledger.
        await accounting.disposeDatabase()
        const originalDatabasePath = process.env.SELE_DATABASE_PATH
        process.env.SELE_DATABASE_PATH = path.join(process.argv[2], 'legacy-usage.sqlite')
        pricedRecord('codex', 'legacy-chat', {
          recordId: 'known',
          usage: usage(1000000, 1000000, 1000000),
          models: [
            { modelId: 'saved', rates: statisticsRates, usage: usage(1000000, 1000000, 1000000) }
          ]
        })
        pricedRecord('codex', 'legacy-chat', {
          recordId: 'legacy',
          turnId: 'older',
          usage: usage(1000000, 9000000, 100000)
        })
        pricedRecord('codex', 'legacy-child', {
          recordId: 'child',
          parentChatId: 'legacy-chat',
          parentTurnId: 'older',
          usage: usage(1000000, 9000000, 100000)
        })
        const legacySummary = await accounting.getTokenUsageSummary(
          'codex',
          'host',
          'legacy-chat',
          now + 100
        )
        for (const period of ['chat', 'week', 'month']) {
          assert.ok(
            Math.abs(legacySummary[period].cost.total - 21.8) < 1e-10,
            `${period} includes old records and native prices`
          )
          assert.equal(legacySummary[period].costUsesFallback, true)
        }
        const legacyTurns = await accounting.getChatTokenUsage('codex', 'host', 'legacy-chat')
        assert.equal(
          legacyTurns.byTurn.get('turn').cost.total,
          12.2,
          'the priced current turn is preserved'
        )
        assert.equal(
          legacyTurns.byTurn.get('older').cost.total,
          9.6,
          'child usage uses the same source rates and parent turn'
        )
        const legacyRows = await (await accounting.getDatabase())
          .selectFrom('token_usage')
          .selectAll()
          .execute()
        assert.equal(
          legacyRows.filter((row) => row.models_json == null).length,
          2,
          'assumed models are never persisted as historical facts'
        )
        assert.equal(
          (await accounting.getChatTokenUsage('codex', 'other-source', 'legacy-chat')).total,
          null
        )
        // Read the real native schema in a worker, including old chats never opened in Sele.
        const nativeHome = path.join(process.argv[2], 'native-copilot')
        await fs.mkdir(nativeHome)
        const nativePath = path.join(nativeHome, 'session-store.db')
        const NativeDatabase = require('better-sqlite3')
        const nativeDB = new NativeDatabase(nativePath)
        nativeDB.exec(`create table assistant_usage_events (
          id integer primary key, session_id text, created_at text, model text,
          input_tokens integer, cache_read_tokens integer, output_tokens integer,
          total_nano_aiu integer, token_details_json text
        )`)
        const insertNative = nativeDB.prepare(
          'insert into assistant_usage_events values(?,?,?,?,?,?,?,?,?)'
        )
        const details = (input, cache, output) =>
          JSON.stringify([
            {
              tokenType: 'input',
              tokenCount: input,
              costPerBatch: 100000000000,
              batchSize: 1000000
            },
            {
              tokenType: 'cache_read',
              tokenCount: cache,
              costPerBatch: 10000000000,
              batchSize: 1000000
            },
            {
              tokenType: 'output',
              tokenCount: output,
              costPerBatch: 200000000000,
              batchSize: 1000000
            }
          ])
        const addNative = (
          id,
          chat,
          timestamp,
          input,
          cache,
          output,
          nativeCost,
          billed = details(input, cache, output)
        ) =>
          insertNative.run(
            id,
            chat,
            new Date(timestamp).toISOString(),
            'retired-model',
            input + cache,
            cache,
            output,
            nativeCost,
            billed
          )
        addNative(1, 'native-chat', now, 100, 50, 20, 14500000)
        addNative(2, 'native-chat', now - 10 * 86400000, 200, 100, 30, 0)
        addNative(3, 'native-chat', now - 40 * 86400000, 1, 2, 3, null)
        addNative(4, 'boundary', now - 7 * 86400000, 1, 2, 3, 720000)
        addNative(5, 'boundary', now - 30 * 86400000, 1, 2, 3, 720000)
        addNative(6, 'boundary', now - 30 * 86400000 - 1, 1, 2, 3, 720000)
        addNative(7, 'native-chat', now + 1, 1000, 2000, 3000, 720000)
        const nativeRead = {
          path: nativePath,
          table: 'assistant_usage_events',
          requiredColumns: accounting.copilotUsageColumns,
          query: accounting.bindCopilotUsageQuery(now, 'native-chat'),
          queryWithoutDetails: accounting.bindCopilotUsageQuery(now, 'native-chat', false)
        }
        const reader = new accounting.SqliteUsageReader()
        try {
          let resolved = 0
          const options = async () => {
            resolved++
            return nativeRead
          }
          const first = reader.read('native-chat', options)
          const second = reader.read('native-chat', options)
          assert.equal(first, second, 'simultaneous native reads are coalesced')
          const nativeRows = await first
          const native = accounting.historicalUsageFromRows(nativeRows, now)
          assert.equal(resolved, 1)
          assert.deepEqual(
            { ...native.chat, cost: undefined },
            { ...usage(301, 152, 53), cost: undefined },
            'chat totals include retained history outside the month'
          )
          assert.equal(native.week.inputTokens, 101)
          assert.equal(native.month.inputTokens, 302)
          assert.equal(native.week.outputTokens, 23)
          assert.equal(native.month.outputTokens, 56)
          assert.ok(Math.abs(native.chat.cost.total - 0.0001522) < 1e-12)
          assert.ok(Math.abs(native.month.cost.total - 0.0001594) < 1e-12)
          assert.ok(
            Math.abs(
              native.month.cost.input +
                native.month.cost.cachedInput +
                native.month.cost.output -
                native.month.cost.total
            ) < 1e-12
          )
          await reader.read('native-chat', options)
          assert.equal(resolved, 1, 'polls reuse the native snapshot')
          const sourceIdentity = `${nativeRows[0].database_identity}:${nativeRows[0].source_anchor}`
          record('copilot', {
            chatId: 'native-chat',
            recordId: 'sdk-call-id',
            cumulative: false,
            usage: usage(100, 50, 20)
          })
          const replaced = await accounting.getTokenUsageSummary(
            'copilot',
            'host',
            'native-chat',
            now,
            new Map([
              ['host', { ...native, sourceIdentity }],
              ['toolbox:shared-home', { ...native, sourceIdentity }]
            ])
          )
          assert.deepEqual(
            replaced.month,
            native.month,
            'native history replaces live calls and a shared database is counted once'
          )
          assert.deepEqual(replaced.chat, native.chat)
          assert.equal(replaced.history, 'native')
          record('copilot', {
            chatId: 'unavailable-source',
            sourceKey: 'remote',
            recordId: 'live-only',
            cumulative: false,
            usage: { ...usage(3, 2, 1), cost: { input: 0, cachedInput: 0, output: 0, total: 0 } }
          })
          const mixed = await accounting.getTokenUsageSummary(
            'copilot',
            'host',
            'native-chat',
            now,
            new Map([['host', native]])
          )
          assert.equal(
            mixed.week.inputTokens,
            104,
            'sources without a native ledger retain recorded usage'
          )
          assert.equal(mixed.month.inputTokens, 305)
          assert.equal(mixed.history, 'mixed')

          const remoteRead = {
            ...nativeRead,
            path: undefined,
            command: {
              file: 'sh',
              args: [
                '-c',
                accounting.copilotUsageReadScript,
                'sele-test',
                nativeRead.query,
                nativeRead.queryWithoutDetails,
                JSON.stringify(accounting.copilotUsageColumns)
              ],
              env: { ...process.env, COPILOT_HOME: nativeHome }
            }
          }
          assert.deepEqual(
            await accounting.readSqliteUsage(remoteRead),
            nativeRows,
            'remote transport produces the same dated billing snapshot'
          )
          addNative(8, 'native-chat', now - 1, 100, 10, 20, 25000000000, null)
          const unknown = accounting.historicalUsageFromRows(
            await reader.read('fresh', options),
            now
          )
          assert.equal(
            unknown.month.cost.input,
            null,
            'absent billing details never become a free category'
          )
          assert.ok(
            Math.abs(unknown.month.cost.total - 0.2501594) < 1e-12,
            'native totals survive missing category rates'
          )
          assert.equal(
            (await reader.read('native-chat', options))[0].calls,
            nativeRows[0].calls,
            'cached snapshots do not change behind the renderer'
          )
          const clock = Date.now
          try {
            Date.now = () => clock() + 16000
            const refreshed = await reader.read('native-chat', options)
            assert.notDeepEqual(refreshed, nativeRows, 'expired snapshots reread new native calls')
          } finally {
            Date.now = clock
          }
          nativeDB.exec('alter table assistant_usage_events drop column token_details_json')
          const legacyNative = accounting.historicalUsageFromRows(
            await accounting.readSqliteUsage(nativeRead),
            now
          )
          assert.equal(legacyNative.month.cost.input, null)
          assert.equal(
            legacyNative.month.cost.total,
            unknown.month.cost.total,
            'older schemas retain native totals'
          )
          assert.deepEqual(
            await accounting.readSqliteUsage(remoteRead),
            await accounting.readSqliteUsage(nativeRead)
          )
          assert.equal(
            await accounting.readSqliteUsage({
              ...nativeRead,
              path: path.join(nativeHome, 'missing.db')
            }),
            null,
            'an absent database is not a fabricated zero snapshot'
          )
          assert.equal(
            await accounting.readSqliteUsage({ ...nativeRead, requiredColumns: ['unavailable'] }),
            null
          )
          assert.equal(
            accounting
              .bindCopilotUsageQuery(now, "chat'; drop table assistant_usage_events; --")
              .includes("chat''; drop"),
            true
          )
          await accounting.readSqliteUsage({
            ...nativeRead,
            query: accounting.bindCopilotUsageQuery(
              now,
              "chat'; drop table assistant_usage_events; --"
            )
          })
        } finally {
          reader.dispose()
          nativeDB.close()
        }
        await assert.rejects(
          reader.read('disposed', async () => nativeRead),
          /disposed/
        )
        const delayedReader = new accounting.SqliteUsageReader()
        let finishOptions
        const delayed = delayedReader.read(
          'delayed',
          () =>
            new Promise((resolve) => {
              finishOptions = resolve
            })
        )
        delayedReader.dispose()
        finishOptions(nativeRead)
        await assert.rejects(
          delayed,
          /disposed/,
          'shutdown while resolving a remote source must not restart its worker'
        )
        await accounting.disposeDatabase()
        process.env.SELE_DATABASE_PATH = originalDatabasePath

        win = new BrowserWindow({
          show: false,
          width: 520,
          height: 650,
          webPreferences: { offscreen: true, backgroundThrottling: false }
        })
        win.webContents.on('console-message', (event) => {
          if (event.level === 'error') console.error('Renderer:', event.message)
        })
        await win.loadFile(path.join(process.argv[2], 'usage.html'))
        const run = (source) =>
          win.webContents.executeJavaScript(source).catch((error) => {
            console.error('UI check:', source)
            throw error
          })
        const settle = () =>
          run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        const clickTab = async (label) => {
          await run(
            `Array.from(document.querySelectorAll('.message-box__usage-tabs button')).find(button=>button.textContent.trim()===${JSON.stringify(label)}).click()`
          )
          await settle()
        }
        assert.equal(
          await run('document.querySelector("#time").textContent.trim()'),
          '· 5s · 0.0035$'
        )
        await run('document.querySelector(".message-box__usage-control > button").click()')
        await settle()
        assert.deepEqual(
          await run(
            'Array.from(document.querySelectorAll(".message-box__usage-tabs button")).map(button=>button.textContent.trim())'
          ),
          ['Limits', 'Usage', 'Statistics']
        )
        await clickTab('Usage')
        assert.equal(await run('document.querySelectorAll(".token-usage__card").length'), 3)
        assert.equal(
          await run('document.querySelector(".token-usage__heading strong").textContent'),
          '1.5K$0.0035'
        )
        assert.equal(
          await run('document.querySelector(".token-usage__legend dd").textContent'),
          '80055%$0.00016'
        )
        assert.match(
          await run('document.querySelector("#time span[title]").title'),
          /1,200 input tokens.*800 cached.*250 output tokens/
        )
        assert.deepEqual(await run('window.requests.at(-1)'), ['codex', 'chat'])
        assert.match(
          await run(
            'document.querySelector(".token-usage__card [role=img]").getAttribute("aria-label")'
          ),
          /Cached input: 800 tokens, Input: 400 tokens, Output: 250 tokens/
        )
        const overflow = await run(
          'Array.from(document.querySelectorAll(".token-usage__card")).some(card=>card.scrollWidth>card.clientWidth)'
        )
        assert.equal(overflow, false, 'usage cards fit the popover')
        await run('new Promise(resolve => setTimeout(resolve, 350))')
        await fs.writeFile(
          '/tmp/sele-token-usage-dark.png',
          (await win.webContents.capturePage()).toPNG()
        )
        await run('document.documentElement.dataset.colorScheme="light"')
        await settle()
        await fs.writeFile(
          '/tmp/sele-token-usage-light.png',
          (await win.webContents.capturePage()).toPNG()
        )
        await clickTab('Statistics')
        assert.match(
          await run('document.querySelector(".message-box__usage-page").textContent'),
          /Lifetime tokens/
        )
        assert.deepEqual(
          await run(
            'Array.from(document.querySelectorAll(".message-box__usage-row strong")).slice(0,2).map(node=>node.textContent)'
          ),
          ['10K $1.25', '5,000 $0.42']
        )
        assert.match(
          await run('document.querySelector(".message-box__usage-row strong").title'),
          /95% cached input, 4% output, and 1% input/
        )
        await run('window.usage.chat.costUsesFallback=true')
        await run('window.renderUsage("codex","legacy-priced")')
        await settle()
        await clickTab('Usage')
        assert.equal(
          await run('document.querySelector(".token-usage__heading strong").textContent'),
          '1.5K$0.0035'
        )
        assert.match(
          await run('document.querySelector(".token-usage__heading strong").title'),
          /historical records without a model/
        )
        await clickTab('Limits')
        assert.match(
          await run('document.querySelector(".message-box__usage-page").textContent'),
          /Context/
        )
        await run('window.renderUsage("claude","other")')
        await settle()
        await clickTab('Usage')
        assert.deepEqual(await run('window.requests.at(-1)'), ['claude', 'other'])
        const requestCount = await run('window.requests.length')
        await run('window.renderUsage("opencode","ignored")')
        await settle()
        assert.equal(
          await run(
            `document.querySelector('[aria-label="Usage unavailable for OpenCode"]').disabled`
          ),
          true
        )
        assert.equal(await run('document.querySelectorAll(".token-usage__card").length'), 0)
        assert.equal(
          await run('window.requests.length'),
          requestCount,
          'disabled OpenCode Usage never loads consumption'
        )
        await run('window.renderUsage("claude","other")')
        await settle()
        await clickTab('Usage')

        assert.match(
          await run('document.querySelectorAll(".token-usage__heading strong")[1].title'),
          /all chats and sources for the selected provider/
        )
        await run('window.usage={...window.usage,chat:null};window.renderUsage("claude",null)')
        await settle()
        assert.match(
          await run('document.querySelector(".token-usage").textContent'),
          /Select a chat/
        )
        await run('window.failUsage=true; window.renderUsage("copilot","broken")')
        await settle()
        assert.match(
          await run('document.querySelector(".token-usage").textContent'),
          /Usage read failed/
        )
        await run(
          `window.failUsage=false;document.querySelector('[aria-label="Retry token usage"]').click()`
        )
        await settle()
        assert.equal(await run('document.querySelectorAll(".token-usage__card").length'), 3)
        await run(`window.providerApi.getTokenUsage = async (provider,chat) => {
          if(chat==='slow')return new Promise(resolve=>{window.finishSlow=resolve});
          return {...window.usage,chat:{inputTokens:99,cachedInputTokens:0,outputTokens:1}};
        }; window.renderUsage('codex','slow')`)
        await settle()
        await run(`window.renderUsage('codex','fast')`)
        await settle()
        await run(
          `window.finishSlow({...window.usage,chat:{inputTokens:999,cachedInputTokens:0,outputTokens:1}})`
        )
        await settle()
        assert.match(
          await run(
            'document.querySelector(".token-usage__card [role=img]").getAttribute("aria-label")'
          ),
          /Input: 99 tokens/,
          'stale chat responses cannot replace the selected chat totals'
        )
        console.log(
          'Token usage checks passed (durable accounting, period totals, tabs, labels, layout, empty/error states).'
        )
      } catch (error) {
        console.error(error)
        code = 1
      } finally {
        if (accounting) await accounting.disposeDatabase()
        win?.destroy()
        app.exit(code)
      }
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
}
