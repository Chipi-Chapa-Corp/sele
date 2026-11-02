import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { fetchGitRemote } from './gitRemoteFetch.ts'
import { getGitCommitCounts } from './gitSync.ts'

const exec = promisify(execFile)
const ipcSource = ts.createSourceFile(
  'registerAppIpc.ts',
  readFileSync(new URL('./registerAppIpc.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const expression = (name, context) => {
  let initializer
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ipcSource) === name) {
      initializer = node.initializer.getText(ipcSource)
    }
    ts.forEachChild(node, visit)
  }
  visit(ipcSource)
  assert.ok(initializer, `Found ${name}`)
  return vm.runInContext(
    ts.transpile(`(${initializer})`, { target: ts.ScriptTarget.ES2022 }),
    context
  )
}
const git = async (cwd, args, options = {}) => {
  const { stdout } = await exec('git', args, {
    cwd,
    env: { ...process.env, ...options.env },
    timeout: options.timeoutMs ?? 10_000
  })
  return stdout.trimEnd()
}

test('fetch discovers incoming commits on the tracked remote without changing local work', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sele-remote-fetch-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await git(root, ['init', '--bare', '--initial-branch=main', 'remote.git'])
  await git(root, ['clone', 'remote.git', 'author'])
  const author = join(root, 'author')
  await git(author, ['config', 'user.name', 'Sele Test'])
  await git(author, ['config', 'user.email', 'sele@example.test'])
  await writeFile(join(author, 'file.txt'), 'initial\n')
  await git(author, ['add', '.'])
  await git(author, ['commit', '-qm', 'initial'])
  await git(author, ['push', '-u', 'origin', 'main'])
  await git(root, ['clone', '--origin', 'team', 'remote.git', 'local'])
  const local = join(root, 'local')
  // A push remote must not replace the remote tracked by the current branch.
  await git(local, ['remote', 'add', 'origin', join(root, 'missing.git')])
  await git(local, ['config', 'branch.main.pushRemote', 'origin'])
  const beforeHead = await git(local, ['rev-parse', 'HEAD'])
  await writeFile(join(local, 'file.txt'), 'local edits\n')
  for (let index = 0; index < 2; index++) {
    await writeFile(join(author, 'file.txt'), `remote ${index}\n`)
    await git(author, ['commit', '-qam', `remote ${index}`])
  }
  await git(author, ['push'])

  assert.equal((await getGitCommitCounts(local, 'main', git)).unpulledCount, 0)
  await fetchGitRemote(local, 'main', git, 'local')
  assert.deepEqual(await getGitCommitCounts(local, 'main', git), {
    unpulledCount: 2,
    unpushedCount: 0
  })
  assert.equal(await git(local, ['rev-parse', 'HEAD']), beforeHead)
  assert.equal(await readFile(join(local, 'file.txt'), 'utf8'), 'local edits\n')
})

test('concurrent refreshes share a fetch per source and failed fetches can be retried', async () => {
  let resolveFetch
  let fetches = 0
  let fail = false
  const runner = async (_cwd, args, options) => {
    if (args[0] === 'for-each-ref') return 'team'
    if (args[0] === 'remote') return 'origin\nteam'
    fetches++
    assert.equal(args.at(-1), 'team')
    assert.equal(options.env.GIT_TERMINAL_PROMPT, '0')
    assert.equal(options.required, true)
    if (fail) throw new Error('offline')
    await new Promise((resolve) => {
      resolveFetch = resolve
    })
    return ''
  }
  const first = fetchGitRemote('/repo', 'main', runner, 'host')
  const second = fetchGitRemote('/repo', 'main', runner, 'host')
  await new Promise(setImmediate)
  assert.equal(fetches, 1)
  resolveFetch()
  await Promise.all([first, second])

  fail = true
  await assert.rejects(fetchGitRemote('/repo', 'main', runner, 'host'), /offline/)
  await assert.rejects(fetchGitRemote('/repo', 'main', runner, 'host'), /offline/)
  assert.equal(fetches, 3)

  fail = false
  const otherHost = fetchGitRemote('/repo', 'main', runner, 'other-host')
  await new Promise(setImmediate)
  assert.equal(fetches, 4)
  resolveFetch()
  await otherHost
})

test('local-only repositories and detached HEAD do not attempt a network fetch', async () => {
  for (const [branch, upstream] of [
    [null, ''],
    ['main', ''],
    ['main', '.']
  ]) {
    const runner = async (_cwd, args) => {
      if (args[0] === 'for-each-ref') return upstream
      assert.deepEqual(args, ['remote'])
      return ''
    }
    await fetchGitRemote('/local-only', branch, runner, 'local')
  }
})

test('changes refresh awaits fetching before counting and retains local status on fetch failure', async () => {
  const events = [],
    errors = []
  let fail = false
  const context = vm.createContext({
    runGit: async (_cwd, args) => (args[0] === 'rev-parse' ? '/repo' : 'local changes'),
    getCurrentBranchName: async () => 'main',
    fetchGitRemote: async (_cwd, _branch, _runner, sourceKey) => {
      assert.equal(sourceKey, JSON.stringify({ kind: 'ssh', environmentId: 'host' }))
      events.push('fetch')
      if (fail) throw new Error('Cannot reach remote')
    },
    gitCommandContext: { getStore: () => ({ container: { kind: 'ssh', environmentId: 'host' } }) },
    getGitCommitCounts: async () => {
      events.push('counts')
      return { unpulledCount: 2, unpushedCount: 0 }
    },
    parsePorcelainChanges: () => [{ path: 'local.txt' }],
    limitVisibleUntrackedGitFiles: (files) => ({
      files,
      untrackedFilesHiddenForPerformance: false
    }),
    getGitErrorMessage: (error) => error.message,
    console: { error: (...args) => errors.push(args) }
  })
  const readChanges = expression('getGitChanges', context)
  let result = await readChanges('/repo', 'uncommitted', true)
  assert.deepEqual(events, ['fetch', 'counts'])
  assert.equal(result.unpulledCount, 2)
  assert.equal(result.remoteFetchError, undefined)
  events.length = 0
  fail = true
  result = await readChanges('/repo', 'uncommitted', true)
  assert.deepEqual(events, ['fetch', 'counts'])
  assert.equal(result.remoteFetchError, 'Cannot reach remote')
  assert.equal(result.files[0].path, 'local.txt')
  assert.equal(errors.length, 1)
  events.length = 0
  await readChanges('/repo', 'uncommitted')
  assert.deepEqual(events, ['counts'], 'Other local Git reads do not need a fetch')
})

test('Git changes IPC validates and preserves the remote fetch request', () => {
  const context = vm.createContext({
    requireContainerTarget: (container) => container,
    getDefaultPath: (cwd) => cwd
  })
  const parseOptions = expression('getGitChangesOptions', context)
  const container = { kind: 'ssh', environmentId: 'host' }
  const result = parseOptions({ container, cwd: '/repo', source: 'uncommitted', fetchRemote: true })
  assert.equal(result.fetchRemote, true)
  assert.equal(result.container, container)
  assert.equal(result.cwd, '/repo')
  assert.throws(() => parseOptions({ source: 'uncommitted', fetchRemote: 'yes' }), /fetch option/)
})
