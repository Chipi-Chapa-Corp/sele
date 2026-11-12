import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const extract = (file, predicate) => {
  const source = ts.createSourceFile(
    file,
    readFileSync(new URL(file, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  let expression
  const visit = (node) => {
    if (predicate(node, source)) expression = node.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expression, `Found callback in ${file}`)
  return ts.transpile(`(${expression})`, { target: ts.ScriptTarget.ES2022 })
}
const effect = extract(
  './workspace/useWorkspaceSelection.tsx',
  (node, source) =>
    ts.isArrowFunction(node) &&
    ts.isCallExpression(node.parent) &&
    node.parent.expression.getText(source) === 'useEffect' &&
    node.getText(source).includes('.getGitChanges(')
)
const reload = extract(
  './workspace/components/ChangesHeader.tsx',
  (node, source) =>
    ts.isArrowFunction(node) &&
    ts.isJsxExpression(node.parent) &&
    ts.isJsxAttribute(node.parent.parent) &&
    node.parent.parent.name.getText(source) === 'callback' &&
    node.getText(source).includes('setGitChangeLoadRequest')
)
const settle = () => new Promise(setImmediate)
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const setup = () => {
  const calls = [],
    pending = [],
    timers = new Map(),
    errors = []
  const state = {}
  let timerId = 0,
    cleanup
  const context = vm.createContext({
    changesCwd: '/project',
    changesPaneView: 'git',
    changesContainerRef: { current: { kind: 'ssh', environmentId: 'server' } },
    gitAvailabilityScopeKey: 'available',
    gitAvailableForCurrentSource: true,
    gitRemoteFetchInterval: 60_000,
    queueMicrotask,
    startTransition: (callback) => callback(),
    getErrorMessage: (error) => error.message,
    console: { error: (...args) => errors.push(args) },
    window: {
      setTimeout: (callback, delay) => {
        const id = ++timerId
        timers.set(id, { callback, delay })
        return id
      },
      clearTimeout: (id) => timers.delete(id)
    },
    appApi: {
      getGitChanges: (options) => {
        calls.push(options)
        const response = deferred()
        pending.push(response)
        return response.promise
      }
    },
    setGitChangeLoadRequest: () => {
      cleanup()
      cleanup = vm.runInContext(effect, context)()
    }
  })
  for (const key of [
    'GitChanges',
    'GitChangesScope',
    'GitChangeLoadScope',
    'GitChangeLoadErrorDismissed',
    'GitChangeLoadError',
    'GitChangeLoadState'
  ]) {
    context[`set${key}`] = (value) => {
      state[key] = value
    }
  }
  cleanup = vm.runInContext(effect, context)()
  return {
    calls,
    pending,
    timers,
    state,
    context,
    errors,
    dispose: () => cleanup(),
    reload: () => vm.runInContext(reload, context)(),
    tick: () => {
      const [id, timer] = timers.entries().next().value
      timers.delete(id)
      timer.callback()
    }
  }
}

test('initial selection, periodic refresh, and Reload request remote fetch and update incoming counts', async () => {
  const h = setup()
  assert.equal(h.calls[0].fetchRemote, true)
  assert.equal(h.calls[0].container, h.context.changesContainerRef.current)
  assert.equal(h.timers.size, 0, 'No overlapping refresh while a fetch is running')
  h.pending[0].resolve({ unpulledCount: 0 })
  await settle()
  assert.equal(h.state.GitChangeLoadState, 'ready')
  assert.equal([...h.timers.values()][0].delay, 60_000)
  h.tick()
  assert.equal(h.calls.length, 2)
  h.pending[1].resolve({ unpulledCount: 2 })
  await settle()
  assert.equal(h.state.GitChanges.unpulledCount, 2)
  h.reload()
  assert.equal(h.calls.length, 3)
  assert.ok(h.calls.every((call) => call.fetchRemote === true))
  h.pending[2].resolve({ unpulledCount: 3 })
  await settle()
  assert.equal(h.state.GitChanges.unpulledCount, 3)
  assert.equal(h.timers.size, 1)
  h.dispose()
  assert.equal(h.timers.size, 0)
})

test('fetch failure preserves local files, shows the error, and retries periodically', async () => {
  const h = setup()
  h.pending[0].resolve({ files: [{ path: 'local.txt' }], remoteFetchError: 'offline' })
  await settle()
  assert.equal(h.state.GitChanges.files[0].path, 'local.txt')
  assert.equal(h.state.GitChangeLoadError.error, 'offline')
  assert.equal(h.state.GitChangeLoadError.operation, 'Fetch Git remote')
  h.tick()
  h.pending[1].reject(new Error('IPC failed'))
  await settle()
  assert.equal(h.state.GitChanges.files[0].path, 'local.txt')
  assert.equal(h.errors.length, 1)
  h.tick()
  h.pending[2].resolve({ unpulledCount: 2 })
  await settle()
  assert.equal(h.state.GitChangeLoadError, null)
  assert.equal(h.state.GitChanges.unpulledCount, 2)
  h.dispose()
})

test('disposing a selection ignores late responses and stops periodic refresh', async () => {
  const h = setup()
  await settle()
  h.dispose()
  h.pending[0].resolve({ unpulledCount: 99 })
  await settle()
  assert.equal(h.state.GitChanges, undefined)
  assert.equal(h.timers.size, 0)
})
