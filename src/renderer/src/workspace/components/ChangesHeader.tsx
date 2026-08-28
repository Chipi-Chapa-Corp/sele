import type { ReactElement } from 'react'
import type { WorkspaceController } from '../../useWorkspaceController'
import {
  Files,
  GitBranch,
  Globe2,
  History,
  ListChevronsDownUp,
  ListChevronsUpDown,
  Maximize2,
  Minimize2,
  Terminal,
  X
} from 'lucide-react'
import { BranchSwitcher } from '../../components/BranchSwitcher'
import { Button } from '../../components/Button'
import { SegmentedControl } from '../../components/SegmentedControl'
import { GitRefreshIcon } from '../../components/AppStatusStates'

type ChangesHeaderProps = WorkspaceController['changesHeader']

export function ChangesHeader(props: ChangesHeaderProps): ReactElement {
  const {
    activeSidebarLoadState,
    activeTreeFolderPaths,
    branchNames,
    branchSwitchDisabled,
    changesCwd,
    changesPaneView,
    changesSidebarExpanded,
    currentBranchName,
    effectiveAppSettings,
    gitBranchActionState,
    gitBranchDeleteRetry,
    gitBranchError,
    gitBranchLoadState,
    gitBranchWorktreeDeleteRetry,
    handleChangesPaneViewChange,
    handleDeleteBranch,
    handleDeleteBranchWorktree,
    handleDismissGitBranchError,
    handleForceDeleteBranch,
    handleGitBranchErrorAiResolution,
    handleSwitchBranch,
    handleToggleActiveTreeFolders,
    hasCollapsedActiveTreeFolders,
    refreshSidebarLabel,
    renderGitAiResolutionButton,
    renderSettingsButton,
    renderWindowControls,
    setChangesSidebarExpanded,
    setFileTreeLoadRequest,
    setGitBranchLoadRequest,
    setGitChangeLoadRequest,
    treeToggleLabel
  } = props

  return (
    <header className="changes-sidebar__header">
      {renderWindowControls('default')}
      <div className="changes-sidebar__titlebar">
        <SegmentedControl
          aria-label="Sidebar view"
          className="changes-sidebar__view-toggle"
          options={[
            {
              value: 'recents',
              label: null,
              ariaLabel: 'Recents',
              title: 'Recents',
              icon: <History aria-hidden="true" />
            },
            {
              value: 'git',
              label: null,
              ariaLabel: 'Git',
              title: 'Git',
              icon: <GitBranch aria-hidden="true" />
            },
            {
              value: 'files',
              label: null,
              ariaLabel: 'Files',
              title: 'Files',
              icon: <Files aria-hidden="true" />
            },
            {
              value: 'terminal',
              label: null,
              ariaLabel: 'Terminal',
              title: 'Terminal (Ctrl+`)',
              icon: <Terminal aria-hidden="true" />
            },
            ...(effectiveAppSettings.browser.enabled
              ? [
                  {
                    value: 'browser' as const,
                    label: null,
                    ariaLabel: 'Browser',
                    title: 'Browser',
                    icon: <Globe2 aria-hidden="true" />
                  }
                ]
              : [])
          ]}
          value={changesPaneView}
          onChange={handleChangesPaneViewChange}
        />
        <div className="changes-sidebar__titlebar-actions">
          <Button
            theme="transparent"
            size="small"
            aria-label={
              changesSidebarExpanded ? 'Collapse workspace sidebar' : 'Expand workspace sidebar'
            }
            aria-controls="changes"
            aria-expanded={changesSidebarExpanded}
            title={
              changesSidebarExpanded ? 'Collapse workspace sidebar' : 'Expand workspace sidebar'
            }
            callback={() => setChangesSidebarExpanded((expanded) => !expanded)}
            icon={
              changesSidebarExpanded ? (
                <Minimize2 aria-hidden="true" />
              ) : (
                <Maximize2 aria-hidden="true" />
              )
            }
          />
          <div className="changes-sidebar__settings-slot">{renderSettingsButton()}</div>
        </div>
      </div>
      {(changesPaneView === 'git' || changesPaneView === 'files') && (
        <div className="changes-sidebar__controls changes-sidebar__controls--files">
          <label className="sr-only" htmlFor="changes-branch">
            Branch
          </label>
          <BranchSwitcher
            branches={branchNames}
            busy={gitBranchActionState === 'sending'}
            canForceDelete={Boolean(gitBranchDeleteRetry)}
            currentBranch={currentBranchName}
            deleteWorktreePath={gitBranchWorktreeDeleteRetry?.worktreePath}
            disabled={branchSwitchDisabled}
            error={gitBranchError}
            errorActions={
              gitBranchError ? (
                <>
                  {renderGitAiResolutionButton(handleGitBranchErrorAiResolution, 'bottom')}
                  <Button
                    callback={handleDismissGitBranchError}
                    icon={<X aria-hidden="true" />}
                    label={<span>Dismiss</span>}
                    theme="secondary"
                  />
                </>
              ) : null
            }
            id="changes-branch"
            loading={gitBranchLoadState === 'loading'}
            onClearError={handleDismissGitBranchError}
            onDelete={handleDeleteBranch}
            onDeleteWorktree={handleDeleteBranchWorktree}
            onForceDelete={handleForceDeleteBranch}
            onOpen={() => setGitBranchLoadRequest((currentRequest) => currentRequest + 1)}
            onSwitch={handleSwitchBranch}
          />
          <Button
            theme="transparent"
            size="small"
            aria-label={treeToggleLabel}
            title={treeToggleLabel}
            disabled={activeTreeFolderPaths.length === 0}
            callback={handleToggleActiveTreeFolders}
            icon={
              hasCollapsedActiveTreeFolders ? (
                <ListChevronsUpDown aria-hidden="true" />
              ) : (
                <ListChevronsDownUp aria-hidden="true" />
              )
            }
          />
          <Button
            theme="transparent"
            size="small"
            aria-label={refreshSidebarLabel}
            title={refreshSidebarLabel}
            disabled={!changesCwd || activeSidebarLoadState === 'loading'}
            callback={() => {
              if (changesPaneView === 'files') {
                setFileTreeLoadRequest((currentRequest) => currentRequest + 1)
                return
              }

              setGitChangeLoadRequest((currentRequest) => currentRequest + 1)
            }}
            icon={<GitRefreshIcon />}
          />
        </div>
      )}
    </header>
  )
}
