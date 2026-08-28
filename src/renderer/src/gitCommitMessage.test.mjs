import assert from 'node:assert/strict'
import test from 'node:test'

import { getCommitMessageGenerationPrompt } from './gitCommitMessage.ts'

const settings = {
  prompt: 'Generate a commit name.',
  largeChangePrompt: 'Inspect only a few important files with read-only tools.',
  aiInstructionsPrefix: 'AI instructions:'
}

test('includes the full diff for changes of exactly 1,000 lines', () => {
  const prompt = getCommitMessageGenerationPrompt(
    {
      diff: 'diff --git a/a.ts b/a.ts\n+new line',
      fileCount: 1,
      files: [{ path: 'a.ts', additions: 1_000, deletions: 0 }],
      totalChangedLines: 1_000
    },
    ['Previous commit'],
    '',
    settings
  )

  assert.match(prompt, /Git diff:\ndiff --git/)
  assert.doesNotMatch(prompt, /Inspect only a few important files/)
  assert.doesNotMatch(prompt, /Changed-file summary/)
})

test('uses ranked file stats instead of a diff above 1,000 changed lines', () => {
  const prompt = getCommitMessageGenerationPrompt(
    {
      diff: null,
      fileCount: 140,
      files: [
        { path: 'src/large.ts', additions: 800, deletions: 300 },
        { path: 'assets/icon.png', additions: null, deletions: null }
      ],
      totalChangedLines: 1_101
    },
    [],
    'focus on the renderer',
    settings
  )

  assert.match(prompt, /Inspect only a few important files with read-only tools/)
  assert.match(prompt, /Total changed lines: 1101/)
  assert.match(prompt, /Changed files \(2 largest of 140, largest first\)/)
  assert.match(prompt, /"src\/large\.ts": 1100 changed lines \(\+800, -300\)/)
  assert.match(prompt, /"assets\/icon\.png": binary change/)
  assert.match(prompt, /AI instructions: "focus on the renderer"/)
  assert.doesNotMatch(prompt, /Git diff:/)
})
