import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  disableProviderSkill,
  listDisabledProviderSkills,
  mergeCodexProviderSkills,
  mergeProviderSkills,
  restoreProviderSkill
} from './providerResources.ts'

test('moves disabled host skills into Sele storage and restores their original path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sele-provider-resource-test-'))
  const originalDataHome = process.env.XDG_DATA_HOME
  const originalPath = join(root, 'skills', 'example-skill')
  process.env.XDG_DATA_HOME = join(root, 'data')

  try {
    await mkdir(originalPath, { recursive: true })
    await writeFile(join(originalPath, 'SKILL.md'), '# Example\n', 'utf8')

    const skill = {
      name: 'example-skill',
      description: 'A reusable example workflow.',
      shortDescription: 'Example workflow',
      displayName: 'Example Skill',
      path: originalPath,
      scope: 'user',
      enabled: true
    }

    await disableProviderSkill('codex', skill, null)
    assert.equal(await stat(originalPath).catch(() => null), null)

    const disabledSkills = await listDisabledProviderSkills('codex', null)
    assert.deepEqual(disabledSkills, [{ ...skill, enabled: false }])
    assert.deepEqual(await listDisabledProviderSkills('claude', null), [])

    assert.equal(await restoreProviderSkill(originalPath, null), true)
    assert.equal(await readFile(join(originalPath, 'SKILL.md'), 'utf8'), '# Example\n')
    assert.deepEqual(await listDisabledProviderSkills('codex', null), [])
  } finally {
    if (originalDataHome === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = originalDataHome
    await rm(root, { force: true, recursive: true })
  }
})

test('moves the skill folder when a provider reports its SKILL.md path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sele-provider-manifest-path-test-'))
  const originalDataHome = process.env.XDG_DATA_HOME
  const originalDirectory = join(root, 'skills', 'manifest-path-skill')
  const reportedPath = join(originalDirectory, 'SKILL.md')
  process.env.XDG_DATA_HOME = join(root, 'data')

  try {
    await mkdir(originalDirectory, { recursive: true })
    await writeFile(reportedPath, '# Manifest path\n', 'utf8')

    const skill = {
      name: 'manifest-path-skill',
      description: 'A skill reported by its manifest path.',
      shortDescription: 'Manifest path skill',
      displayName: 'Manifest Path Skill',
      path: reportedPath,
      scope: 'user',
      enabled: true
    }

    await disableProviderSkill('codex', skill, null)
    assert.equal(await stat(originalDirectory).catch(() => null), null)
    assert.deepEqual(await listDisabledProviderSkills('codex', null), [
      { ...skill, enabled: false }
    ])

    assert.equal(await restoreProviderSkill(reportedPath, null), true)
    assert.equal(await readFile(reportedPath, 'utf8'), '# Manifest path\n')
  } finally {
    if (originalDataHome === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = originalDataHome
    await rm(root, { force: true, recursive: true })
  }
})

test('can leave a recreated skill in place instead of restoring an older moved copy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sele-provider-recreated-skill-test-'))
  const originalDataHome = process.env.XDG_DATA_HOME
  const originalPath = join(root, 'skills', 'managed-skill')
  process.env.XDG_DATA_HOME = join(root, 'data')

  try {
    await mkdir(originalPath, { recursive: true })
    await writeFile(join(originalPath, 'SKILL.md'), '# Original\n', 'utf8')

    const skill = {
      name: 'managed-skill',
      description: 'A managed skill.',
      shortDescription: null,
      displayName: null,
      path: originalPath,
      scope: 'system',
      enabled: true
    }

    await disableProviderSkill('codex', skill, null)
    await mkdir(originalPath, { recursive: true })
    await writeFile(join(originalPath, 'SKILL.md'), '# Recreated\n', 'utf8')

    assert.equal(await restoreProviderSkill(originalPath, null, { skipIfOccupied: true }), false)
    assert.equal(await readFile(join(originalPath, 'SKILL.md'), 'utf8'), '# Recreated\n')
    assert.deepEqual(await listDisabledProviderSkills('codex', null), [
      { ...skill, enabled: false }
    ])
  } finally {
    if (originalDataHome === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = originalDataHome
    await rm(root, { force: true, recursive: true })
  }
})

test('filters legacy disabled skills by provider-specific paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sele-provider-legacy-resource-test-'))
  const originalDataHome = process.env.XDG_DATA_HOME
  const disabledEntry = join(root, 'data', 'sele', 'providers', 'disabled-skills', 'legacy')
  process.env.XDG_DATA_HOME = join(root, 'data')

  try {
    const skill = {
      name: 'claude-only',
      description: 'A Claude skill.',
      shortDescription: 'Claude skill',
      displayName: 'Claude Only',
      path: join(root, '.claude', 'skills', 'claude-only', 'SKILL.md'),
      scope: 'user',
      enabled: false
    }
    await mkdir(disabledEntry, { recursive: true })
    await writeFile(
      join(disabledEntry, 'metadata.json'),
      `${JSON.stringify({ version: 1, skill })}\n`,
      'utf8'
    )

    assert.deepEqual(await listDisabledProviderSkills('codex', null), [])
    assert.deepEqual(await listDisabledProviderSkills('claude', null), [skill])
  } finally {
    if (originalDataHome === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = originalDataHome
    await rm(root, { force: true, recursive: true })
  }
})

test('prefers a discovered enabled skill over stale disabled metadata', () => {
  const path = '/tmp/example-skill'
  const skill = {
    name: 'example-skill',
    description: 'A reusable example workflow.',
    shortDescription: 'Example workflow',
    displayName: 'Example Skill',
    path,
    scope: 'user',
    enabled: true
  }
  assert.deepEqual(mergeProviderSkills([skill], [{ ...skill, enabled: false }]), [skill])
})

test('Codex prefers native discovery over stale disabled metadata for the same path', () => {
  const skill = {
    name: 'review-agent',
    description: 'Current system skill.',
    shortDescription: null,
    displayName: 'Review Agent',
    path: '/tmp/.codex/skills/.system/review-agent/SKILL.md',
    scope: 'system',
    enabled: false
  }

  assert.deepEqual(
    mergeCodexProviderSkills(
      [skill],
      [{ ...skill, description: 'Stale moved copy.', enabled: false }]
    ),
    [skill]
  )
})

test('Codex hides a stale disabled plugin version when a current version is discovered', () => {
  const current = {
    name: 'gmail:gmail',
    description: 'Current Gmail skill.',
    shortDescription: null,
    displayName: 'Gmail',
    path: '/tmp/.codex/plugins/cache/gmail/0.1.8/skills/gmail/SKILL.md',
    scope: 'user',
    enabled: true
  }
  const stale = {
    ...current,
    description: 'Old Gmail skill.',
    path: '/tmp/.codex/plugins/cache/gmail/0.1.7/skills/gmail/SKILL.md',
    enabled: false
  }

  assert.deepEqual(mergeCodexProviderSkills([current], [stale]), [current])
})

test('Codex keeps a legacy disabled user skill that has not been rediscovered', () => {
  const disabled = {
    name: 'user-skill',
    description: 'Disabled user skill.',
    shortDescription: null,
    displayName: null,
    path: '/tmp/.codex/skills/user-skill/SKILL.md',
    scope: 'user',
    enabled: false
  }

  assert.deepEqual(mergeCodexProviderSkills([], [disabled]), [disabled])
})
