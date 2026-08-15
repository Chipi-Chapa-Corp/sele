import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { AppGitCommitAction } from '../shared/app'

export type GitRunOptions = {
  env?: NodeJS.ProcessEnv
  required?: boolean
}

export type GitRunner = (
  cwd: string,
  args: string[],
  options?: boolean | GitRunOptions
) => Promise<string | null>

type CommitGitFileChangesOptions = {
  action: AppGitCommitAction
  files: string[]
  message: string | null | undefined
  repositoryRoot: string
  runGit: GitRunner
}

const getTemporaryIndexEnv = (indexPath: string): NodeJS.ProcessEnv => ({
  GIT_INDEX_FILE: indexPath,
  GIT_LITERAL_PATHSPECS: '1'
})

const literalPathspecEnv: NodeJS.ProcessEnv = { GIT_LITERAL_PATHSPECS: '1' }

const normalizeCommitPath = (repositoryRoot: string, path: string): string => {
  const absolutePath = isAbsolute(path) ? path : resolve(repositoryRoot, path)
  const relativePath = relative(repositoryRoot, absolutePath).replace(/\\/g, '/')

  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Commit path is outside the repository: ${path}`)
  }

  return relativePath
}

const parseGitPathList = (output: string): string[] =>
  output.split('\0').filter((path) => path.length > 0)

const initializeTemporaryIndex = async (
  repositoryRoot: string,
  indexPath: string,
  runGit: GitRunner
): Promise<void> => {
  const env = getTemporaryIndexEnv(indexPath)
  const head = await runGit(repositoryRoot, ['rev-parse', '--verify', 'HEAD'])

  await runGit(repositoryRoot, head ? ['read-tree', 'HEAD'] : ['read-tree', '--empty'], {
    env,
    required: true
  })
}

export const commitGitFileChanges = async ({
  action,
  files,
  message,
  repositoryRoot,
  runGit
}: CommitGitFileChangesOptions): Promise<string[]> => {
  const paths = [...new Set(files.map((path) => normalizeCommitPath(repositoryRoot, path)))]
  if (paths.length === 0) throw new Error('No files were selected for commit')

  const commitMessage = message?.trim()
  if (action === 'commit' && !commitMessage) throw new Error('Commit message is required')

  const tempDirectory = await mkdtemp(join(tmpdir(), 'sele-git-index-'))
  const indexPath = join(tempDirectory, 'index')
  const env = getTemporaryIndexEnv(indexPath)

  try {
    await initializeTemporaryIndex(repositoryRoot, indexPath, runGit)
    await runGit(repositoryRoot, ['add', '-A', '--', '.'], { env, required: true })

    const changedPathOutput = await runGit(
      repositoryRoot,
      ['diff', '--cached', '--name-only', '--no-renames', '-z', '--', ...paths],
      { env, required: true }
    )
    const changedPaths = parseGitPathList(changedPathOutput ?? '')

    if (changedPaths.length === 0) {
      throw new Error(
        'The selected files no longer contain uncommitted changes. Refresh Changes and try again.'
      )
    }

    await initializeTemporaryIndex(repositoryRoot, indexPath, runGit)
    await runGit(repositoryRoot, ['add', '-A', '--', ...changedPaths], {
      env,
      required: true
    })

    if (action === 'amend') {
      await runGit(repositoryRoot, ['commit', '--amend', '--no-edit'], { env, required: true })
    } else {
      await runGit(repositoryRoot, ['commit', '-m', commitMessage as string], {
        env,
        required: true
      })
    }

    await runGit(repositoryRoot, ['reset', '-q', 'HEAD', '--', ...changedPaths], {
      env: literalPathspecEnv,
      required: true
    })
    return changedPaths
  } finally {
    await rm(tempDirectory, { recursive: true, force: true }).catch(() => {})
  }
}
