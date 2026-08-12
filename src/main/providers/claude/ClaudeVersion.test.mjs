import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getClaudeUpdateAvailabilityFromVersions,
  parseClaudeVersion,
  supportsClaudeResumeDropsTurn
} from './ClaudeVersion.ts'

test('parses Claude Code version output', () => {
  assert.equal(parseClaudeVersion('2.1.217 (Claude Code)'), '2.1.217')
})

test('reports a newer Claude Code release', () => {
  assert.deepEqual(getClaudeUpdateAvailabilityFromVersions('2.1.217', '2.1.228'), {
    currentVersion: '2.1.217',
    latestVersion: '2.1.228'
  })
})

test('does not report current or older Claude Code releases', () => {
  assert.equal(getClaudeUpdateAvailabilityFromVersions('2.1.228', '2.1.228'), null)
  assert.equal(getClaudeUpdateAvailabilityFromVersions('2.1.229', '2.1.228'), null)
})

test('detects support for guarded turn replacement', () => {
  assert.equal(supportsClaudeResumeDropsTurn('2.1.217'), false)
  assert.equal(supportsClaudeResumeDropsTurn('2.1.228'), true)
  assert.equal(supportsClaudeResumeDropsTurn('2.2.0'), true)
})
