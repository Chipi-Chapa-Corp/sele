import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { firefoxCookieReaderScript } from './firefoxCookieReader.ts'

const lockedCookieDatabaseScript = `
import sqlite3
import sys

database = sqlite3.connect(sys.argv[1])
database.execute("PRAGMA journal_mode = WAL")
database.execute("PRAGMA user_version = 17")
database.executescript("""
CREATE TABLE moz_cookies (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    host TEXT NOT NULL,
    path TEXT NOT NULL,
    expiry INTEGER NOT NULL,
    isSecure INTEGER NOT NULL,
    isHttpOnly INTEGER NOT NULL,
    sameSite INTEGER NOT NULL,
    originAttributes TEXT NOT NULL,
    schemeMap INTEGER NOT NULL,
    isPartitionedAttributeSet INTEGER NOT NULL
);
INSERT INTO moz_cookies VALUES (
    1, 'session', 'value', '.example.com', '/', 2000000000000,
    1, 1, 0, '', 2, 0
);
""")
database.commit()
database.execute("PRAGMA locking_mode = EXCLUSIVE")
database.execute("BEGIN EXCLUSIVE")
print("READY", flush=True)
sys.stdin.readline()
database.rollback()
database.close()
`.trim()

test('reads a snapshot while the source Firefox-family database is open', async (context) => {
  const python = spawnSync('python3', ['--version'])
  if (python.error || python.status !== 0) {
    context.skip('python3 is unavailable')
    return
  }

  const directory = mkdtempSync(join(tmpdir(), 'sele-cookie-reader-test-'))
  const cookiePath = join(directory, 'cookies.sqlite')
  const source = spawn('python3', ['-c', lockedCookieDatabaseScript, cookiePath], {
    stdio: ['pipe', 'pipe', 'pipe']
  })

  try {
    const [ready] = await once(source.stdout, 'data')
    assert.equal(ready.toString().trim(), 'READY')

    const reader = spawnSync('python3', ['-c', firefoxCookieReaderScript, cookiePath], {
      encoding: 'utf8'
    })
    assert.equal(reader.status, 0, reader.stderr)
    const result = JSON.parse(reader.stdout)
    assert.equal(result.error, undefined)
    assert.equal(result.schemaVersion, 17)
    assert.equal(result.cookies.length, 1)
    assert.equal(result.cookies[0].name, 'session')
  } finally {
    const closed = once(source, 'close')
    source.stdin.end()
    if (source.exitCode == null) await closed
    rmSync(directory, { force: true, recursive: true })
  }
})
