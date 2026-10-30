// Disposable native SQLite files; never opens Sele or a user profile.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
if (!process.versions.electron) {
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 30000
  })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  if (result.status !== 0) process.exitCode = 1
} else {
  const Database = require('better-sqlite3')
  const directory = fs.mkdtempSync(
    path.join(process.env.SELE_BENCHMARK_DATABASE_DIRECTORY ?? os.tmpdir(), 'sele-database-writes-')
  )
  const results = []
  try {
    for (const mode of ['DELETE', 'WAL']) {
      const db = new Database(path.join(directory, mode + '.sqlite'))
      try {
        db.pragma('journal_mode = ' + mode)
        db.pragma('synchronous = FULL')
        db.exec('CREATE TABLE marker (id TEXT PRIMARY KEY, seen INTEGER NOT NULL)')
        const write = db.prepare(
          'INSERT INTO marker VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET seen = excluded.seen'
        )
        const times = []
        for (let i = 0; i < 300; i++) {
          const start = performance.now()
          write.run('chat-' + (i % 20), i)
          times.push(performance.now() - start)
        }
        times.sort((a, b) => a - b)
        results.push({
          mode,
          sqlite: db.prepare('SELECT sqlite_version() AS version').get().version,
          writes: times.length,
          medianMs: times[Math.floor(times.length / 2)],
          p95Ms: times[Math.floor(times.length * 0.95)],
          maxMs: times.at(-1),
          totalMs: times.reduce((sum, ms) => sum + ms, 0)
        })
      } finally {
        db.close()
      }
    }
    console.log(JSON.stringify({ synchronous: 'FULL', results }, null, 2))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}
