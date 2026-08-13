import assert from 'node:assert/strict'
import test from 'node:test'
import { getFileDisplayParts } from './fileDisplayPath.ts'

test('preserves the root of an absolute POSIX display path', () => {
  assert.deepEqual(getFileDisplayParts('/tmp/other-project/src/file.ts'), {
    directoryName: '/tmp/other-project/src',
    fileName: 'file.ts'
  })
})

test('formats a repository-relative display path', () => {
  assert.deepEqual(getFileDisplayParts('src/file.ts'), {
    directoryName: 'src',
    fileName: 'file.ts'
  })
})

test('formats a file without a directory', () => {
  assert.deepEqual(getFileDisplayParts('file.ts'), {
    directoryName: '.',
    fileName: 'file.ts'
  })
})
