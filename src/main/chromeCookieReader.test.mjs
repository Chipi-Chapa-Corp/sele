import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { chromeCookieReaderScript } from './chromeCookieReader.ts'

const lockedChromeCookieDatabaseScript = `
import sqlite3
import sys

database = sqlite3.connect(sys.argv[1])
database.execute("PRAGMA journal_mode = WAL")
database.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER)")
database.execute("INSERT INTO meta VALUES ('version', 24)")
database.executescript("""
CREATE TABLE cookies (
    host_key TEXT NOT NULL,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    encrypted_value BLOB NOT NULL,
    path TEXT NOT NULL,
    expires_utc INTEGER NOT NULL,
    is_secure INTEGER NOT NULL,
    is_httponly INTEGER NOT NULL,
    samesite INTEGER NOT NULL,
    source_scheme INTEGER NOT NULL,
    top_frame_site_key TEXT NOT NULL,
    has_expires INTEGER NOT NULL
);
INSERT INTO cookies VALUES (
    '.example.com', 'session', 'value', X'', '/', 13644473600000000,
    1, 1, 0, 2, '', 1
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

test('reads a snapshot while the source Chrome database is open', async (context) => {
  const python = spawnSync('python3', ['--version'])
  if (python.error || python.status !== 0) {
    context.skip('python3 is unavailable')
    return
  }

  const directory = mkdtempSync(join(tmpdir(), 'sele-chrome-cookie-reader-test-'))
  const cookiePath = join(directory, 'Cookies')
  const source = spawn('python3', ['-c', lockedChromeCookieDatabaseScript, cookiePath], {
    stdio: ['pipe', 'pipe', 'pipe']
  })

  try {
    const [ready] = await once(source.stdout, 'data')
    assert.equal(ready.toString().trim(), 'READY')

    const reader = spawnSync('python3', ['-c', chromeCookieReaderScript, cookiePath], {
      encoding: 'utf8'
    })
    assert.equal(reader.status, 0, reader.stderr)
    const result = JSON.parse(reader.stdout)
    assert.equal(result.error, undefined)
    assert.equal(result.databaseVersion, 24)
    assert.equal(result.cookies.length, 1)
    assert.equal(result.cookies[0].name, 'session')
    assert.equal(result.cookies[0].expiresUtc, '13644473600000000')
  } finally {
    const closed = once(source, 'close')
    source.stdin.end()
    if (source.exitCode == null) await closed
    rmSync(directory, { force: true, recursive: true })
  }
})
