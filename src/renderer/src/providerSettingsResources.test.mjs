import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  areAnySettingsProviderSkillsEnabled,
  groupSettingsProviderResources,
  isSettingsProviderAppGroupEnabled,
  resolveSettingsProviderSkillUpdates,
  shouldShowSettingsProviderAppSkills
} from '../../shared/providerOwnership.ts'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const skill = (name, path, providerIds = ['codex']) => ({
  providerId: providerIds[0],
  providerIds,
  skill: {
    name,
    description: '',
    shortDescription: null,
    displayName: null,
    path,
    scope: 'user',
    enabled: true
  }
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const app = (id, skillNames, providerId = 'codex') => ({
  providerId,
  app: {
    id,
    name: id,
    description: '',
    enabled: true,
    callable: true,
    skillNames
  }
})

test('groups plugin skills under their app and leaves standalone skills unparented', () => {
  const github = skill('github:github', '/skills/github')
  const standalone = skill('standalone', '/skills/standalone')
  const resources = groupSettingsProviderResources(
    [github, standalone],
    [app('github', ['github:github'])]
  )

  assert.deepEqual(resources.appGroups[0].skills, [github])
  assert.deepEqual(resources.unparentedSkills, [standalone])
})

test('matches app children against every provider that reports a merged skill', () => {
  const shared = skill('github:github', '/skills/github', ['copilot', 'codex'])
  const resources = groupSettingsProviderResources(
    [shared],
    [app('github', ['github:github'], 'codex')]
  )

  assert.deepEqual(resources.appGroups[0].skills, [shared])
  assert.deepEqual(resources.unparentedSkills, [])
})

test('assigns a skill to only the first app that claims it', () => {
  const shared = skill('plugin:shared', '/skills/shared')
  const resources = groupSettingsProviderResources(
    [shared],
    [app('first', ['plugin:shared']), app('second', ['plugin:shared'])]
  )

  assert.deepEqual(
    resources.appGroups.map((group) => group.skills.length),
    [1, 0]
  )
})

test('groups qualified plugin skills by app name when exact plugin metadata is unavailable', () => {
  const gmail = skill('gmail:gmail', '/skills/gmail')
  const resources = groupSettingsProviderResources([gmail], [app('Gmail', [])])

  assert.deepEqual(resources.appGroups[0].skills, [gmail])
  assert.deepEqual(resources.unparentedSkills, [])
})

test('does not infer ownership for unqualified standalone skill names', () => {
  const standalone = skill('gmail', '/skills/gmail')
  const resources = groupSettingsProviderResources([standalone], [app('Gmail', [])])

  assert.deepEqual(resources.appGroups[0].skills, [])
  assert.deepEqual(resources.unparentedSkills, [standalone])
})

test('keeps an app master switch on while any child still needs disabling', () => {
  const child = skill('github:github', '/skills/github')
  const resources = groupSettingsProviderResources(
    [child],
    [{ ...app('GitHub', []), app: { ...app('GitHub', []).app, enabled: false } }]
  )

  assert.equal(isSettingsProviderAppGroupEnabled(resources.appGroups[0]), true)
  assert.equal(shouldShowSettingsProviderAppSkills(resources.appGroups[0]), true)
})

test('hides app skills when the app and all of its skills are disabled', () => {
  const disabledChild = {
    ...skill('github:github', '/skills/github'),
    skill: { ...skill('github:github', '/skills/github').skill, enabled: false }
  }
  const disabledApp = app('GitHub', ['github:github'])
  const resources = groupSettingsProviderResources(
    [disabledChild],
    [{ ...disabledApp, app: { ...disabledApp.app, enabled: false } }]
  )

  assert.equal(isSettingsProviderAppGroupEnabled(resources.appGroups[0]), false)
  assert.equal(shouldShowSettingsProviderAppSkills(resources.appGroups[0]), false)
})

test('keeps the standalone master switch on while any standalone skill is enabled', () => {
  const enabled = skill('enabled', '/skills/enabled')
  const disabled = {
    ...skill('disabled', '/skills/disabled'),
    skill: { ...skill('disabled', '/skills/disabled').skill, enabled: false }
  }

  assert.equal(areAnySettingsProviderSkillsEnabled([enabled, disabled]), true)
  assert.equal(areAnySettingsProviderSkillsEnabled([disabled]), false)
})

test('reconciles a partial bulk update without rolling successful skills back', () => {
  const first = skill('first', '/skills/first')
  const second = skill('second', '/skills/second')
  const result = resolveSettingsProviderSkillUpdates(
    [first, second],
    [{ ...first.skill, enabled: false }, second.skill],
    false
  )

  assert.equal(result.skillsByPath.get(first.skill.path)?.enabled, false)
  assert.equal(result.skillsByPath.get(second.skill.path)?.enabled, true)
  assert.equal(result.failedCount, 1)
})

test('restores the prior state when a bulk response omits a requested skill', () => {
  const requested = skill('missing', '/skills/missing')
  const result = resolveSettingsProviderSkillUpdates([requested], [], false)

  assert.equal(result.skillsByPath.get(requested.skill.path)?.enabled, true)
  assert.equal(result.failedCount, 1)
})
