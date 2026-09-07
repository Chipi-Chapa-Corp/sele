/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript test harness. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createDiagnosticLog } from './diagnosticLog.ts'

const withLog = (run) => {
  const directory = mkdtempSync(join(tmpdir(), 'sele-log-test-'))
  try {
    run(join(directory, 'logs', 'sele.log'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('persists timestamps, severity, error stacks and circular objects across restarts', () => {
  withLog((path) => {
    const circular = {}
    circular.self = circular
    const log = createDiagnosticLog(path)
    log.write('warn', 'main', 'warning', circular)
    createDiagnosticLog(path).write('error', 'main', new Error('failure'))
    const entries = log.snapshot().trim().split('\n').map(JSON.parse)
    assert.equal(entries.length, 2)
    assert.equal(entries[0].level, 'warn')
    assert.match(entries[0].message, /Circular/)
    assert.ok(Number.isFinite(Date.parse(entries[0].time)))
    assert.match(entries[1].message, /Error: failure\n\s+at /)
    if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600)
  })
})

test('rotates bounded files and exports previous entries before current entries', () => {
  withLog((path) => {
    const log = createDiagnosticLog(path, 1024)
    for (let i = 0; i < 30; i++) log.write('warn', 'test', `${i}: ${'x'.repeat(200)}`)
    const entries = log.snapshot().trim().split('\n').map(JSON.parse)
    const numbers = entries.map((entry) => Number(entry.message.split(':')[0]))
    assert.equal(numbers.at(-1), 29)
    assert.deepEqual(
      numbers,
      [...numbers].sort((a, b) => a - b)
    )
    assert.ok(statSync(path).size <= 1024)
    assert.ok(statSync(`${path}.1`).size <= 1024)
    log.write('error', 'test', '\u0000'.repeat(10000))
    assert.ok(statSync(path).size <= 1024)
    assert.equal(JSON.parse(log.snapshot().trim().split('\n').at(-1)).truncated, true)
  })
})
