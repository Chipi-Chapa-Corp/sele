import { randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import type { AppGitBenchmarkWorktrees } from '../shared/app'

type Git = (
  cwd: string,
  args: string[],
  options?: { required?: boolean; timeoutMs?: number; env?: NodeJS.ProcessEnv }
) => Promise<string | null>

const worktreeOptions = { required: true, timeoutMs: 120_000 }
const namePattern = /^benchmark-([\da-f-]{36})-(primary|secondary)$/
const gitIdentity = ['-c', 'user.name=Sele', '-c', 'user.email=sele@localhost']

const getGitValue = async (git: Git, cwd: string, args: string[]): Promise<string> => {
  const value = await git(cwd, args, worktreeOptions)
  if (!value) throw new Error('Git did not return the benchmark worktree state.')
  return value
}

const getBenchmarkDirectory = async (git: Git, cwd: string): Promise<string> =>
  join(
    await getGitValue(git, cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    'sele-worktrees'
  )

export const createBenchmarkWorktrees = async (
  git: Git,
  repositoryRoot: string
): Promise<AppGitBenchmarkWorktrees> => {
  const baseRef = await git(repositoryRoot, ['symbolic-ref', '--quiet', 'HEAD'])
  if (!baseRef?.startsWith('refs/heads/'))
    throw new Error('Check out a branch before enabling Benchmark.')
  const baseBranchName = baseRef.slice('refs/heads/'.length)
  const base = await getGitValue(git, repositoryRoot, ['rev-parse', baseRef])
  const directory = await getBenchmarkDirectory(git, repositoryRoot)
  const name = `benchmark-${randomUUID()}`
  const worktrees = (['primary', 'secondary'] as const).map((side) => ({
    branchName: `agents/${name}-${side}`,
    worktreePath: join(directory, `${name}-${side}`)
  }))
  const created: typeof worktrees = []
  try {
    for (const worktree of worktrees) {
      await git(
        repositoryRoot,
        ['worktree', 'add', '-b', worktree.branchName, worktree.worktreePath, base],
        worktreeOptions
      )
      created.push(worktree)
    }
  } catch (error) {
    for (const worktree of created) {
      await git(repositoryRoot, ['worktree', 'remove', worktree.worktreePath], {
        timeoutMs: worktreeOptions.timeoutMs
      })
      await git(repositoryRoot, ['branch', '-d', worktree.branchName])
    }
    throw error
  }
  return { repositoryRoot, baseBranchName, primary: worktrees[0]!, secondary: worktrees[1]! }
}

const getWorktreeName = (cwd: string): RegExpExecArray => {
  const worktree = namePattern.exec(basename(cwd))
  if (!worktree || basename(dirname(cwd)) !== 'sele-worktrees') {
    throw new Error('Choose a Sele benchmark worktree.')
  }
  return worktree
}

const isRegisteredWorktree = async (
  git: Git,
  repositoryRoot: string,
  cwd: string
): Promise<boolean> => {
  const worktrees = await getGitValue(git, repositoryRoot, [
    'worktree',
    'list',
    '--porcelain',
    '-z'
  ])
  const target = resolve(cwd)
  return worktrees
    .split('\0')
    .some(
      (field) =>
        field.startsWith('worktree ') && resolve(field.slice('worktree '.length)) === target
    )
}

const verifyWorktree = async (git: Git, repositoryRoot: string, cwd: string): Promise<void> => {
  getWorktreeName(cwd)
  if (resolve(dirname(cwd)) !== resolve(await getBenchmarkDirectory(git, repositoryRoot))) {
    throw new Error('The worktree does not belong to this project.')
  }
  if (!(await isRegisteredWorktree(git, repositoryRoot, cwd))) {
    throw new Error('The benchmark worktree is no longer available.')
  }
}

const snapshotWorktree = async (git: Git, cwd: string) => {
  const head = await getGitValue(git, cwd, ['rev-parse', 'HEAD'])
  const index = await getGitValue(git, cwd, ['write-tree'])
  const headTree = await getGitValue(git, cwd, ['rev-parse', 'HEAD^{tree}'])
  const gitDir = await getGitValue(git, cwd, ['rev-parse', '--path-format=absolute', '--git-dir'])
  // The index is stored in this worktree's administration directory and removed with it.
  const options = {
    ...worktreeOptions,
    env: { GIT_INDEX_FILE: join(gitDir, 'sele-benchmark-index') }
  }
  await git(cwd, ['read-tree', '--reset', index], options)
  await git(cwd, ['add', '-A'], options)
  const tree = await git(cwd, ['write-tree'], options)
  if (!tree) throw new Error('Unable to save the benchmark worktree.')
  return { head, headTree, index, tree }
}

const saveWorktree = async (
  git: Git,
  cwd: string,
  snapshot: Awaited<ReturnType<typeof snapshotWorktree>>
): Promise<void> => {
  const { head, headTree, index, tree } = snapshot
  const indexCommit =
    headTree === index
      ? head
      : await getGitValue(git, cwd, [
          ...gitIdentity,
          'commit-tree',
          index,
          '-p',
          head,
          '-m',
          'Benchmark staged changes'
        ])
  const commit =
    tree === index
      ? indexCommit
      : await getGitValue(git, cwd, [
          ...gitIdentity,
          'commit-tree',
          tree,
          '-p',
          indexCommit,
          '-m',
          'Benchmark working changes'
        ])
  await git(
    cwd,
    ['update-ref', `refs/sele/benchmark/${basename(cwd)}/${randomUUID()}`, commit],
    worktreeOptions
  )
}

const changingWorktrees = new Set<string>()

const updateBenchmarkWorktree = async (cwd: string, action: () => Promise<void>): Promise<void> => {
  const [, id] = getWorktreeName(cwd)
  const key = join(dirname(cwd), id!)
  if (changingWorktrees.has(key))
    throw new Error('A benchmark worktree update is already in progress.')
  changingWorktrees.add(key)
  try {
    await action()
  } finally {
    changingWorktrees.delete(key)
  }
}

export const removeBenchmarkWorktree = async (
  git: Git,
  repositoryRoot: string,
  cwd: string
): Promise<void> =>
  updateBenchmarkWorktree(cwd, async () => {
    if (!(await isRegisteredWorktree(git, repositoryRoot, cwd))) return
    await verifyWorktree(git, repositoryRoot, cwd)
    const snapshot = await snapshotWorktree(git, cwd)
    if (snapshot.headTree !== snapshot.tree || snapshot.headTree !== snapshot.index) {
      await saveWorktree(git, cwd, snapshot)
    }
    // Keep the branch so commits remain available after the checkout is removed.
    await git(repositoryRoot, ['worktree', 'remove', '--force', cwd], worktreeOptions)
  })

export const syncBenchmarkWorktree = async (
  git: Git,
  source: string,
  target: string
): Promise<void> =>
  updateBenchmarkWorktree(source, async () => {
    const [, sourceId, sourceSide] = getWorktreeName(source)
    const [, targetId, targetSide] = getWorktreeName(target)
    if (sourceId !== targetId || sourceSide === targetSide) {
      throw new Error('Choose two sides of the same benchmark.')
    }
    await Promise.all([verifyWorktree(git, source, source), verifyWorktree(git, source, target)])
    const branch = await getGitValue(git, target, ['symbolic-ref', 'HEAD'])
    if (branch !== `refs/heads/agents/${basename(target)}`) {
      throw new Error('Check out the benchmark branch in the destination before copying its state.')
    }
    const sourceSnapshot = await snapshotWorktree(git, source)
    const original = await snapshotWorktree(git, target)
    await saveWorktree(git, target, original)
    const apply = async ({ head, index, tree }: typeof original): Promise<void> => {
      await git(target, ['reset', '--hard', head], worktreeOptions)
      await git(target, ['clean', '-fd'], worktreeOptions)
      await git(target, ['read-tree', '-u', '--reset', tree], worktreeOptions)
      await git(target, ['read-tree', '--reset', index], worktreeOptions)
    }
    try {
      await apply(sourceSnapshot)
    } catch (error) {
      try {
        await apply(original)
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          'Unable to copy the benchmark worktree. The previous state is saved under refs/sele/benchmark.'
        )
      }
      throw error
    }
  })
