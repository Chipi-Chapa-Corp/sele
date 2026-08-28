import assert from 'node:assert/strict'
import test from 'node:test'

import { parseGitNumstat, summarizeGitNumstat } from './gitCommitMessage.ts'

test('parses text, binary, and renamed files from null-delimited Git numstat output', () => {
  const files = parseGitNumstat(
    ['12\t3\tsrc/app.ts', '-\t-\tassets/icon.png', '4\t1\t', 'old.ts', 'new.ts', ''].join('\0')
  )

  assert.deepEqual(files, [
    { path: 'src/app.ts', additions: 12, deletions: 3 },
    { path: 'assets/icon.png', additions: null, deletions: null },
    { path: 'new.ts', previousPath: 'old.ts', additions: 4, deletions: 1 }
  ])
})

test('sorts files by changed lines, limits the result, and counts every file', () => {
  const summary = summarizeGitNumstat(
    ['2\t1\tb.ts', '80\t20\tlarge.ts', '5\t5\ta.ts', '0\t0\tempty.txt'].join('\0'),
    2
  )

  assert.deepEqual(summary, {
    fileCount: 4,
    files: [
      { path: 'large.ts', additions: 80, deletions: 20 },
      { path: 'a.ts', additions: 5, deletions: 5 }
    ],
    totalChangedLines: 113
  })
})

test('keeps only the 100 largest changed files by default', () => {
  const output = Array.from(
    { length: 120 },
    (_, index) => `${index + 1}\t0\tfile-${index + 1}.ts`
  ).join('\0')

  const summary = summarizeGitNumstat(output)

  assert.equal(summary.fileCount, 120)
  assert.equal(summary.files.length, 100)
  assert.equal(summary.files[0].path, 'file-120.ts')
  assert.equal(summary.files.at(-1).path, 'file-21.ts')
})
