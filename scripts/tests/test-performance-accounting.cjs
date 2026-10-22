// Native SQLite integration with a disposable database; no providers or real profile.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
if (!process.versions.electron) {
  ;(async () => {
    const root = path.resolve(__dirname, '../..')
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-accounting-cache-')
    )
    try {
      await require('esbuild').build({
        stdin: {
          resolveDir: root,
          loader: 'ts',
          contents: `
        export * from './src/main/database/tokenUsage'
        export * from './src/main/database/chat'
        export * from './src/main/database/messageReviews'
        export * from './src/main/database/sqlite'
      `
        },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['electron'],
        plugins: [
          {
            name: 'native-sqlite',
            setup(build) {
              build.onResolve({ filter: /^better-sqlite3$/ }, () => ({
                path: require.resolve('better-sqlite3'),
                external: true
              }))
            }
          }
        ],
        outfile: path.join(directory, 'accounting.cjs')
      })
      const env = { ...process.env, SELE_DATABASE_PATH: path.join(directory, 'usage.sqlite') }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 30000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || result.error) {
        process.stderr.write(result.stderr || String(result.error))
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
  const { app } = require('electron')
  app.setPath('userData', path.join(process.argv[2], 'profile'))
  app.whenReady().then(async () => {
    let code = 0
    const api = require(path.join(process.argv[2], 'accounting.cjs'))
    try {
      await api.getDatabase()
      const connection = api.getSqliteConnection()
      const prepare = connection.prepare
      let queries = []
      connection.prepare = function (sql) {
        queries.push(sql)
        return prepare.call(this, sql)
      }
      const usage = (input, cached = 0, output = 1) => ({
        inputTokens: input,
        cachedInputTokens: cached,
        outputTokens: output
      })
      const rates = { input: 2, cacheRead: 0.2, output: 10 }
      const record = (changes = {}) =>
        api.recordTokenUsage('codex', {
          chatId: 'root',
          sourceKey: 'host',
          turnId: 'turn',
          recordId: 'request',
          timestamp: Date.now(),
          usage: usage(10),
          models: [{ modelId: 'fixture', rates, usage: usage(10) }],
          ...changes
        })
      record()
      record({
        chatId: 'child',
        parentChatId: 'root',
        parentTurnId: 'turn',
        turnId: 'child-turn',
        recordId: 'child'
      })
      const first = await api.getChatTokenUsage('codex', 'host', 'root')
      assert.equal(first.total.inputTokens, 20)
      queries = []
      for (let i = 0; i < 50; i++)
        assert.equal(await api.getChatTokenUsage('codex', 'host', 'root'), first)
      assert.deepEqual(queries, [], 'unchanged streaming updates perform no accounting SQL')
      record({ usage: usage(30), models: [{ modelId: 'fixture', rates, usage: usage(30) }] })
      record({
        chatId: 'child',
        parentChatId: 'root',
        parentTurnId: 'turn',
        turnId: 'child-turn',
        recordId: 'child',
        usage: usage(20),
        models: [{ modelId: 'fixture', rates, usage: usage(20) }]
      })
      const updated = await api.getChatTokenUsage('codex', 'host', 'root')
      assert.equal(updated.total.inputTokens, 50)
      assert.equal(updated.byTurn.get('turn').inputTokens, 50)
      assert.equal(first.total.inputTokens, 20, 'published totals stay immutable')
      assert.equal(
        queries.some((sql) => /with recursive chat_tree|row_number\(/i.test(sql)),
        false,
        'known usage changes update totals without rescanning history'
      )
      // A new descendant must invalidate the root membership index, including empty roots.
      await api.getChatTokenUsage('codex', 'host', 'empty')
      record({
        chatId: 'new-child',
        parentChatId: 'empty',
        parentTurnId: 'empty-turn',
        usage: usage(7),
        models: [{ modelId: 'fixture', rates, usage: usage(7) }]
      })
      assert.equal((await api.getChatTokenUsage('codex', 'host', 'empty')).total.inputTokens, 7)
      // Provisional records are deleted and replaced atomically; the aggregate cannot double count.
      record({ recordId: 'provisional', provisionalGroup: 'group', provisionalComplete: true })
      const before = await api.getChatTokenUsage('codex', 'host', 'root')
      record({
        recordId: 'final',
        replaceProvisionalGroup: 'group',
        usage: usage(15),
        models: [{ modelId: 'fixture', rates, usage: usage(15) }]
      })
      const after = await api.getChatTokenUsage('codex', 'host', 'root')
      assert.equal(after.total.inputTokens, before.total.inputTokens + 5)
      // Fresh source prices also invalidate roots containing estimated, token-only history.
      record({ chatId: 'legacy', recordId: 'old', models: undefined })
      const estimated = await api.getChatTokenUsage('codex', 'host', 'legacy')
      assert.equal(estimated.total.costUsesFallback, true)
      record({
        chatId: 'new-price',
        recordId: 'quote',
        timestamp: Date.now() + 1000,
        models: [
          { modelId: 'new', rates: { input: 20, cacheRead: 2, output: 100 }, usage: usage(10) }
        ]
      })
      const repriced = await api.getChatTokenUsage('codex', 'host', 'legacy')
      assert.ok(repriced.total.cost.total > estimated.total.cost.total * 9)
      // Compare the cache to a cold database reopen after every mutation path above.
      await api.flushTokenUsage()
      await api.disposeDatabase()
      const cold = await api.getChatTokenUsage('codex', 'host', 'root')
      assert.ok(Math.abs(cold.total.cost.total - after.total.cost.total) < 1e-12)
      assert.equal(cold.total.inputTokens, after.total.inputTokens)
      // Pricing I/O for a newly ingested record must not hold up a streaming snapshot.
      const originalFetch = global.fetch
      let releasePricing
      global.fetch = () =>
        new Promise((resolve) => {
          releasePricing = () =>
            resolve({
              ok: true,
              json: async () => ({
                openai: { models: { held: { cost: { input: 2, cache_read: 0.2, output: 10 } } } },
                anthropic: {
                  models: { fixture: { cost: { input: 3, cache_read: 0.3, output: 15 } } }
                }
              })
            })
        })
      record({
        recordId: 'pending-price',
        models: [{ modelId: 'held', pricingProvider: 'openai', usage: usage(10) }]
      })
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(typeof releasePricing, 'function')
      assert.equal(
        (await api.getLiveChatTokenUsage('codex', 'host', 'root')).total.inputTokens,
        cold.total.inputTokens,
        'streaming reads committed usage while pricing remains unresolved'
      )
      releasePricing()
      await api.flushTokenUsage()
      global.fetch = originalFetch
      assert.equal(
        (await api.getChatTokenUsage('codex', 'host', 'root')).total.inputTokens,
        cold.total.inputTokens + 10
      )
      await api.getChatMetadata('metadata')
      await api.getMessageReviews('metadata')
      const freshConnection = api.getSqliteConnection()
      const freshPrepare = freshConnection.prepare
      queries = []
      freshConnection.prepare = function (sql) {
        queries.push(sql)
        return freshPrepare.call(this, sql)
      }
      for (let i = 0; i < 50; i++) {
        await api.getChatMetadata('metadata')
        await api.getMessageReviews('metadata')
      }
      assert.deepEqual(queries, [], 'metadata and reviews share unchanged reads')
      assert.equal((await api.setChatPinned('metadata', true)).pinned, true)
      assert.equal((await api.setChatDone('metadata')).done, true)
      await api.setChatsDone(['metadata'], false)
      assert.equal((await api.getChatMetadata('metadata')).done, false)
      await api.setChatOrder(['other', 'metadata'])
      assert.equal((await api.getChatMetadata('metadata')).sidebarOrder, 1)
      const review = {
        id: 'review',
        comments: [
          { id: 'comment', path: '/fixture.ts', line: 1, endLine: 1, side: 'new', comment: 'Fix' }
        ]
      }
      await api.setMessageReview('metadata', 'serialized', 'prompt', review)
      assert.equal((await api.getMessageReviews('metadata')).length, 1)
      await api.setMessageReview('other', 'serialized', 'prompt', review)
      assert.equal((await api.getMessageReviews('metadata')).length, 0)
      assert.equal((await api.getMessageReviews('other')).length, 1)
      await api.deleteMessageReview('review')
      assert.equal((await api.getMessageReviews('other')).length, 0)
      console.log(
        'Accounting cache checks passed: 50 warm reads without SQL; incremental root/subagent totals; provisional replacement; pricing and metadata invalidation; cold-reopen equivalence.'
      )
    } catch (error) {
      console.error(error)
      code = 1
    } finally {
      await api.disposeDatabase()
    }
    app.exit(code)
  })
}
