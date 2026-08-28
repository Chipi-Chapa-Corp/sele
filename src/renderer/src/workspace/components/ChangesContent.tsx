import type { ReactElement } from 'react'
import type { WorkspaceController } from '../../useWorkspaceController'
import { X } from 'lucide-react'
import { BrowserPanel } from '../../components/BrowserPanel'
import { Button } from '../../components/Button'
import { RecentReferencesList } from '../../components/RecentReferencesList'
import { TerminalPanel } from '../../components/TerminalPanel'
import {
  ChangesSidebarGitPerformanceWarning,
  ChangesSidebarGitState,
  ChangesSidebarRecentsState,
  GitRefreshIcon
} from '../../components/AppStatusStates'

type ChangesContentProps = WorkspaceController['changesContent']

export function ChangesContent(props: ChangesContentProps): ReactElement {
  const {
    browserOpenRequest,
    browserOpened,
    browserWorkspaceKey,
    changeTree,
    changedFiles,
    changesContainer,
    changesCwd,
    changesEmptyMessage,
    changesPaneView,
    changesProjectCwd,
    displayedGitChangeLoadError,
    displayedRecentChatReferences,
    effectiveAppSettings,
    filesEmptyMessage,
    handleDismissGitChangeLoadError,
    handleGitChangeLoadErrorAiResolution,
    handleGoToPinnedText,
    handleOpenFileLink,
    handleReorderPinnedRecentReferences,
    handleSolveUntrackedFiles,
    handleToggleRecentReferencePinned,
    handleUnpinAllRecentReferences,
    recentlyOpenedFiles,
    renderChangeTreeNode,
    renderGitAiResolutionButton,
    renderRepositoryFileTreeNode,
    repositoryFileTree,
    repositoryFiles,
    setGitChangeLoadRequest,
    terminalCommandLaunchRequest,
    terminalOpened,
    terminalWorkspaceKey,
    untrackedFilesAiDisabled,
    untrackedFilesHiddenForPerformance,
    visibleChangesLoadState,
    visibleFilesLoadState,
    visibleGitChangeLoadError
  } = props

  return (
    <div
      className={`changes-sidebar__body${
        changesPaneView === 'terminal' || changesPaneView === 'browser'
          ? ' changes-sidebar__body--utility'
          : ''
      }`}
    >
      {changesPaneView !== 'terminal' && changesPaneView !== 'browser' && (
        <div className="changes-sidebar__content">
          {changesPaneView === 'recents' ? (
            displayedRecentChatReferences.pinnedReferences.length > 0 ||
            recentlyOpenedFiles.length > 0 ||
            displayedRecentChatReferences.recentReferences.length > 0 ? (
              <RecentReferencesList
                canOpenFiles={Boolean(changesCwd)}
                container={changesContainer}
                cwd={changesCwd}
                openedFiles={recentlyOpenedFiles}
                pinnedReferences={displayedRecentChatReferences.pinnedReferences}
                recentReferences={displayedRecentChatReferences.recentReferences}
                onOpenFile={(reference, recordAsOpened) =>
                  handleOpenFileLink(
                    reference.path,
                    reference.displayPath,
                    reference.line,
                    reference.endLine,
                    recordAsOpened
                  )
                }
                onGoToText={handleGoToPinnedText}
                onReorderPinned={handleReorderPinnedRecentReferences}
                onTogglePinned={handleToggleRecentReferencePinned}
                onUnpinAll={handleUnpinAllRecentReferences}
              />
            ) : (
              <ChangesSidebarRecentsState label="No recent links or files" />
            )
          ) : changesPaneView === 'git' ? (
            <>
              {visibleChangesLoadState === 'loading' && (
                <ChangesSidebarGitState active label="Loading changes" />
              )}
              {displayedGitChangeLoadError && (
                <section
                  className="changes-sidebar__git-error"
                  aria-label="Git changes error"
                  role="alert"
                >
                  <span className="changes-sidebar__git-error-message">
                    {displayedGitChangeLoadError.error}
                  </span>
                  <div className="changes-sidebar__git-error-actions">
                    <Button
                      callback={() =>
                        setGitChangeLoadRequest((currentRequest) => currentRequest + 1)
                      }
                      icon={<GitRefreshIcon />}
                      label={<span>Retry</span>}
                      theme="secondary"
                    />
                    {renderGitAiResolutionButton(handleGitChangeLoadErrorAiResolution)}
                    <Button
                      callback={handleDismissGitChangeLoadError}
                      icon={<X aria-hidden="true" />}
                      label={<span>Dismiss</span>}
                      theme="secondary"
                    />
                  </div>
                </section>
              )}
              {visibleChangesLoadState === 'error' && !visibleGitChangeLoadError && (
                <p className="changes-sidebar__status">Unable to load changes.</p>
              )}
              {visibleChangesLoadState === 'ready' && untrackedFilesHiddenForPerformance && (
                <ChangesSidebarGitPerformanceWarning
                  disabled={untrackedFilesAiDisabled}
                  onSolve={handleSolveUntrackedFiles}
                />
              )}
              {visibleChangesLoadState === 'ready' &&
                !untrackedFilesHiddenForPerformance &&
                changedFiles.length === 0 && (
                  <ChangesSidebarGitState active={false} label={changesEmptyMessage} />
                )}
              {visibleChangesLoadState === 'ready' && changedFiles.length > 0 && (
                <ul className="changes-sidebar__tree" role="tree">
                  {changeTree.map((node) => renderChangeTreeNode(node, 0))}
                </ul>
              )}
            </>
          ) : (
            <>
              {visibleFilesLoadState === 'loading' && (
                <ChangesSidebarGitState active label="Loading files" />
              )}
              {visibleFilesLoadState === 'error' && (
                <p className="changes-sidebar__status">Unable to load files.</p>
              )}
              {visibleFilesLoadState === 'ready' && repositoryFiles.length === 0 && (
                <p className="changes-sidebar__status">{filesEmptyMessage}</p>
              )}
              {visibleFilesLoadState === 'ready' && repositoryFiles.length > 0 && (
                <ul className="changes-sidebar__tree" role="tree">
                  {repositoryFileTree.map((node) => renderRepositoryFileTreeNode(node, 0))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
      {terminalOpened && (
        <div
          className={`changes-sidebar__terminal${
            changesPaneView === 'terminal' ? ' changes-sidebar__terminal--active' : ''
          }`}
          aria-hidden={changesPaneView !== 'terminal'}
        >
          <TerminalPanel
            active={changesPaneView === 'terminal'}
            commandLaunchRequest={terminalCommandLaunchRequest}
            container={changesContainer}
            cwd={changesCwd}
            projectCwd={changesProjectCwd}
            workspaceKey={terminalWorkspaceKey}
          />
        </div>
      )}
      {browserOpened && effectiveAppSettings.browser.enabled && (
        <div
          className={`changes-sidebar__browser${
            changesPaneView === 'browser' ? ' changes-sidebar__browser--active' : ''
          }`}
          aria-hidden={changesPaneView !== 'browser'}
        >
          <BrowserPanel
            active={changesPaneView === 'browser'}
            appZoomLevel={effectiveAppSettings.appearance.zoomLevel}
            defaultScale={effectiveAppSettings.browser.defaultScale}
            openRequest={browserOpenRequest}
            workspaceKey={browserWorkspaceKey}
          />
        </div>
      )}
    </div>
  )
}
