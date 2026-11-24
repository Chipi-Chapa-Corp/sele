import { useEffect, useMemo, useState } from 'react'
import type { AppContainerTarget, AppGitChangesResult } from '../../../../shared/app'
import { appApi } from '../../appApi'
import { buildChangeTree, getGitChangedFiles, getTreeFilesWithDisplayPaths } from '../../changeTree'
import { getErrorMessage } from '../chatControllerUtils'
import { getTreeFileEditorTarget, type useChangesData } from '../useChangesData'

export type WorktreeSource = { cwd: string | null; branchName: string | null }

export function useBenchmarkWorktreeChanges({
  source,
  container,
  refresh,
  visible,
  workspaceChanges
}: {
  source: WorktreeSource | null
  container: AppContainerTarget | null | undefined
  refresh: number
  visible: boolean
  workspaceChanges?: ReturnType<typeof useChangesData>
}) {
  const cwd = source?.cwd ?? null
  const loadCwd = visible && !workspaceChanges ? cwd : null
  const [snapshot, setSnapshot] = useState<{
    cwd: string
    container: typeof container
    result: AppGitChangesResult | null
    error: string | null
  } | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: The shared refresh request invalidates Git changes.
  useEffect(() => {
    if (!loadCwd) return
    let current = true
    let timeout: number | undefined
    const load = async (): Promise<void> => {
      try {
        const result = await appApi.getGitChanges({ cwd: loadCwd, container })
        if (current) setSnapshot({ cwd: loadCwd, container, result, error: null })
      } catch (error) {
        if (current) {
          setSnapshot({
            cwd: loadCwd,
            container,
            result: null,
            error: getErrorMessage(error, 'Unable to load changes.')
          })
        }
      } finally {
        if (current) timeout = window.setTimeout(load, 60_000)
      }
    }
    void load()
    return () => {
      current = false
      window.clearTimeout(timeout)
    }
  }, [container, loadCwd, refresh])

  const current = snapshot?.cwd === cwd && snapshot.container === container ? snapshot : null
  const result = workspaceChanges ? workspaceChanges.displayedGitChanges : (current?.result ?? null)
  const changedFiles = useMemo(
    () => getTreeFilesWithDisplayPaths(getGitChangedFiles(result), result?.repositoryRoot ?? cwd),
    [cwd, result]
  )
  const tree = useMemo(() => buildChangeTree(changedFiles), [changedFiles])
  const diffTargets = useMemo(
    () => (cwd ? changedFiles.map((file) => getTreeFileEditorTarget(file, cwd, container)) : []),
    [changedFiles, container, cwd]
  )

  const branchName = result ? result.branchName : (source?.branchName ?? null)
  const error = workspaceChanges
    ? workspaceChanges.displayedGitChangeLoadError?.error
    : current?.error
  const loading = workspaceChanges
    ? workspaceChanges.visibleChangesLoadState === 'loading'
    : !current

  return useMemo(
    () => ({
      kind: 'git' as const,
      cwd,
      result,
      branchName,
      error,
      loading,
      untrackedFilesHidden: result?.untrackedFilesHiddenForPerformance === true,
      tree,
      diffTargets
    }),
    [cwd, result, branchName, error, loading, tree, diffTargets]
  )
}

export type BenchmarkWorktreeChanges = ReturnType<typeof useBenchmarkWorktreeChanges>
