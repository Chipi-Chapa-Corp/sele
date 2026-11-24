import { useEffect, useMemo, useState } from 'react'
import type { AppContainerTarget } from '../../../../shared/app'
import { appApi } from '../../appApi'
import type { FileTreeIndex } from '../../fileTreeIndex'
import { indexFileTreeListing } from '../../fileTreeIndexClient'
import { getErrorMessage } from '../chatControllerUtils'
import type { WorktreeSource } from './useBenchmarkWorktreeChanges'

export function useBenchmarkWorktreeFiles({
  source,
  container,
  refresh,
  visible,
  workspaceFiles
}: {
  source: WorktreeSource | null
  container: AppContainerTarget | null | undefined
  refresh: number
  visible: boolean
  workspaceFiles?: {
    result: FileTreeIndex | null
    loading: boolean
    error: string | null
    branchName: string | null
  }
}) {
  const cwd = source?.cwd ?? null
  const loadCwd = visible && !workspaceFiles ? cwd : null
  const [snapshot, setSnapshot] = useState<{
    cwd: string
    container: typeof container
    result: FileTreeIndex | null
    error: string | null
  } | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: The shared refresh request invalidates file listings.
  useEffect(() => {
    if (!loadCwd) return
    let current = true
    const target = { cwd: loadCwd, container }
    void Promise.all([
      appApi.getFileTreeListing(target).then(indexFileTreeListing),
      appApi.getGitBranches(target)
    ])
      .then(([result, branches]) => {
        if (current)
          setSnapshot({
            cwd: loadCwd,
            container,
            result: { ...result, branchName: branches.currentBranch },
            error: null
          })
      })
      .catch((error) => {
        if (current) {
          setSnapshot({
            cwd: loadCwd,
            container,
            result: null,
            error: getErrorMessage(error, 'Unable to load files.')
          })
        }
      })
    return () => {
      current = false
    }
  }, [container, loadCwd, refresh])

  const current = snapshot?.cwd === cwd && snapshot.container === container ? snapshot : null
  const result = workspaceFiles ? workspaceFiles.result : (current?.result ?? null)
  const branchName = workspaceFiles
    ? workspaceFiles.branchName
    : result
      ? result.branchName
      : (source?.branchName ?? null)
  const error = workspaceFiles ? workspaceFiles.error : current?.error
  const loading = workspaceFiles ? workspaceFiles.loading : !current

  return useMemo(
    () => ({ kind: 'files' as const, cwd, result, branchName, error, loading }),
    [cwd, result, branchName, error, loading]
  )
}

export type BenchmarkWorktreeFiles = ReturnType<typeof useBenchmarkWorktreeFiles>
