import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  getRequiredWorkingDirectoryShellLine,
  getTargetTerminalScript,
  targetWorkingDirectoryFailureExitCode
} from './targetShell.ts'

test('enters a target working directory with spaces and quotes', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'sele-target-shell-'))
  context.after(() => rmSync(root, { force: true, recursive: true }))
  const cwd = join(root, "project's files")
  mkdirSync(cwd)

  const result = spawnSync(
    'sh',
    [
      '-lc',
      getTargetTerminalScript({
        command: 'pwd',
        cwd
      })
    ],
    {
      encoding: 'utf8',
      env: process.env
    }
  )

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), cwd)
})

test('does not run a command when the target working directory is unavailable', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'sele-target-shell-'))
  context.after(() => rmSync(root, { force: true, recursive: true }))
  const missingCwd = join(root, 'missing project')

  const result = spawnSync(
    'sh',
    [
      '-lc',
      getTargetTerminalScript({
        command: "printf '%s\\n' command-ran",
        cwd: missingCwd
      })
    ],
    {
      encoding: 'utf8',
      env: process.env
    }
  )

  assert.equal(result.status, targetWorkingDirectoryFailureExitCode)
  assert.doesNotMatch(result.stdout, /command-ran/)
})

test('requires a successful directory change before starting an interactive shell', () => {
  assert.equal(
    getTargetTerminalScript({ cwd: '/host/project' }),
    `${getRequiredWorkingDirectoryShellLine('/host/project')}\nexec "\${SHELL:-/bin/sh}" -l`
  )
})
