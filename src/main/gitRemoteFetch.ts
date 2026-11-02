type GitRunner = (
  cwd: string,
  args: string[],
  options?: { required: boolean; timeoutMs?: number; env?: NodeJS.ProcessEnv }
) => Promise<string | null>

const inFlightFetches = new Map<string, Promise<void>>()

/** Refresh the current branch's remote without changing HEAD or working files. */
export const fetchGitRemote = async (
  cwd: string,
  branchName: string | null,
  runGit: GitRunner,
  sourceKey: string
): Promise<void> => {
  if (!branchName) return

  const upstreamRemote = (
    await runGit(
      cwd,
      ['for-each-ref', '--count=1', '--format=%(upstream:remotename)', `refs/heads/${branchName}`],
      { required: true }
    )
  )?.trim()
  // A local upstream needs no network refresh.
  if (upstreamRemote === '.') return

  const remotes = (await runGit(cwd, ['remote'], { required: true }))?.split('\n') ?? []
  const remote =
    upstreamRemote ||
    (remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : null)
  if (!remote) return

  const key = JSON.stringify([sourceKey, cwd, remote])
  const pending = inFlightFetches.get(key)
  if (pending) return pending

  const fetch = (async () => {
    await runGit(
      cwd,
      ['-c', 'credential.interactive=false', 'fetch', '--quiet', '--no-tags', '--', remote],
      {
        required: true,
        timeoutMs: 30_000,
        env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', SSH_ASKPASS_REQUIRE: 'never' }
      }
    )
  })()
  inFlightFetches.set(key, fetch)
  try {
    await fetch
  } finally {
    inFlightFetches.delete(key)
  }
}
