import type { AppGitPushTarget, AppGitRecoverableFailure } from '../shared/app'

type GitRunner = (cwd: string, args: string[]) => Promise<string | null>

export type GitCommitCounts = {
  unpulledCount: number
  unpushedCount: number
}

const parseCommitCount = (value: string | undefined): number => {
  const count = Number(value)
  return Number.isFinite(count) ? count : 0
}

export const getGitCommitCounts = async (
  cwd: string,
  branchName: string | null,
  runGit: GitRunner
): Promise<GitCommitCounts> => {
  if (!branchName) return { unpulledCount: 0, unpushedCount: 0 }

  const upstreamCounts = await runGit(cwd, [
    'rev-list',
    '--left-right',
    '--count',
    'HEAD...@{upstream}'
  ])

  if (upstreamCounts != null) {
    const [unpushed, unpulled] = upstreamCounts.trim().split(/\s+/, 2)
    return {
      unpulledCount: parseCommitCount(unpulled),
      unpushedCount: parseCommitCount(unpushed)
    }
  }

  const unpushed = await runGit(cwd, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])
  return {
    unpulledCount: 0,
    unpushedCount: parseCommitCount(unpushed ?? undefined)
  }
}

export const isNoUpstreamPushFailure = (message: string): boolean =>
  message.toLocaleLowerCase().includes('has no upstream branch')

export const isUpstreamBranchMismatchPushFailure = (message: string): boolean =>
  message.toLocaleLowerCase().includes('the upstream branch of your current branch does not match')

export const getNoUpstreamPushFailure = (
  branchName: string,
  command: string,
  error: string
): AppGitRecoverableFailure => ({
  kind: 'push-no-upstream',
  title: 'Branch has no upstream',
  message: `The local branch ${branchName} is not connected to a remote branch yet.`,
  command,
  error,
  actions: [
    {
      id: 'set-upstream',
      label: 'Set upstream',
      description: `Push ${branchName} and track a remote branch with the same name.`
    }
  ]
})

export const getSameNameUpstreamPushArgs = (remoteName: string, branchName: string): string[] => [
  'push',
  '--set-upstream',
  remoteName,
  `${branchName}:${branchName}`
]

export const getUpstreamBranchMismatchPushFailure = (
  currentBranchName: string,
  upstreamBranchName: string,
  command: string,
  error: string
): AppGitRecoverableFailure => ({
  kind: 'push-upstream-mismatch',
  title: 'Upstream branch name differs',
  message: `The local branch ${currentBranchName} tracks the differently named remote branch ${upstreamBranchName}.`,
  command,
  error,
  actions: [
    {
      id: 'push-current-branch',
      label: `Push to ${currentBranchName}`,
      description: `Push HEAD to the remote branch ${currentBranchName}.`
    },
    {
      id: 'push-upstream-branch',
      label: `Push to ${upstreamBranchName}`,
      description: `Push HEAD to the configured upstream branch ${upstreamBranchName}.`
    }
  ]
})

export const getPushToCurrentBranchArgs = (remoteName: string): string[] => [
  'push',
  remoteName,
  'HEAD'
]

export const getPushToUpstreamBranchArgs = (
  remoteName: string,
  upstreamBranchName: string
): string[] => ['push', remoteName, `HEAD:${upstreamBranchName}`]

export const getPushDefaultForTarget = (target: AppGitPushTarget): 'current' | 'upstream' =>
  target === 'current-branch' ? 'current' : 'upstream'

export const selectGitPushRemote = (
  remotes: string[],
  configuredRemotes: Array<string | null | undefined>
): string => {
  const configuredRemote = configuredRemotes
    .map((remote) => remote?.trim())
    .find((remote) => remote && remote !== '.' && remotes.includes(remote))

  if (configuredRemote) return configuredRemote
  if (remotes.includes('origin')) return 'origin'
  if (remotes.length === 1) return remotes[0]
  if (remotes.length === 0) throw new Error('No Git remote is configured for this repository.')

  throw new Error('Unable to choose a push remote. Configure a push remote and try again.')
}
