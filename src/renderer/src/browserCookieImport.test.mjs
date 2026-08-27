import assert from 'node:assert/strict'
import test from 'node:test'
import { getBrowserCookieImportMessage } from './browserCookieImport.ts'

test('reports imported cookies as a total and explains every skipped category', () => {
  assert.equal(
    getBrowserCookieImportMessage(
      {
        imported: 3,
        skipped: 3,
        skipReasons: {
          contextual: 1,
          expired: 1,
          invalid: 0,
          partitioned: 0,
          protected: 0,
          rejected: 1
        },
        total: 6
      },
      'default-release'
    ),
    'Imported 3 of 6 cookies from default-release. Skipped 3: 1 container/private-context, 1 expired, 1 rejected during import.'
  )
})

test('keeps a complete import concise', () => {
  assert.equal(
    getBrowserCookieImportMessage(
      {
        imported: 1,
        skipped: 0,
        skipReasons: {
          contextual: 0,
          expired: 0,
          invalid: 0,
          partitioned: 0,
          protected: 0,
          rejected: 0
        },
        total: 1
      },
      'Personal'
    ),
    'Imported 1 of 1 cookie from Personal.'
  )
})
