import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  disableProviderSkill,
  listDisabledProviderSkills,
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
