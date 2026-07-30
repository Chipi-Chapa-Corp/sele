import { execFile } from 'node:child_process'
import { dirname, basename } from 'node:path'
import type { ProviderChatCwdMetadata } from '../../shared/provider'
import { getStoredCwdMetadata, setStoredCwdMetadata } from '../database/cwd'
import { getHostCommand } from '../hostProcess'

const cwdMetadataCache = new Map<string, Promise<ProviderChatCwdMetadata>>()

const runGit = (cwd: string, args: string[]): Promise<string | null> =>
  new Promise((resolve) => {
    const hostCommand = getHostCommand('git', args, { cwd })
    execFile(
      hostCommand.file,
      hostCommand.args,
      {
        cwd: hostCommand.cwd,
        encoding: 'utf8',
        env: hostCommand.env,
        maxBuffer: 1024 * 1024,
        timeout: 3_000
      },
      (error, stdout) => {
        resolve(error ? null : stdout.trimEnd())
      }
    )
  })

const getNativeProjectCwd = (gitCommonDir: string): string | null =>
  basename(gitCommonDir) === '.git' ? dirname(gitCommonDir) : null

const getDefaultCwdMetadata = (cwd: string | null): ProviderChatCwdMetadata => ({
  kind: 'directory',
  projectCwd: cwd,
  branchName: null
})

const readCwdMetadata = async (cwd: string): Promise<ProviderChatCwdMetadata> => {
  const output = await runGit(cwd, [
    'rev-parse',
    '--path-format=absolute',
    '--show-toplevel',
    '--git-dir',
    '--git-common-dir',
    '--abbrev-ref',
    'HEAD'
  ])
  const [gitTopLevel, gitDir, gitCommonDir, branchName] =
    output?.split('\n').map((line) => line.trim()) ?? []
  const isGitWorktree = Boolean(gitDir && gitCommonDir && gitDir !== gitCommonDir)
  const normalizedBranchName = branchName && branchName !== 'HEAD' ? branchName : null

  if (!isGitWorktree) {
    return {
      ...getDefaultCwdMetadata(cwd),
      branchName: normalizedBranchName
    }
  }

  return {
    kind: 'gitWorktree',
    projectCwd: getNativeProjectCwd(gitCommonDir) ?? gitTopLevel ?? cwd,
    branchName: normalizedBranchName
  }
}

const resolveCwdMetadata = async (cwd: string): Promise<ProviderChatCwdMetadata> => {
  const storedMetadata = await getStoredCwdMetadata(cwd).catch(() => null)
  if (storedMetadata && (storedMetadata.kind !== 'gitWorktree' || storedMetadata.projectCwd)) {
    return storedMetadata
  }

  const metadata = await readCwdMetadata(cwd).catch(() => getDefaultCwdMetadata(cwd))
  await setStoredCwdMetadata(cwd, metadata).catch(() => {})
  return metadata
}

export const getCwdMetadata = (
  cwd: string | null | undefined
): Promise<ProviderChatCwdMetadata> => {
  const normalizedCwd = cwd?.trim()
  if (!normalizedCwd) return Promise.resolve(getDefaultCwdMetadata(null))

  const cachedMetadata = cwdMetadataCache.get(normalizedCwd)
  if (cachedMetadata) return cachedMetadata

  const cwdMetadata = resolveCwdMetadata(normalizedCwd)
  cwdMetadataCache.set(normalizedCwd, cwdMetadata)
  return cwdMetadata
}
