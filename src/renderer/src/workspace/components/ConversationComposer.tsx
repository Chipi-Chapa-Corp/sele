import { LimitResetQueueMessages } from '../../components/LimitResetQueueMessages'
import { useEffect, useState, type ReactElement } from 'react'
import type { WorkspaceController } from '../../useWorkspaceController'
import { getComposerDraftScopeKey } from '../../composerDraft'
import { FolderPlus, PackagePlus, X } from 'lucide-react'
import { Button } from '../../components/Button'
import { Dropdown } from '../../components/Dropdown'
import { MessageBox } from '../../components/MessageBox'
import { ApprovalRequestBox } from '../../components/ApprovalRequestBox'
import { ElicitationRequestBox } from '../../components/ElicitationRequestBox'
import { UserInputRequestBox } from '../../components/UserInputRequestBox'
import { appChatManualDropdownValue } from '../../settings'
import { getContainerTargetKey } from '../../containerSelection'
import { ProviderUpdateBanners } from '../../components/ProviderUpdateBanners'
import { RequestErrorBanner } from '../../components/RequestErrorBanner'
import { OpenCodeConnectionError } from '../../components/OpenCodeConnectionError'
import { newSessionNoProjectValue, newSessionProjectPlaceholderValue } from '../controllerTypes'

type ConversationComposerProps = WorkspaceController['conversationComposer']

export function ConversationComposer(props: ConversationComposerProps): ReactElement {
  const [narrowLayout, setNarrowLayout] = useState(
    () => window.matchMedia('(max-width: 50rem)').matches
  )
  useEffect(() => {
    const media = window.matchMedia('(max-width: 50rem)')
    const update = (): void => setNarrowLayout(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const {
    authenticationRequired,
    openCodeConnectionFailure,
    handleManageOpenCodeProviders,
    handleOpenChatReauthentication,
    handleManageChatAccounts,
    accountUsage,
    accountUsageError,
    accountUsageState,
    activeSubagentChatView,
    agentModes,
    agentModesLoading,
    appSettings,
    approvalDecisionInFlight,
    approvalError,
    approvalModes,
    changesContainer,
    changesCwd,
    changesProjectCwd,
    chatHasActiveTurn,
    chatHasPendingSteeringMessage,
    chatOpenedElsewhere,
    chatLegacyHistoryReadOnly,
    containerOptions,
    cwdNotesByGroup,
    editingMessage,
    effectiveAppSettings,
    agentMode,
    effectiveApprovalMode,
    effectiveModel,
    effectiveReasoningEffort,
    effectiveSandboxMode,
    effectiveServiceTier,
    handleChatPresetChange,
    handleActionsChange,
    handleApprovalModeChange,
    handleCancelEditMessage,
    handleCancelWorktreeCreation,
    handleCwdNotesChange,
    handleDismissSendError,
    handleLastActionChange,
    handleModelChange,
    handleNeverSuggestProviderUpdate,
    handleNeverSuggestProviderUpdateVersion,
    handleNewSessionContainerChange,
    handleNewSessionRemoteRuntimeChange,
    handleOpenAttachment,
    handleOpenFileLink,
    handleReasoningEffortChange,
    handleRetryChatWriteAccess,
    handleResolveApproval,
    handleRunAction,
    handleSandboxModeChange,
    handleSelectedReviewChange,
    handleSendMessage,
    handleQueueLimitReset,
    limitResetTarget,
    handleSkipProviderUpdate,
    handleCompactChat,
    handleStopChat,
    handleUpdateProvider,
    hasForcedChatDropdown,
    messageBoxContextUsage,
    messageBoxDisabled,
    messageBoxNotesGroup,
    messageBoxProviderAvailable,
    goalObjective,
    onSetGoal,
    messageBoxQuoteRequest,
    models,
    modelsError,
    modelsLoading,
    newChatOpen,
    newSessionContainerValue,
    newSessionCwd,
    newSessionNoProject,
    newSessionLocation,
    newSessionLocationOptions,
    newSessionProjectValue,
    newSessionProvider,
    newSessionProviderOptions,
    newSessionProviderValueContent,
    newSessionRemoteRuntime,
    newSessionSshEnvironmentId,
    pendingApproval,
    pendingUserInput,
    projectOptions,
    providerResourcesRevision,
    anyProviderUpdateInProgress,
    providerUpdateErrors,
    providerUpdateInProgress,
    updatingProviderUpdateKey,
    providerUpdateSuggestions,
    refreshAccountUsage,
    remoteContainerSuggestionsError,
    remoteContainerSuggestionsLoading,
    remoteRuntimeOptions,
    requestErrorSummary,
    requestErrorVisible,
    resetAccountRateLimits,
    resolveSelectedUserInput,
    sandboxModes,
    selectedChat,
    selectedChatKey,
    selectedReview,
    sendState,
    setEditingSshEnvironment,
    setAgentMode,
    setNewSessionCwd,
    setNewSessionLocation,
    setNewSessionProvider,
    setProjectDialogOpen,
    setRemoteContainerSuggestionsError,
    setServiceTier,
    setSshEnvironmentDialogOpen,
    setSshEnvironmentError,
    sshEnvironmentError,
    terminalWorkspaceKey,
    userInputError,
    userInputResolving,
    worktreeCreationState
  } = props
  return (
    <div
      className="chat-panel__composer"
      style={
        activeSubagentChatView && !activeSubagentChatView.summary.canMessage
          ? { display: 'none' }
          : undefined
      }
    >
      <div className="chat-panel__composer-inner chat-panel__composer-notices">
        {!activeSubagentChatView && openCodeConnectionFailure && (
          <OpenCodeConnectionError
            failure={openCodeConnectionFailure}
            onManage={handleManageOpenCodeProviders}
          />
        )}
        {!activeSubagentChatView && authenticationRequired && !openCodeConnectionFailure && (
          <section
            className="chat-approval chat-request-error"
            role="alert"
            aria-label="Account sign-in required"
          >
            <div className="chat-approval__main">
              <span className="chat-approval__summary">
                Your{' '}
                {selectedChat?.providerId === 'codex' ||
                (!selectedChat && newSessionProvider === 'codex')
                  ? 'Codex'
                  : 'Claude'}{' '}
                account needs authorization. Sign in again to send messages.
              </span>
            </div>
            <div className="chat-approval__actions">
              <Button
                callback={handleOpenChatReauthentication}
                label="Sign in again"
                theme="primary"
              />
              <Button
                callback={handleManageChatAccounts}
                label="Switch account"
                theme="secondary"
              />
            </div>
          </section>
        )}
        {!activeSubagentChatView && !authenticationRequired && requestErrorVisible && (
          <RequestErrorBanner message={requestErrorSummary}>
            {chatOpenedElsewhere ? (
              <Button
                callback={handleRetryChatWriteAccess}
                label={<span>Retry</span>}
                size="small"
                theme="transparent"
              />
            ) : chatLegacyHistoryReadOnly ? null : (
              <Button
                aria-label="Dismiss error"
                title="Dismiss error"
                callback={handleDismissSendError}
                icon={<X aria-hidden="true" />}
                size="small"
                theme="transparent"
              />
            )}
          </RequestErrorBanner>
        )}
        {!selectedChat && newChatOpen && remoteContainerSuggestionsError && (
          <section
            className="chat-approval chat-request-error"
            aria-label="Container lookup error"
            role="alert"
          >
            <div className="chat-approval__main">
              <span className="chat-approval__label">Container lookup failed</span>
              <span className="chat-approval__summary" title={remoteContainerSuggestionsError}>
                {remoteContainerSuggestionsError}
              </span>
            </div>
            <div className="chat-approval__actions">
              <Button
                aria-label="Dismiss container lookup error"
                title="Dismiss error"
                callback={() => setRemoteContainerSuggestionsError(null)}
                icon={<X aria-hidden="true" />}
                size="small"
                theme="transparent"
              />
            </div>
          </section>
        )}
        {!selectedChat && newChatOpen && (
          <ProviderUpdateBanners
            providerUpdateSuggestions={providerUpdateSuggestions}
            providerUpdateErrors={providerUpdateErrors}
            updatingProviderUpdateKey={updatingProviderUpdateKey}
            providerUpdateInProgress={anyProviderUpdateInProgress}
            handleSkipProviderUpdate={handleSkipProviderUpdate}
            handleNeverSuggestProviderUpdate={handleNeverSuggestProviderUpdate}
            handleNeverSuggestProviderUpdateVersion={handleNeverSuggestProviderUpdateVersion}
            handleUpdateProvider={handleUpdateProvider}
          />
        )}
        {!selectedChat && newChatOpen && worktreeCreationState !== 'idle' && (
          <section className="chat-approval chat-worktree-creation" aria-label="Worktree creation">
            <div className="chat-approval__main">
              <span className="chat-approval__label">Creating worktree</span>
            </div>
            <div className="chat-approval__actions">
              <Button
                disabled={worktreeCreationState === 'canceling'}
                callback={() => void handleCancelWorktreeCreation()}
                icon={<X aria-hidden="true" />}
                label={<span>Cancel</span>}
                theme="secondary"
              />
            </div>
          </section>
        )}
        {selectedChat && !activeSubagentChatView && pendingApproval && (
          <ApprovalRequestBox
            approval={pendingApproval}
            disabled={Boolean(approvalDecisionInFlight)}
            error={approvalError}
            onResolve={handleResolveApproval}
          />
        )}
        {selectedChat &&
          !activeSubagentChatView &&
          pendingUserInput &&
          (pendingUserInput.elicitation ? (
            <ElicitationRequestBox
              key={pendingUserInput.id}
              request={pendingUserInput}
              disabled={userInputResolving}
              error={userInputError}
              onRespond={resolveSelectedUserInput}
            />
          ) : (
            <UserInputRequestBox
              disabled={userInputResolving}
              error={userInputError}
              key={pendingUserInput.id}
              request={pendingUserInput}
              onCancel={() => resolveSelectedUserInput({ kind: 'cancel' })}
              onSubmit={(answer, wasFreeform) =>
                resolveSelectedUserInput({ kind: 'answer', answer, wasFreeform })
              }
            />
          ))}
      </div>
      {!selectedChat && newChatOpen && (
        <div className="chat-panel__new-session">
          <span>At</span>
          <Dropdown
            aria-label="Project"
            title={newSessionNoProject ? 'No Project' : (newSessionCwd ?? 'Choose folder')}
            disabled={sendState === 'sending'}
            emptyContent="No matching projects"
            menuActions={[
              {
                id: 'add-project',
                label: 'Add project..',
                title: 'Add project..',
                icon: <FolderPlus aria-hidden="true" />,
                callback: () => setProjectDialogOpen(true)
              }
            ]}
            options={projectOptions}
            placement="top"
            searchable
            searchPlaceholder="Search projects"
            size="small"
            value={newSessionProjectValue}
            onChange={(value) => {
              if (value === newSessionNoProjectValue) {
                setNewSessionCwd(null)
                setNewSessionLocation('folder')
                return
              }
              if (value === newSessionProjectPlaceholderValue) return
              setNewSessionCwd(value)
            }}
          />
          <span>with</span>
          <Dropdown
            aria-label="Provider"
            disabled={sendState === 'sending' || newSessionProviderOptions.length === 0}
            emptyContent="No providers found"
            options={newSessionProviderOptions}
            placement="top"
            size="small"
            value={newSessionProvider}
            valueContent={newSessionProviderValueContent}
            onChange={setNewSessionProvider}
          />
          <span>in</span>
          <Dropdown
            aria-label="Session location"
            disabled={sendState === 'sending' || newSessionNoProject}
            options={newSessionLocationOptions}
            placement="top"
            size="small"
            value={newSessionNoProject ? 'folder' : newSessionLocation}
            onChange={setNewSessionLocation}
          />
          <span>{newSessionSshEnvironmentId ? 'over' : 'from'}</span>
          <Dropdown
            aria-label="Runtime"
            disabled={sendState === 'sending'}
            menuActions={[
              ...(sshEnvironmentError
                ? [
                    {
                      id: 'environment-error',
                      label: sshEnvironmentError,
                      title: sshEnvironmentError,
                      disabled: true,
                      icon: <X aria-hidden="true" />,
                      callback: () => {}
                    }
                  ]
                : []),
              {
                id: 'add-environment',
                label: 'Add environment',
                title: 'Add environment',
                icon: <PackagePlus aria-hidden="true" />,
                callback: () => {
                  setEditingSshEnvironment(null)
                  setSshEnvironmentError(null)
                  setSshEnvironmentDialogOpen(true)
                }
              }
            ]}
            options={containerOptions}
            placement="top"
            size="small"
            value={newSessionContainerValue}
            onChange={handleNewSessionContainerChange}
          />
          {newSessionSshEnvironmentId && newSessionRemoteRuntime && (
            <>
              <span>from</span>
              <Dropdown
                aria-label="Remote runtime"
                disabled={sendState === 'sending' || remoteContainerSuggestionsLoading}
                options={remoteRuntimeOptions}
                placement="top"
                size="small"
                value={getContainerTargetKey(newSessionRemoteRuntime)}
                valueContent={remoteContainerSuggestionsLoading ? 'Checking' : undefined}
                onChange={handleNewSessionRemoteRuntimeChange}
              />
            </>
          )}
        </div>
      )}
      <div className="chat-panel__composer-input">
        <div className="chat-panel__composer-inner">
          {!selectedChat && newChatOpen && !activeSubagentChatView && (
            <LimitResetQueueMessages
              key={JSON.stringify([newSessionProvider, limitResetTarget])}
              providerId={newSessionProvider}
              target={limitResetTarget}
            />
          )}
          <MessageBox
            active={activeSubagentChatView ? false : editingMessage ? false : chatHasActiveTurn}
            activePrimaryMode={
              chatHasPendingSteeringMessage
                ? 'queue'
                : effectiveAppSettings.chat.defaultActiveAction
            }
            activeSteeringEnabled={!chatHasPendingSteeringMessage}
            actions={appSettings.actions}
            agentMode={agentMode}
            agentModes={agentModes}
            agentModesLoading={agentModesLoading}
            approvalMode={effectiveApprovalMode}
            approvalModes={approvalModes}
            autoFocus={!selectedChat && newChatOpen}
            disabled={messageBoxDisabled}
            editSession={editingMessage}
            accountUsage={accountUsage}
            accountUsageError={accountUsageError}
            accountUsageState={accountUsageState}
            container={changesContainer}
            chatId={selectedChat?.id}
            contextUsage={messageBoxContextUsage}
            displayUsage={effectiveAppSettings.chat.displayUsage}
            linkedChatSummaryPrompt={effectiveAppSettings.chat.linkedChatSummaryPrompt}
            showUsageIndicator={narrowLayout}
            draftScopeKey={getComposerDraftScopeKey(
              activeSubagentChatView
                ? `${selectedChat?.providerId}:${activeSubagentChatView.summary.id}`
                : selectedChatKey,
              terminalWorkspaceKey
            )}
            lastActionId={appSettings.lastActionId}
            goalObjective={goalObjective}
            model={effectiveModel}
            models={models}
            modelsError={modelsError}
            modelsLoading={modelsLoading}
            modelsUnavailable={!messageBoxProviderAvailable}
            notesContextKey={messageBoxNotesGroup?.key}
            notes={
              messageBoxNotesGroup ? (cwdNotesByGroup[messageBoxNotesGroup.key] ?? []) : undefined
            }
            notesLabel={messageBoxNotesGroup?.label}
            operationsDisabled={Boolean(activeSubagentChatView) || !messageBoxProviderAvailable}
            pending={sendState === 'sending'}
            providerId={selectedChat?.providerId ?? newSessionProvider}
            providerUpdating={providerUpdateInProgress}
            providerResourcesRevision={providerResourcesRevision}
            projectCwd={changesProjectCwd}
            quoteRequest={messageBoxQuoteRequest}
            cwd={changesCwd}
            reasoningEffort={effectiveReasoningEffort}
            sandboxMode={effectiveSandboxMode}
            sandboxModes={sandboxModes}
            selectedReview={selectedReview}
            serviceTier={effectiveServiceTier}
            showAccessSelector={
              messageBoxProviderAvailable &&
              effectiveAppSettings.chat.forceAccess === appChatManualDropdownValue
            }
            presetsEnabled={effectiveAppSettings.chat.presets}
            selectionAction={effectiveAppSettings.chat.selectionAction}
            onPresetChange={handleChatPresetChange}
            showActions={effectiveAppSettings.chat.enableActions}
            showActionLabel={hasForcedChatDropdown}
            showModelSelector={effectiveAppSettings.chat.forceModel === appChatManualDropdownValue}
            showNotesButton={effectiveAppSettings.chat.enableNotesButton}
            showReasoningSelector={
              messageBoxProviderAvailable &&
              effectiveAppSettings.chat.forceReasoning === appChatManualDropdownValue
            }
            showReviewSelector={
              messageBoxProviderAvailable &&
              effectiveAppSettings.chat.forceReview === appChatManualDropdownValue
            }
            showSpeedSelector={
              messageBoxProviderAvailable &&
              effectiveAppSettings.chat.forceSpeed === appChatManualDropdownValue
            }
            onAgentModeChange={setAgentMode}
            onActionsChange={handleActionsChange}
            onLastActionChange={handleLastActionChange}
            onApprovalModeChange={handleApprovalModeChange}
            onCancelEdit={handleCancelEditMessage}
            onModelChange={handleModelChange}
            onSetGoal={onSetGoal}
            onNotesChange={
              messageBoxNotesGroup
                ? (notes) => handleCwdNotesChange(messageBoxNotesGroup, notes)
                : undefined
            }
            onOpenAttachment={changesCwd ? handleOpenAttachment : undefined}
            onOpenFileLink={changesCwd ? handleOpenFileLink : undefined}
            onReasoningEffortChange={handleReasoningEffortChange}
            onRunAction={handleRunAction}
            onServiceTierChange={setServiceTier}
            onSelectedReviewChange={handleSelectedReviewChange}
            onSandboxModeChange={handleSandboxModeChange}
            onCompact={selectedChat && !activeSubagentChatView ? handleCompactChat : undefined}
            onStop={handleStopChat}
            onUsageRefresh={refreshAccountUsage}
            onUsageReset={resetAccountRateLimits}
            onQueueLimitReset={
              (selectedChat || newChatOpen) &&
              !activeSubagentChatView &&
              !chatOpenedElsewhere &&
              !chatLegacyHistoryReadOnly &&
              !providerUpdateInProgress
                ? handleQueueLimitReset
                : undefined
            }
            onSend={handleSendMessage}
          />
        </div>
      </div>
    </div>
  )
}
