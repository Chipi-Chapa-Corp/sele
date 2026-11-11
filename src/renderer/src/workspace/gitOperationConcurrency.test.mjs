import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const bundled = await build({
  entryPoints: [
    new URL('./useFileNavigationController.tsx', import.meta.url).pathname,
    new URL('./useGitSyncController.tsx', import.meta.url).pathname
  ],
  outdir: 'unused',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'lucide-react'],
  loader: { '.css': 'empty' },
  write: false
})
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function fixture() {
  const requests = []
  const globals = {
    require: (name) =>
      name === 'react'
        ? { ...require(name), useCallback: (fn) => fn, useRef: (value) => ({ current: value }) }
        : require(name),
    console: { error: () => {} },
    window: {
      appApi: Object.fromEntries(
        ['switchGitBranch', 'deleteGitBranch', 'pullGitChanges', 'pushGitChanges'].map((method) => [
          method,
          (options) => {
            const request = { method, options, ...deferred() }
            requests.push(request)
            return request.promise
          }
        ])
      )
    }
  }
  const controllers = {}
  for (const file of bundled.outputFiles) {
    const module = { exports: {} }
    vm.runInNewContext(file.text, { ...globals, module, exports: module.exports })
    Object.assign(controllers, module.exports)
  }
  const noop = () => {}
  const dependencies = {
    branchSwitchDisabled: false,
    branchActionProjectKeysRef: { current: new Set() },
    setBranchActionProjectKeys: noop,
    gitBranchRequestIdRef: { current: 0 },
    setGitBranchActionState: noop,
    setGitBranchError: noop,
    setGitBranchDeleteRetry: noop,
    setGitBranchWorktreeDeleteRetry: noop,
    setGitBranches: noop,
    setGitBranchesScope: noop,
    setGitBranchLoadState: noop,
    setGitChangeLoadRequest: noop,
    setFileTreeLoadRequest: noop,
    syncProjectKeysRef: { current: new Set() },
    commitInFlightProjectKeysRef: { current: new Set() },
    commitMessageGenerationProjectKeysRef: { current: new Set() },
    hasAiCommitInProgressForProject: () => false,
    setSyncProjectKeys: noop,
    setSyncErrorsByProjectKey: noop,
    setSyncRecoveriesByProjectKey: noop,
    effectiveAppSettings: { git: { errorResolutionPrompt: '', permanentErrorResolutionPrompt: '' } }
  }
  const project = (cwd) => {
    const scoped = {
      ...dependencies,
      currentProjectKey: `cwd:${cwd}`,
      changesProjectCwd: cwd,
      changesCwd: cwd
    }
    return {
      files: controllers.useFileNavigationController(scoped),
      sync: controllers.useGitSyncController(scoped)
    }
  }
  return { requests, dependencies, project }
}

for (const failFirst of [false, true]) {
  test(`branch locks survive navigation and release independently (failure=${failFirst})`, async () => {
    const f = fixture()
    const a = f.project('/project-a')
    const pendingA = a.files.handleSwitchBranch('feature', false)
    assert.equal(await a.files.handleSwitchBranch('duplicate', false), false)
    await a.files.handleDeleteBranch('duplicate')
    await a.sync.runSyncChanges('push', '/project-a')
    assert.equal(f.requests.length, 1, 'the same project stays locked')

    const b = f.project('/project-b')
    const pendingB = b.files.handleDeleteBranch('old-branch')
    assert.equal(f.requests.length, 2, 'another project can run Git operations')
    assert.equal(f.dependencies.branchActionProjectKeysRef.current.size, 2)
    if (failFirst) f.requests[0].reject(new Error('Failed switch'))
    else f.requests[0].resolve({})
    assert.equal(await pendingA, !failFirst)
    assert.equal(f.dependencies.branchActionProjectKeysRef.current.has('cwd:/project-a'), false)
    assert.equal(f.dependencies.branchActionProjectKeysRef.current.has('cwd:/project-b'), true)

    f.requests[1].resolve({ cancelled: true })
    await pendingB
    assert.equal(f.dependencies.branchActionProjectKeysRef.current.size, 0)
    const retry = b.files.handleSwitchBranch('next', false)
    assert.equal(f.requests.length, 3, 'the project is unlocked after completion')
    f.requests[2].resolve({})
    assert.equal(await retry, true)
  })
}

test('pull and push in different projects can overlap and release their own locks', async () => {
  const f = fixture()
  const a = f.project('/project-a')
  const b = f.project('/project-b')
  const pendingA = a.sync.runSyncChanges('push', '/project-a')
  await a.sync.runSyncChanges('pull', '/project-a')
  const pendingB = b.sync.runSyncChanges('pull', '/project-b')
  assert.equal(f.requests.length, 2)
  f.requests[0].resolve({})
  await pendingA
  assert.equal(f.dependencies.syncProjectKeysRef.current.has('cwd:/project-a'), false)
  assert.equal(f.dependencies.syncProjectKeysRef.current.has('cwd:/project-b'), true)
  f.requests[1].resolve({})
  await pendingB
  assert.equal(f.dependencies.syncProjectKeysRef.current.size, 0)
})
