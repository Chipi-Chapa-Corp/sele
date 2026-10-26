import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { startProcessMemoryDiagnostics } from './processMemoryDiagnostics.ts'

test('crash diagnostics include the preceding memory sample and stop sampling on quit', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const entries = []
  const app = Object.assign(new EventEmitter(), {
    setAppLogsPath() {},
    getPath: () => '/fixture/logs',
    getVersion: () => '0.0.0-fixture',
    getAppMetrics: () => [
      { pid: 123, type: 'Tab', creationTime: 1, memory: { workingSetSize: 4096 } }
    ]
  })
  const source = readFileSync(new URL('./logging.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  vm.runInNewContext(code, {
    exports: {},
    require: (id) => {
      if (id === 'electron') return { app, ipcMain: { handle() {} } }
      if (id === 'node:path') return path
      if (id === './processMemoryDiagnostics') return { startProcessMemoryDiagnostics }
      if (id === './diagnosticLog')
        return { createDiagnosticLog: () => ({ write: (...entry) => entries.push(entry) }) }
      throw new Error(`Unexpected module: ${id}`)
    },
    console: { error() {}, warn() {} },
    process: Object.assign(new EventEmitter(), {
      platform: 'fixture',
      arch: 'fixture',
      versions: { electron: 'fixture', node: 'fixture' }
    })
  })
  t.after(() => app.emit('will-quit'))
  assert.equal(
    entries.some((entry) => entry[1] === 'process-memory'),
    false
  )
  app.emit('ready')
  const sample = entries.find((entry) => entry[1] === 'process-memory')[2]
  const contents = Object.assign(new EventEmitter(), { id: 42, getType: () => 'window' })
  app.emit('web-contents-created', {}, contents)
  contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 5 })
  const crash = entries.find((entry) => entry[1] === 'renderer-process')
  assert.equal(crash[0], 'error')
  assert.equal(crash[2].reason, 'crashed')
  assert.equal(crash[2].exitCode, 5)
  assert.equal(crash[2].webContentsId, 42)
  assert.equal(crash[2].lastMemorySample, sample)
  assert.equal(sample.processes[0].memory.workingSetSize, 4096)
  const count = entries.length
  contents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 })
  assert.equal(entries.length, count)
  t.mock.timers.tick(60_000)
  assert.equal(entries.length, count + 1)
  app.emit('will-quit')
  t.mock.timers.tick(60_000)
  assert.equal(entries.length, count + 1)
})
