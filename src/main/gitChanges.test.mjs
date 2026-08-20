import assert from 'node:assert/strict'
import test from 'node:test'

import { limitVisibleUntrackedGitFiles, maxVisibleUntrackedGitFiles } from './gitChanges.ts'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const makeFiles = (count) =>
  Array.from({ length: count }, (_, index) => ({
    path: `artifact-${index}.txt`,
    kind: 'untracked',
    status: '??'
  }))

test('shows up to 200 untracked files', () => {
  const files = makeFiles(maxVisibleUntrackedGitFiles)

  assert.deepEqual(limitVisibleUntrackedGitFiles(files), {
    files,
    untrackedFilesHiddenForPerformance: false
  })
})

test('hides untracked files when there are more than 200', () => {
  const files = makeFiles(maxVisibleUntrackedGitFiles + 1)

  assert.deepEqual(limitVisibleUntrackedGitFiles(files), {
    files: [],
    untrackedFilesHiddenForPerformance: true
  })
})

test('keeps tracked modifications when untracked files are hidden', () => {
  const trackedFile = { path: 'modified.txt', kind: 'edit', status: ' M' }
  const files = [...makeFiles(maxVisibleUntrackedGitFiles + 1), trackedFile]

  assert.deepEqual(limitVisibleUntrackedGitFiles(files), {
    files: [trackedFile],
    untrackedFilesHiddenForPerformance: true
  })
})

test('counts only untracked files toward the display limit', () => {
  const trackedFiles = Array.from({ length: maxVisibleUntrackedGitFiles + 1 }, (_, index) => ({
    path: `modified-${index}.txt`,
    kind: 'edit',
    status: ' M'
  }))

  assert.deepEqual(limitVisibleUntrackedGitFiles(trackedFiles), {
    files: trackedFiles,
    untrackedFilesHiddenForPerformance: false
  })
})
