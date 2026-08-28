import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browserScalePercentDefault, normalizeBrowserScalePercent } from '../../shared/browser.ts'
import {
  appMaxChatsRenderedDefault,
  appRecentlyOpenedFilesLimitDefault,
  appRecentsMessageLimitDefault,
  normalizeAppMaxChatsRendered,
  normalizeAppRecentlyOpenedFilesLimit,
  normalizeAppRecentsMessageLimit
} from './performanceSettings.ts'
import { getAppGitCommitModel, setAppGitCommitModel } from './gitCommitModels.ts'
import { toCssRem } from './cssUnits.ts'
import { defaultAppGitQuickActionsSettings } from './gitQuickActions.ts'

test('converts runtime pixel measurements to rem lengths', () => {
  assert.equal(toCssRem(1), '0.0625rem')
  assert.equal(toCssRem(16), '1rem')
})

test('defaults and normalizes the browser scale percentage', () => {
  assert.equal(browserScalePercentDefault, 100)
  assert.equal(normalizeBrowserScalePercent(undefined), 100)
  assert.equal(normalizeBrowserScalePercent(112.6), 113)
  assert.equal(normalizeBrowserScalePercent(0), 25)
  assert.equal(normalizeBrowserScalePercent(10_000), 500)
})

test('defaults the maximum rendered chats to 100', () => {
  assert.equal(appMaxChatsRenderedDefault, 100)
  assert.equal(normalizeAppMaxChatsRendered(undefined), 100)
})

test('normalizes maximum rendered chat counts', () => {
  assert.equal(normalizeAppMaxChatsRendered(34.8), 34)
  assert.equal(normalizeAppMaxChatsRendered(0), 1)
  assert.equal(normalizeAppMaxChatsRendered(10_000), 10_000)
})

test('defaults the Recents message window to 30', () => {
  assert.equal(appRecentsMessageLimitDefault, 30)
  assert.equal(normalizeAppRecentsMessageLimit(undefined), 30)
})

test('normalizes the Recents message window', () => {
  assert.equal(normalizeAppRecentsMessageLimit(42.8), 42)
  assert.equal(normalizeAppRecentsMessageLimit(0), 1)
  assert.equal(normalizeAppRecentsMessageLimit(10_000), 50)
})

test('defaults the recently opened file count to 5', () => {
  assert.equal(appRecentlyOpenedFilesLimitDefault, 5)
  assert.equal(normalizeAppRecentlyOpenedFilesLimit(undefined), 5)
})

test('normalizes the recently opened file count', () => {
  assert.equal(normalizeAppRecentlyOpenedFilesLimit(8.9), 8)
  assert.equal(normalizeAppRecentlyOpenedFilesLimit(-1), 0)
  assert.equal(normalizeAppRecentlyOpenedFilesLimit(10_000), 50)
})

test('stores Git commit models per provider and environment', () => {
  const commitModels = setAppGitCommitModel(
    setAppGitCommitModel({}, 'codex', 'host', 'gpt-5.6'),
    'claude',
    'ssh:dev/from:host',
    'opus'
  )

  assert.equal(getAppGitCommitModel(commitModels, 'codex', 'host'), 'gpt-5.6')
  assert.equal(getAppGitCommitModel(commitModels, 'claude', 'ssh:dev/from:host'), 'opus')
  assert.equal(getAppGitCommitModel(commitModels, 'claude', 'host'), null)
})

test('allows one Git configuration to use the selected chat model', () => {
  const commitModels = setAppGitCommitModel({ '*': 'legacy-model' }, 'codex', 'host', null)

  assert.equal(getAppGitCommitModel(commitModels, 'codex', 'host'), null)
  assert.equal(getAppGitCommitModel(commitModels, 'codex', 'docker:dev'), 'legacy-model')
})

test('defaults Git quick action visibility settings', () => {
  assert.deepEqual(defaultAppGitQuickActionsSettings, {
    showManualCommit: true,
    showAiInstructionsInput: true
  })
})
