import { memo, useRef } from 'react'
import { useFeedbackMotion } from '../../motion/useFeedbackMotion'
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

// Chat-specific recents and permissions change while the same project tree is
// visible. Keep those parent updates from rebuilding and reconciling every file.
const ChangedFilesTree = memo(function ChangedFilesTree({
  nodes,
  renderNode
}: {
  nodes: ChangesContentProps['changeTree']
  renderNode: ChangesContentProps['renderChangeTreeNode']
}) {
  return (
    <ul className="changes-sidebar__tree" role="tree">
      {nodes.map((node) => renderNode(node, 0))}
    </ul>
  )
})

const RepositoryFilesTree = memo(function RepositoryFilesTree({
  nodes,
  renderNode
}: {
  nodes: ChangesContentProps['repositoryFileTree']
  renderNode: ChangesContentProps['renderRepositoryFileTreeNode']
}) {
  return (
    <ul className="changes-sidebar__tree" role="tree">
      {nodes.map((node) => renderNode(node, 0))}
    </ul>
  )
})

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
    fileTreeLoadError,
    setFileTreeLoadRequest,
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
    repositoryFileCount,
    repositoryFileTree,
    setGitChangeLoadRequest,
    terminalChatKey,
    terminalCommandLaunchRequest,
    terminalOpened,
    terminalWorkspaceKey,
    untrackedFilesAiDisabled,
    untrackedFilesHiddenForPerformance,
    visibleChangesLoadState,
    visibleFilesLoadState,
    visibleGitChangeLoadError
  } = props

  const panelRef = useRef<HTMLDivElement>(null)
  useFeedbackMotion(panelRef, changesPaneView, 'panel')

  return (
    <div
      ref={panelRef}
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
                <ChangedFilesTree nodes={changeTree} renderNode={renderChangeTreeNode} />
              )}
            </>
          ) : (
            <>
              {visibleFilesLoadState === 'loading' && (
                <ChangesSidebarGitState active label="Loading files" />
              )}
              {visibleFilesLoadState === 'error' && (
                <section
                  className="changes-sidebar__git-error"
                  aria-label="Files error"
                  role="alert"
                >
                  <span className="changes-sidebar__git-error-message">
                    {`Could not list files in ${changesCwd}.\n${fileTreeLoadError ?? 'File listing failed without an error message.'}`}
                  </span>
                  <div className="changes-sidebar__git-error-actions">
                    <Button
                      callback={() => setFileTreeLoadRequest((request) => request + 1)}
                      icon={<GitRefreshIcon />}
                      label={<span>Retry</span>}
                      theme="secondary"
                    />
                  </div>
                </section>
              )}
              {visibleFilesLoadState === 'ready' && repositoryFileCount === 0 && (
                <p className="changes-sidebar__status">{filesEmptyMessage}</p>
              )}
              {visibleFilesLoadState === 'ready' && repositoryFileCount > 0 && (
                <RepositoryFilesTree
                  nodes={repositoryFileTree}
                  renderNode={renderRepositoryFileTreeNode}
                />
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
            chatKey={terminalChatKey}
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
            view={effectiveAppSettings.browser.view}
          />
        </div>
      )}
    </div>
  )
}
