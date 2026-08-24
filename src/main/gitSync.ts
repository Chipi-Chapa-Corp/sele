import type { AppGitRecoverableFailure } from '../shared/app'

export const isNoUpstreamPushFailure = (message: string): boolean =>
  message.toLocaleLowerCase().includes('has no upstream branch')

export const getNoUpstreamPushFailure = (
  branchName: string,
  command: string
): AppGitRecoverableFailure => ({
  kind: 'push-no-upstream',
  title: 'Branch has no upstream',
  message: `The local branch ${branchName} is not connected to a remote branch yet.`,
  command,
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
