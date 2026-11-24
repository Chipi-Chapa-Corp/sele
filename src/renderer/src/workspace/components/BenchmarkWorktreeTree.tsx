import { memo, useId, useMemo, useRef, useState } from 'react'
import { ListChevronsDownUp, ListChevronsUpDown } from 'lucide-react'
import type { AppContainerTarget, AppGitBranchesResult } from '../../../../shared/app'
import { appApi } from '../../appApi'
import { getTreeFolderPaths } from '../../changeTree'
import { ChangesSidebarGitState } from '../../components/AppStatusStates'
import { BranchSwitcher } from '../../components/BranchSwitcher'
import { Button } from '../../components/Button'
import { renderTreeNode } from '../../components/ChangeTree'
import type { FileEditorTarget } from '../../components/FileEditorDialog'
import {
  getDefaultFileTreeCollapsedFolders,
  getFileTreeIndexNodes,
  getVisibleFileTreeFolderPaths,
  isFileTreeFolderCollapsed
} from '../../fileTreeIndex'
import { getErrorMessage } from '../chatControllerUtils'
import type { BenchmarkWorktreeChanges } from '../features/useBenchmarkWorktreeChanges'
import type { BenchmarkWorktreeFiles } from '../features/useBenchmarkWorktreeFiles'
import { getFileTreeEmptyMessage } from '../gitControllerUtils'
import { getTreeFileEditorTarget } from '../useChangesData'

export const BenchmarkWorktreeTree = memo(function BenchmarkWorktreeTree({
  label,
  worktree,
  container,
  branchSwitchDisabled,
  onOpenFile,
  onSwitchBranch
}: {
  label: 'Main' | 'Secondary'
  worktree: BenchmarkWorktreeChanges | BenchmarkWorktreeFiles
  container: AppContainerTarget | null | undefined
  branchSwitchDisabled: boolean
  onOpenFile: (target: FileEditorTarget) => void
  onSwitchBranch: (
    cwd: string,
    branch: string,
    create: boolean
  ) => Promise<AppGitBranchesResult | null>
}) {
  const branchId = useId()
  const { cwd, branchName, result, error } = worktree
  const showingFiles = worktree.kind === 'files'
  const fileIndex = showingFiles ? worktree.result : null
  const gitTree = worktree.kind === 'git' ? worktree.tree : null
  const tree = useMemo(
    () => gitTree ?? (fileIndex ? getFileTreeIndexNodes(fileIndex, '') : []),
    [gitTree, fileIndex]
  )
  const [branches, setBranches] = useState<string[]>([])
  const [branchLoading, setBranchLoading] = useState(false)
  const [branchError, setBranchError] = useState<string | null>(null)
  const [checkout, setCheckout] = useState<{
    previousResult: (BenchmarkWorktreeChanges | BenchmarkWorktreeFiles)['result']
    branch: string | null
  } | null>(null)
  const branchRequest = useRef(0)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const collapsedFolders = useMemo(
    () =>
      fileIndex ? { ...getDefaultFileTreeCollapsedFolders(fileIndex), ...collapsed } : collapsed,
    [collapsed, fileIndex]
  )
  const folderPaths = useMemo(
    () =>
      fileIndex
        ? getVisibleFileTreeFolderPaths(fileIndex, collapsedFolders)
        : getTreeFolderPaths(tree),
    [collapsedFolders, fileIndex, tree]
  )
  const isCollapsed = (folder: string): boolean =>
    showingFiles
      ? isFileTreeFolderCollapsed(collapsedFolders, folder)
      : Boolean(collapsedFolders[folder])
  const hasCollapsed = folderPaths.some(isCollapsed)
  const treeAction = `${hasCollapsed ? 'Expand' : 'Collapse'} all ${label.toLowerCase()} folders`
  const refreshingCheckout = checkout !== null && checkout.previousResult === result
  const currentBranch = refreshingCheckout ? checkout.branch : branchName

  const loadBranches = async (): Promise<void> => {
    if (!cwd) return
    const request = ++branchRequest.current
    setBranchLoading(true)
    setBranchError(null)
    try {
      const result = await appApi.getGitBranches({ cwd, container })
      if (branchRequest.current === request) setBranches(result.branches)
    } catch (error) {
      if (branchRequest.current === request)
        setBranchError(getErrorMessage(error, 'Unable to load branches.'))
    } finally {
      if (branchRequest.current === request) setBranchLoading(false)
    }
  }

  const switchBranch = async (branch: string, create: boolean): Promise<boolean> => {
    if (!cwd || branchSwitchDisabled) return false
    if (!create && branch === currentBranch) return true
    branchRequest.current += 1
    setBranchLoading(false)
    setBranchError(null)
    try {
      const next = await onSwitchBranch(cwd, branch, create)
      if (!next) return false
      setBranches(next.branches)
      setCheckout({ previousResult: result, branch: next.currentBranch })
      return true
    } catch (error) {
      setBranchError(getErrorMessage(error, 'Unable to switch branches.'))
      return false
    }
  }

  const loading = worktree.loading || (refreshingCheckout && !error)
  const untrackedFilesHidden = worktree.kind === 'git' && worktree.untrackedFilesHidden

  return (
    <section className="changes-sidebar__worktree" aria-label={`${label} worktree`}>
      <div className="changes-sidebar__worktree-controls">
        <label className="sr-only" htmlFor={branchId}>
          {label} branch
        </label>
        <BranchSwitcher
          id={branchId}
          branches={branches}
          currentBranch={currentBranch}
          disabled={!cwd || branchSwitchDisabled || (refreshingCheckout && !error)}
          error={branchError}
          loading={branchLoading}
          onOpen={() => void loadBranches()}
          onSwitch={switchBranch}
        />
        <Button
          theme="transparent"
          size="small"
          aria-label={treeAction}
          title={treeAction}
          disabled={folderPaths.length === 0}
          callback={() =>
            setCollapsed((current) => ({
              ...current,
              ...Object.fromEntries(folderPaths.map((path) => [path, !hasCollapsed]))
            }))
          }
          icon={
            hasCollapsed ? (
              <ListChevronsUpDown aria-hidden="true" />
            ) : (
              <ListChevronsDownUp aria-hidden="true" />
            )
          }
        />
      </div>
      <div className="changes-sidebar__worktree-files">
        {error && (
          <p className="changes-sidebar__status" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <ChangesSidebarGitState
            active
            label={showingFiles ? 'Loading files' : 'Loading changes'}
          />
        ) : (
          <>
            {untrackedFilesHidden && (
              <p className="changes-sidebar__status">More than 200 untracked files hidden.</p>
            )}
            {cwd &&
              !refreshingCheckout &&
              (tree.length > 0 ? (
                <ul
                  className="changes-sidebar__tree"
                  role="tree"
                  aria-label={`${label} ${showingFiles ? 'files' : 'changes'}`}
                >
                  {tree.map((node) =>
                    renderTreeNode(node, 0, {
                      isCollapsed,
                      getChildren: (folder, children) =>
                        fileIndex ? getFileTreeIndexNodes(fileIndex, folder) : children,
                      onToggleFolder: (folder) =>
                        setCollapsed((current) => ({ ...current, [folder]: !isCollapsed(folder) })),
                      onOpenFile: (file) =>
                        onOpenFile(getTreeFileEditorTarget(file, cwd, container))
                    })
                  )}
                </ul>
              ) : !error && !untrackedFilesHidden ? (
                <ChangesSidebarGitState
                  active={false}
                  label={showingFiles ? getFileTreeEmptyMessage(cwd) : 'No uncommitted changes.'}
                />
              ) : null)}
          </>
        )}
      </div>
    </section>
  )
})
