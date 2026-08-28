import type { AppGitCommitAction } from '../shared/app'

export type GitRunOptions = {
  env?: NodeJS.ProcessEnv
  required?: boolean
  timeoutMs?: number
}

export type GitRunner = (
  cwd: string,
  args: string[],
  options?: boolean | GitRunOptions
) => Promise<string | null>

type CommitAllGitChangesOptions = {
  action: AppGitCommitAction
  message: string | null | undefined
  repositoryRoot: string
  runGit: GitRunner
}

const gitCommitTimeoutMs = 120_000

export const commitAllGitChanges = async ({
  action,
  message,
  repositoryRoot,
  runGit
}: CommitAllGitChangesOptions): Promise<void> => {
  const commitMessage = message?.trim()
  if (action === 'commit' && !commitMessage) throw new Error('Commit message is required')

  await runGit(repositoryRoot, ['add', '-A', '--', '.'], {
    required: true,
    timeoutMs: gitCommitTimeoutMs
  })

  if (action === 'amend') {
    await runGit(repositoryRoot, ['commit', '--amend', '--no-edit'], {
      required: true,
      timeoutMs: gitCommitTimeoutMs
    })
  } else {
    await runGit(repositoryRoot, ['commit', '-m', commitMessage as string], {
      required: true,
      timeoutMs: gitCommitTimeoutMs
    })
  }
}
