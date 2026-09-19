export type GitFileDiffRunner = (
  repositoryRoot: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; required: true }
) => Promise<string | null>

const parseNullDelimitedPaths = (value: string | null): string[] =>
  value?.split('\0').filter(Boolean) ?? []

/** Stage only requested paths that Git already tracks or considers untracked and non-ignored. */
export const stageGitFileDiffPaths = async (
  repositoryRoot: string,
  indexPath: string,
  paths: string[],
  runGit: GitFileDiffRunner
): Promise<void> => {
  const requestedPaths = [...new Set(paths)]
  if (requestedPaths.length === 0) return
  const env = { GIT_INDEX_FILE: indexPath }
  const [trackedOutput, untrackedOutput] = await Promise.all([
    runGit(
      repositoryRoot,
      ['--literal-pathspecs', 'ls-files', '-z', '--cached', '--', ...requestedPaths],
      {
        env,
        required: true
      }
    ),
    runGit(
      repositoryRoot,
      [
        '--literal-pathspecs',
        'ls-files',
        '-z',
        '--others',
        '--exclude-standard',
        '--',
        ...requestedPaths
      ],
      { env, required: true }
    )
  ])
  const stagePaths = [
    ...new Set([
      ...parseNullDelimitedPaths(trackedOutput),
      ...parseNullDelimitedPaths(untrackedOutput)
    ])
  ]
  if (stagePaths.length === 0) return

  await runGit(repositoryRoot, ['--literal-pathspecs', 'add', '-A', '--', ...stagePaths], {
    env,
    required: true
  })
}
