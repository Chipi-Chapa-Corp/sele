import type { ReactElement } from 'react'
import type { WorkspaceController } from '../../useWorkspaceController'
import { GitCommitHorizontal, MessageSquare, Sparkles, X } from 'lucide-react'
import { GitCommitHorizontalIcon as AnimatedGitCommitHorizontalIcon } from 'lucide-animated'
import { Button, type ButtonDropdownAction } from '../../components/Button'
import { Input } from '../../components/Input'
import { AnimatedStatusIcon, GitSyncCountsLabel } from '../../components/AppStatusStates'

type ChangesFooterContentProps = WorkspaceController['changesFooter']

export function ChangesFooterContent(props: ChangesFooterContentProps): ReactElement {
  const {
    commitActionLabels,
    commitDisabled,
    commitInput,
    commitInputLabel,
    commitMessageGenerationDisabled,
    commitMessageGenerationInProgress,
    currentProjectCommitError,
    currentProjectKey,
    currentProjectSyncError,
    directProjectCommitInProgress,
    getAiCommitActionDisabled,
    getGitRecoveryActionIcon,
    getGitRecoveryRememberLabel,
    gitCommitModeToggle,
    handleAiCommitChangedFiles,
    handleDismissGitCommitError,
    handleDismissGitSyncRecovery,
    handleDismissUnclassifiedGitSyncError,
    handleGenerateCommitMessage,
    handleGitAiResolution,
    handleGitCommitErrorAiResolution,
    handleGitSyncRecoveryAction,
    handleManualCommitChangedFiles,
    handleQuickCommitChangedFiles,
    handleSyncChanges,
    handleUnclassifiedGitSyncAiResolution,
    hasSyncChanges,
    primarySyncAction,
    projectCommitInProgress,
    providerUpdateInProgress,
    pushAfterCommit,
    renderGitAiResolutionButton,
    setCommitErrorsByProjectKey,
    setCommitInput,
    showCommitInput,
    showManualCommit,
    syncButtonTitle,
    syncDisabled,
    syncDropdownActions,
    syncInProgress,
    unpulledCount,
    unpushedCount,
    visibleSyncRecovery,
    visibleSyncRecoveryActions
  } = props

  return (
    <footer className="changes-sidebar__footer">
      {showCommitInput && (
        <div className="changes-sidebar__input-row">
          <label className="changes-sidebar__commit-message">
            <span className="sr-only">{commitInputLabel}</span>
            <Input
              type="text"
              value={commitInput}
              placeholder={commitInputLabel}
              disabled={
                providerUpdateInProgress ||
                commitMessageGenerationInProgress ||
                projectCommitInProgress
              }
              onChange={(event) => {
                setCommitErrorsByProjectKey((currentErrors) => {
                  if (!currentErrors[currentProjectKey]) return currentErrors

                  const nextErrors = { ...currentErrors }
                  delete nextErrors[currentProjectKey]
                  return nextErrors
                })
                setCommitInput(event.target.value)
              }}
              onKeyDown={(event) => {
                if (showManualCommit && event.key === 'Enter' && !commitDisabled) {
                  void handleManualCommitChangedFiles()
                }
              }}
            />
          </label>
          {showManualCommit && (
            <Button
              aria-label={
                commitMessageGenerationInProgress
                  ? 'Generating commit name'
                  : 'Generate commit name with AI'
              }
              aria-busy={commitMessageGenerationInProgress}
              title={
                commitMessageGenerationInProgress
                  ? 'Generating commit name…'
                  : 'Generate commit name with AI'
              }
              disabled={commitMessageGenerationDisabled}
              callback={() => void handleGenerateCommitMessage()}
              icon={<Sparkles aria-hidden="true" />}
              theme="secondary"
            />
          )}
        </div>
      )}
      {showManualCommit && (
        <div className="changes-sidebar__commit-row changes-sidebar__commit-row--manual">
          <Button
            disabled={commitDisabled}
            callback={() => void handleManualCommitChangedFiles()}
            icon={
              directProjectCommitInProgress ? (
                <AnimatedStatusIcon Icon={AnimatedGitCommitHorizontalIcon} active />
              ) : (
                <GitCommitHorizontal aria-hidden="true" />
              )
            }
            label={<span>{commitActionLabels.commit}</span>}
            theme="primary"
            fill
          />
          {gitCommitModeToggle}
        </div>
      )}
      <div
        className={`changes-sidebar__commit-row changes-sidebar__commit-row--ai${
          showManualCommit ? '' : ' changes-sidebar__commit-row--with-mode'
        }`}
      >
        <Button
          disabled={commitMessageGenerationDisabled}
          callback={() => void handleQuickCommitChangedFiles(pushAfterCommit)}
          icon={<Sparkles aria-hidden="true" />}
          label={<span>AI Commit</span>}
          theme={showManualCommit ? 'secondary' : 'primary'}
          fill
        />
        <Button
          disabled={getAiCommitActionDisabled()}
          callback={() => void handleAiCommitChangedFiles(pushAfterCommit)}
          icon={<MessageSquare aria-hidden="true" />}
          label={<span>AI Chat Commit</span>}
          theme="secondary"
          fill
        />
        {!showManualCommit && gitCommitModeToggle}
      </div>
      {hasSyncChanges && (
        <div className="changes-sidebar__sync-row">
          <Button
            title={syncButtonTitle}
            disabled={syncDisabled}
            callback={() => void handleSyncChanges(primarySyncAction)}
            dropdownActions={primarySyncAction === 'push' ? undefined : syncDropdownActions}
            dropdownLabel="Sync actions"
            dropdownMenuAlign="end"
            dropdownPlacement="top"
            label={
              <GitSyncCountsLabel
                active={syncInProgress}
                unpulledCount={unpulledCount}
                unpushedCount={unpushedCount}
              />
            }
            theme="secondary"
            fill
          />
        </div>
      )}
      {visibleSyncRecovery && (
        <section className="changes-sidebar__git-error" aria-label="Git recovery options">
          <span className="changes-sidebar__git-error-message" role="status">
            {visibleSyncRecovery.error ?? visibleSyncRecovery.failure.error}
          </span>
          <div className="changes-sidebar__git-error-actions">
            {visibleSyncRecoveryActions.map((action, actionIndex) => {
              const rememberLabel = getGitRecoveryRememberLabel(action.id)
              const alternativeAction =
                action.id === 'pull-rebase'
                  ? visibleSyncRecovery.failure.actions.find(
                      (candidateAction) => candidateAction.id === 'pull-merge'
                    )
                  : action.id === 'push-current-branch'
                    ? visibleSyncRecovery.failure.actions.find(
                        (candidateAction) => candidateAction.id === 'push-upstream-branch'
                      )
                    : null
              const rememberedPushActions: ButtonDropdownAction[] =
                action.id === 'push-current-branch' &&
                alternativeAction?.id === 'push-upstream-branch'
                  ? [
                      {
                        id: 'push-current-branch-remember',
                        label: `Remember ${action.label.replace(/^Push to /, '')}`,
                        title: `Remember ${action.label.toLowerCase()} for this repository`,
                        icon: getGitRecoveryActionIcon(action.id),
                        callback: () =>
                          void handleGitSyncRecoveryAction(action.id, {
                            rememberPushTarget: true
                          })
                      },
                      {
                        id: 'push-upstream-branch-remember',
                        label: `Remember ${alternativeAction.label.replace(/^Push to /, '')}`,
                        title: `Remember ${alternativeAction.label.toLowerCase()} for this repository`,
                        icon: getGitRecoveryActionIcon(alternativeAction.id),
                        callback: () =>
                          void handleGitSyncRecoveryAction(alternativeAction.id, {
                            rememberPushTarget: true
                          })
                      }
                    ]
                  : []
              const dropdownActions: ButtonDropdownAction[] = [
                ...(rememberLabel
                  ? [
                      {
                        id: `${action.id}-remember`,
                        label: rememberLabel,
                        title: `${rememberLabel} for this repository`,
                        callback: () =>
                          void handleGitSyncRecoveryAction(action.id, {
                            rememberStrategy: true
                          })
                      }
                    ]
                  : []),
                ...(alternativeAction
                  ? [
                      {
                        id: alternativeAction.id,
                        label: alternativeAction.label,
                        title: alternativeAction.description,
                        icon: getGitRecoveryActionIcon(alternativeAction.id),
                        callback: () => void handleGitSyncRecoveryAction(alternativeAction.id)
                      },
                      ...(alternativeAction.id === 'pull-merge'
                        ? [
                            {
                              id: 'pull-merge-remember',
                              label: 'Remember merge',
                              title: 'Remember merge for this repository',
                              icon: getGitRecoveryActionIcon(alternativeAction.id),
                              callback: () =>
                                void handleGitSyncRecoveryAction(alternativeAction.id, {
                                  rememberStrategy: true
                                })
                            }
                          ]
                        : [])
                    ]
                  : []),
                ...rememberedPushActions
              ]

              return (
                <Button
                  key={action.id}
                  title={action.description}
                  disabled={syncInProgress}
                  callback={() => void handleGitSyncRecoveryAction(action.id)}
                  dropdownActions={dropdownActions.length > 0 ? dropdownActions : undefined}
                  dropdownLabel={`${action.label} options`}
                  dropdownMenuAlign="end"
                  dropdownPlacement="top"
                  icon={getGitRecoveryActionIcon(action.id)}
                  label={<span>{action.label}</span>}
                  theme={actionIndex === 0 ? 'primary' : 'secondary'}
                />
              )
            })}
            {renderGitAiResolutionButton(handleGitAiResolution)}
            <Button
              disabled={syncInProgress}
              callback={handleDismissGitSyncRecovery}
              icon={<X aria-hidden="true" />}
              label={<span>Dismiss</span>}
              theme="secondary"
            />
          </div>
        </section>
      )}
      {currentProjectCommitError && (
        <section className="changes-sidebar__git-error" aria-label="Git commit error">
          <span className="changes-sidebar__git-error-message" role="status">
            {currentProjectCommitError}
          </span>
          <div className="changes-sidebar__git-error-actions">
            {renderGitAiResolutionButton(handleGitCommitErrorAiResolution)}
            <Button
              callback={handleDismissGitCommitError}
              icon={<X aria-hidden="true" />}
              label={<span>Dismiss</span>}
              theme="secondary"
            />
          </div>
        </section>
      )}
      {currentProjectSyncError && !visibleSyncRecovery && (
        <section className="changes-sidebar__git-error" aria-label="Git sync error">
          <span className="changes-sidebar__git-error-message" role="status">
            {currentProjectSyncError}
          </span>
          <div className="changes-sidebar__git-error-actions">
            {renderGitAiResolutionButton(handleUnclassifiedGitSyncAiResolution)}
            <Button
              callback={handleDismissUnclassifiedGitSyncError}
              icon={<X aria-hidden="true" />}
              label={<span>Dismiss</span>}
              theme="secondary"
            />
          </div>
        </section>
      )}
    </footer>
  )
}
