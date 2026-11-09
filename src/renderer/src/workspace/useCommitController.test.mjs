import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'

const bundled = await build({
  entryPoints: [new URL('./useCommitController.tsx', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false
})

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function fixture(input = '  Fix the bug\n') {
  const commit = deferred()
  const push = deferred()
  const generation = deferred()
  const generationStarted = deferred()
  const commitStarted = deferred()
  const pushStarted = deferred()
  const pushes = []
  const commits = []
  const errors = []
  const module = { exports: {} }
  vm.runInNewContext(bundled.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
    console: { error: (...args) => errors.push(args) },
    crypto: { randomUUID: () => 'id' },
    window: {
      appApi: {
        commitGitChanges: (options) => {
          commits.push(options)
          commitStarted.resolve()
          return commit.promise
        },
        getGitCommitMessageContext: async () => ({ fileCount: 1, diff: '+fix' }),
        getRecentGitCommitMessages: async () => ({ messages: [] })
      },
      providerApi: {
        generateOneShot: () => {
          generationStarted.resolve()
          return generation.promise
        },
        startChat: () => commit.promise
      }
    }
  })
  const noop = () => {}
  const dependencies = {
    changesCwd: '/project-a',
    changesCwdRef: { current: '/project-a' },
    commitInputValue: input.trim(),
    aiCommitInstructions: input.trim(),
    setCommitInput: (update) => {
      input = typeof update === 'function' ? update(input) : update
    },
    commitInFlightProjectKeysRef: { current: new Set() },
    commitMessageGenerationProjectKeysRef: { current: new Set() },
    syncProjectKeysRef: { current: new Set() },
    startingScopedCommitActivitiesRef: { current: {} },
    sendInFlightRef: { current: false },
    chatAutoScrollEnabledRef: { current: false },
    hasAiCommitInProgressForProject: () => false,
    getCommitActionDisabled: () => false,
    getAiCommitActionDisabled: () => false,
    getGitTurnOptions: () => ({}),
    setCommitErrorsByProjectKey: noop,
    setDirectCommitActivities: noop,
    setGitChangeLoadRequest: noop,
    setCommitMessageGenerationProjectKeys: noop,
    setStartingScopedCommitActivities: noop,
    applyChatDetail: noop,
    pushAfterCommit: true,
    runSyncChanges: (action, cwd) => {
      pushes.push({ action, cwd })
      pushStarted.resolve()
      return push.promise
    },
    effectiveAppSettings: {
      git: {
        commitMessageGeneration: { prompt: '', largeChangePrompt: '', aiInstructionsPrefix: '' },
        commitPrompt: {
          instructions: '',
          workflow: '',
          commitStep: '',
          extraInstructionsPrefix: ''
        }
      }
    }
  }
  // biome-ignore lint/correctness/useHookAtTopLevel: this controller creates handlers without calling React hooks.
  const controller = module.exports.useCommitController(dependencies)
  return {
    controller,
    dependencies,
    commit,
    push,
    generation,
    generationStarted,
    commitStarted,
    pushStarted,
    pushes,
    commits,
    errors,
    get input() {
      return input
    },
    switchProject(nextInput = input) {
      dependencies.changesCwdRef.current = '/project-b'
      input = nextInput
    }
  }
}

test('commit and push clears the submitted message after switching projects', async () => {
  const f = fixture()
  const result = f.controller.handleManualCommitChangedFiles()
  f.switchProject()
  f.commit.resolve()
  await f.pushStarted.promise
  assert.equal(f.input, '')
  assert.equal(f.pushes.length, 1)
  assert.equal(f.pushes[0].cwd, '/project-a')
  assert.equal(f.commits[0].message, 'Fix the bug')
  f.switchProject('Next commit')
  f.push.resolve()
  assert.equal(await result, true)
  assert.equal(f.input, 'Next commit')
})

test('commit completion preserves text entered in another project', async () => {
  const f = fixture()
  const result = f.controller.handleManualCommitChangedFiles()
  f.switchProject('New project message')
  f.commit.resolve()
  f.push.resolve()
  assert.equal(await result, true)
  assert.equal(f.input, 'New project message')
})

test('a failed commit preserves its message after switching projects', async () => {
  const f = fixture()
  const result = f.controller.handleManualCommitChangedFiles()
  f.switchProject()
  f.commit.reject(new Error('Commit failed'))
  assert.equal(await result, false)
  assert.equal(f.input, '  Fix the bug\n')
  assert.equal(f.pushes.length, 0)
  assert.equal(f.errors.length, 1)
})

for (const switchDuringGeneration of [false, true]) {
  test(`quick commit clears its input after navigation (during generation=${switchDuringGeneration})`, async () => {
    const f = fixture()
    const result = f.controller.handleQuickCommitChangedFiles(true)
    await f.generationStarted.promise
    if (switchDuringGeneration) f.switchProject()
    f.generation.resolve('Generated commit message')
    await f.commitStarted.promise
    if (!switchDuringGeneration) {
      assert.equal(f.input, 'Generated commit message')
      f.switchProject()
    }
    f.commit.resolve()
    f.push.resolve()
    assert.equal(await result, true)
    assert.equal(f.input, '')
    assert.equal(f.commits[0].cwd, '/project-a')
    assert.equal(f.commits[0].message, 'Generated commit message')
    assert.equal(f.pushes[0].cwd, '/project-a')
  })
}

for (const nextInput of ['  Fix the bug\n', 'New project instructions']) {
  test(`AI commit clears only submitted instructions after navigation (${nextInput.trim()})`, async () => {
    const f = fixture()
    const result = f.controller.handleAiCommitChangedFiles(true)
    f.switchProject(nextInput)
    f.commit.resolve({ id: 'commit-chat', status: 'idle', items: [] })
    assert.equal(await result, true)
    assert.equal(f.input, nextInput.trim() === 'Fix the bug' ? '' : nextInput)
  })
}
