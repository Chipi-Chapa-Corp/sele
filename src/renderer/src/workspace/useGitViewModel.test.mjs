import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'

const bundled = await build({
  entryPoints: [new URL('./useGitViewModel.tsx', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  packages: 'external',
  loader: { '.css': 'empty' },
  write: false
})
const module = { exports: {} }
const require = createRequire(import.meta.url)
vm.runInNewContext(bundled.outputFiles[0].text, {
  module,
  exports: module.exports,
  require: (name) =>
    name === 'react'
      ? { ...require(name), useMemo: (fn) => fn(), useCallback: (fn) => fn, useEffect: () => {} }
      : require(name)
})

function model({ sendState = 'idle', sendInFlightProjectKey, ...gitState } = {}) {
  // biome-ignore lint/correctness/useHookAtTopLevel: hooks are stubbed to evaluate the actual view model without a GUI.
  return module.exports.useGitViewModel({
    gitState: {
      commitInput: 'Fix bug',
      syncProjectKeys: new Set(),
      branchActionProjectKeys: new Set(),
      syncErrorsByProjectKey: {},
      syncRecoveriesByProjectKey: {},
      commitMessageGenerationProjectKeys: new Set(),
      commitErrorsByProjectKey: {},
      scopedCommitActivities: {},
      directCommitActivities: {},
      startingScopedCommitActivities: {},
      collapsedFileTreeFolders: {},
      collapsedChangeTreeFolders: {},
      ...gitState
    },
    settings: {
      effectiveAppSettings: {
        git: { quickActions: { showManualCommit: true }, untrackedFilesPrompt: 'Review files' }
      }
    },
    session: {
      changesCwd: '/project-b/worktree',
      changesProjectCwd: '/project-b',
      gitAvailableForCurrentSource: true
    },
    chatState: { sendState, sendInFlightProjectKey, selectedChat: null },
    interactions: { chatIsBusy: false },
    changes: {
      changedFiles: [{ path: 'file.txt', kind: 'modified' }],
      uncommittedChangedFiles: [{ path: 'file.txt', kind: 'modified' }],
      changesLoadState: 'ready',
      repositoryFileIndex: null
    },
    providerUpdates: {},
    sourceState: {},
    panes: {}
  })
}

const locks = {
  branch: (key) => ({ branchActionProjectKeys: new Set([key]) }),
  sync: (key) => ({ syncProjectKeys: new Set([key]) }),
  generation: (key) => ({ commitMessageGenerationProjectKeys: new Set([key]) }),
  commit: (key) => ({
    directCommitActivities: { commit: { projectCwd: key.slice(4), source: 'git', startedAt: 1 } }
  }),
  aiCommit: (key) => ({
    scopedCommitActivities: { commit: { projectCwd: key.slice(4), source: 'ai', startedAt: 1 } }
  }),
  aiCommitStarting: (key) => ({ startingScopedCommitActivities: { [key]: {} } })
}

for (const [operation, lock] of Object.entries(locks)) {
  test(`${operation} blocks only the project running it, including its worktrees`, () => {
    for (const [key, blocked] of [
      ['cwd:/project-a', false],
      ['cwd:/project-b', true]
    ]) {
      const view = model(lock(key))
      assert.equal(view.commitDisabled, blocked, 'manual commit')
      assert.equal(view.getAiCommitActionDisabled(), blocked, 'AI commit')
      assert.equal(view.commitMessageGenerationDisabled, blocked, 'message generation')
      assert.equal(view.syncDisabled, blocked, 'pull/push')
      assert.equal(view.branchSwitchDisabled, blocked, 'branch switch/delete')
    }
  })
}

test('a message being sent in another project does not block AI commits', () => {
  assert.equal(
    model({
      sendState: 'sending',
      sendInFlightProjectKey: 'cwd:/project-a'
    }).getAiCommitActionDisabled(),
    false
  )
  assert.equal(
    model({
      sendState: 'sending',
      sendInFlightProjectKey: 'cwd:/project-b'
    }).getAiCommitActionDisabled(),
    true
  )
})
