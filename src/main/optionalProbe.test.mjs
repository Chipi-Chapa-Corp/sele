import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import {
  availabilityFoundMarker,
  getContainerCommandAvailabilityScript,
  isExecutableFile,
  isExpectedOptionalGitProbeFailure,
  isExpectedShellCandidateAbsence,
  loadOptionalFile,
  logUnexpectedOptionalGitProbeFailure
} from './optionalProbe.ts'

const execFileAsync = promisify(execFile)

const captureWarnings = async (run) => {
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args)
  try {
    await run()
  } finally {
    console.warn = originalWarn
  }
  return warnings
}

test('optional icon reads keep absence quiet and log operational failures', async () => {
  const warnings = await captureWarnings(async () => {
    assert.equal(
      await loadOptionalFile(async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      }, 'icon failed'),
      null
    )
    assert.equal(
      await loadOptionalFile(async () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' })
      }, 'icon failed'),
      null
    )
    assert.equal(
      await loadOptionalFile(async () => {
        throw Object.assign(new Error('I/O failure'), { code: 'EIO' })
      }, 'icon failed'),
      null
    )
  })

  assert.equal(warnings.length, 2)
  assert.equal(warnings[0][1].code, 'EACCES')
  assert.equal(warnings[1][1].code, 'EIO')
})

test('container command absence uses a successful sentinel probe', async () => {
  const missing = await execFileAsync('sh', [
    '-lc',
    getContainerCommandAvailabilityScript('sele-command-that-does-not-exist')
  ])
  assert.equal(missing.stdout.includes(availabilityFoundMarker), false)

  const available = await execFileAsync('sh', ['-lc', getContainerCommandAvailabilityScript('sh')])
  assert.equal(available.stdout.includes(availabilityFoundMarker), true)
})

test('Git optional probes silence only their documented negative results', async () => {
  assert.equal(
    isExpectedOptionalGitProbeFailure(['config', '--get', 'remote.pushDefault'], { code: 1 }, ''),
    true
  )
  assert.equal(
    isExpectedOptionalGitProbeFailure(
      ['rev-parse', '--show-toplevel'],
      { code: 128 },
      'fatal: not a git repository'
    ),
    true
  )
  assert.equal(
    isExpectedOptionalGitProbeFailure(
      ['rev-parse', '--show-toplevel', 'HEAD'],
      { code: 128 },
      'fatal: ambiguous argument HEAD: unknown revision'
    ),
    true
  )

  const warnings = await captureWarnings(async () => {
    logUnexpectedOptionalGitProbeFailure(
      ['config', '--get', 'remote.pushDefault'],
      { code: 1 },
      '',
      'expected miss'
    )
    logUnexpectedOptionalGitProbeFailure(
      ['status'],
      { code: 1 },
      'fatal: repository is corrupt',
      'unexpected failure'
    )
    logUnexpectedOptionalGitProbeFailure(
      ['rev-parse', '--show-toplevel'],
      { code: 128 },
      'fatal: detected dubious ownership',
      'unsafe repository'
    )
    logUnexpectedOptionalGitProbeFailure(
      ['config', '--get', 'remote.pushDefault'],
      { code: 1, killed: true, signal: 'SIGTERM' },
      '',
      'timed out'
    )
  })

  assert.deepEqual(
    warnings.map(([message]) => message),
    ['unexpected failure', 'unsafe repository', 'timed out']
  )
})

test('executable lookup keeps missing and nonexecutable PATH candidates quiet', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-command-probe-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const nonExecutableName = `sele-nonexecutable-${process.pid}`
  await writeFile(join(directory, nonExecutableName), '#!/bin/sh\nexit 0\n', 'utf8')
  await chmod(join(directory, nonExecutableName), 0o644)

  const errors = []
  const originalError = console.error
  console.error = (...args) => errors.push(args)
  try {
    assert.equal(await isExecutableFile(join(directory, `sele-missing-${process.pid}`)), false)
    assert.equal(await isExecutableFile(join(directory, nonExecutableName)), false)
    assert.equal(
      await isExecutableFile(join(directory, 'io-error'), async () => {
        throw Object.assign(new Error('I/O failure'), { code: 'EIO' })
      }),
      false
    )
  } finally {
    console.error = originalError
  }

  assert.equal(errors.length, 1)
  assert.equal(errors[0][1].code, 'EIO')
})

test('shell candidate absence does not hide permission or transport failures', () => {
  assert.equal(isExpectedShellCandidateAbsence({ code: 'ENOENT' }), true)
  assert.equal(
    isExpectedShellCandidateAbsence(
      { code: 1 },
      'Failed to execute child process “/missing/fish” (No such file or directory)'
    ),
    true
  )
  assert.equal(isExpectedShellCandidateAbsence({ code: 1 }, 'Permission denied'), false)
  assert.equal(isExpectedShellCandidateAbsence({ code: 1 }, 'SSH connection failed'), false)
  assert.equal(isExpectedShellCandidateAbsence({ code: 'ETIMEDOUT' }, 'timed out'), false)
})
