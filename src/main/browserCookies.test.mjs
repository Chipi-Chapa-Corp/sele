import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { isExpectedFileAbsenceError } from '../shared/expectedAbsence.ts'

// Exercise the cookie database reader without booting Electron or opening a browser profile.
const source = ts.createSourceFile(
  'browserCookies.ts',
  readFileSync(new URL('./browserCookies.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const names = new Set([
  'getBrowserName',
  'getCookieDatabaseReadError',
  'readCookieDatabaseSnapshot',
  'readCookies'
])
const declarations = source.statements
  .filter(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((declaration) =>
        names.has(declaration.name.getText(source))
      )
  )
  .map((statement) => statement.getText(source))
  .join('\n')
const readerSource = ts.transpileModule(`${declarations}\nexports.read = readCookies`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText

const harness = (direct) => {
  const targetReads = []
  const context = {
    exports: {},
    Error,
    console: { error: () => {} },
    copyFile,
    mkdtemp,
    rm,
    join,
    tmpdir,
    isExpectedFileAbsenceError,
    shouldUseDirectAccess: async () => direct,
    readTargetCookieDatabase: async (...args) => {
      targetReads.push(args)
      return { cookies: [], version: 7 }
    }
  }
  vm.runInNewContext(readerSource, context)
  return { read: context.exports.read, targetReads }
}

const createProfile = async (t, browser) => {
  const root = await mkdtemp(join(tmpdir(), 'sele-cookie-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const cookiePath = join(root, 'cookies.sqlite')
  await writeFile(cookiePath, 'database')
  await writeFile(`${cookiePath}-wal`, 'journal')
  return { browser, container: null, cookiePath }
}

test('direct reads use a snapshot that includes the write-ahead log', async (t) => {
  const profile = await createProfile(t, 'firefox')
  let snapshot = { path: '', files: [] }
  const database = { cookies: [{ name: 'session' }], version: 16 }
  const result = await harness(true).read(
    profile,
    (path) => {
      snapshot = { path, files: [path, `${path}-wal`].map((file) => readFileSync(file, 'utf8')) }
      return database
    },
    'script',
    'schemaVersion',
    {}
  )
  assert.equal(result, database)
  assert.notEqual(snapshot.path, profile.cookiePath)
  assert.deepEqual(snapshot.files, ['database', 'journal'])
  assert.equal(existsSync(snapshot.path), false)
})

for (const [browser, detail, message] of [
  ['firefox', 'database is locked', 'Unable to read Firefox cookies. Close Firefox and try again.'],
  ['zen', 'no such table: moz_cookies', 'This Zen profile uses an unsupported cookie database.'],
  ['chrome', 'Unsupported cookie database', 'This Chrome profile uses an unsupported cookie database.'],
  [
    'chrome',
    'EACCES: permission denied, open',
    'Sele does not have permission to read this Chrome profile.'
  ],
  ['firefox', 'file is not a database', 'Unable to read Firefox cookies: file is not a database']
]) {
  test(`a failed direct ${browser} read explains "${detail}"`, async (t) => {
    const profile = await createProfile(t, browser)
    await assert.rejects(
      harness(true).read(
        profile,
        () => {
          throw new Error(detail)
        },
        'script',
        'schemaVersion',
        {}
      ),
      { message }
    )
  })
}

test('a missing cookie database is reported as a read failure', async (t) => {
  const profile = await createProfile(t, 'firefox')
  await rm(profile.cookiePath)
  await assert.rejects(
    harness(true).read(
      profile,
      () => assert.fail('reader must not run'),
      'script',
      'schemaVersion',
      {}
    ),
    /^Error: Unable to read Firefox cookies: ENOENT/
  )
})

test('profiles outside direct reach are read through their target', async (t) => {
  const profile = await createProfile(t, 'chrome')
  const fields = { name: 'string' }
  const app = harness(false)
  const result = await app.read(
    profile,
    () => assert.fail('direct reader must not run'),
    'script',
    'databaseVersion',
    fields
  )
  assert.deepEqual(result, { cookies: [], version: 7 })
  assert.deepEqual(app.targetReads, [[profile, 'script', 'databaseVersion', fields]])
})
