import assert from 'node:assert/strict'
import test from 'node:test'
import { startProcessMemoryDiagnostics } from './processMemoryDiagnostics.ts'

const metric = (workingSetSize) => ({
  pid: 123,
  type: 'Tab',
  creationTime: 1000,
  memory: { workingSetSize, peakWorkingSetSize: workingSetSize },
  // Only memory/process identity belongs in these diagnostics.
  name: 'PRIVATE WINDOW CONTENT'
})

test('records memory trends, retains only the latest sample, and stops on disposal', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const logs = []
  const input = metric(1024)
  const monitor = startProcessMemoryDiagnostics({
    read: () => [input],
    logDiagnostic: (level, details) => {
      assert.equal(level, 'info')
      logs.push(details)
    }
  })
  t.after(() => monitor.dispose())
  assert.equal(logs.length, 1)
  assert.equal(monitor.latest(), logs[0])
  assert.equal(Date.parse(logs[0].time), Date.now())
  assert.equal(logs[0].processes[0].memory.workingSetSize, 1024)
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|name/)
  input.memory.workingSetSize = 2048
  assert.equal(logs[0].processes[0].memory.workingSetSize, 1024, 'samples are independent')
  t.mock.timers.tick(60_000)
  assert.equal(logs.length, 2)
  assert.equal(monitor.latest(), logs[1])
  assert.equal(logs[1].processes[0].memory.workingSetSize, 2048)
  monitor.dispose()
  t.mock.timers.tick(120_000)
  assert.equal(logs.length, 2)
})

test('reports sampling failures and preserves the last successful pre-crash sample', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  let fail = true
  const errors = []
  const monitor = startProcessMemoryDiagnostics({
    read: () => {
      if (fail) throw new Error('metrics unavailable')
      return [metric(4096)]
    },
    logDiagnostic: (level, details) => {
      if (level === 'warn') errors.push(details)
    }
  })
  t.after(() => monitor.dispose())
  assert.equal(monitor.latest(), null)
  assert.match(errors[0].message, /metrics unavailable/)
  fail = false
  t.mock.timers.tick(60_000)
  const last = monitor.latest()
  assert.equal(last.processes[0].memory.workingSetSize, 4096)
  fail = true
  t.mock.timers.tick(60_000)
  assert.equal(errors.length, 2)
  assert.equal(monitor.latest(), last)
  fail = false
  t.mock.timers.tick(60_000)
  assert.notEqual(monitor.latest(), last, 'sampling resumes after transient failure')
})
