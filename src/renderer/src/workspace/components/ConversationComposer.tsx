import type { ReactElement } from 'react'
import type { WorkspaceController } from '../../useWorkspaceController'
import { getComposerDraftScopeKey } from '../../composerDraft'
import { BellOff, Check, Download, FolderPlus, PackagePlus, X } from 'lucide-react'
import { Button } from '../../components/Button'
import { Dropdown } from '../../components/Dropdown'
import { MessageBox } from '../../components/MessageBox'
import { UserInputRequestBox } from '../../components/UserInputRequestBox'
import { appChatManualDropdownValue } from '../../settings'
import { getContainerTargetKey } from '../../containerSelection'
import { providerLabels } from '../../providerSettings'
import { getRequestErrorPresentation } from '../../requestError'

type ConversationComposerProps = WorkspaceController['conversationComposer']

export function ConversationComposer(props: ConversationComposerProps): ReactElement {
  const {
    accountUsage,
    accountUsageError,
    accountUsageState,
    activeSubagentChatView,
    appSettings,
    approvalDecisionInFlight,
    approvalError,
    approvalModes,
    approvalTypeLabels,
    changesContainer,
    changesCwd,
    changesProjectCwd,
    chatHasActiveTurn,
    chatHasPendingSteeringMessage,
    containerOptions,
    cwdNotesByGroup,
    editingMessage,
    effectiveAppSettings,
    effectiveApprovalMode,
    effectiveModel,
    effectiveReasoningEffort,
    effectiveSandboxMode,
    effectiveServiceTier,
    getApprovalSummary,
    getProviderUpdateSummary,
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
    handleResolveApproval,
    handleRunAction,
    handleSandboxModeChange,
    handleSelectedReviewChange,
    handleSendMessage,
    handleSkipProviderUpdate,
    handleStopChat,
    handleUpdateProvider,
    hasForcedChatDropdown,
    messageBoxContextUsage,
    messageBoxDisabled,
    messageBoxNotesGroup,
    messageBoxProviderAvailable,
    messageBoxQuoteRequest,
    models,
    modelsLoading,
    newChatOpen,
    newSessionContainerValue,
    newSessionCwd,
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
    providerUpdateError,
    providerUpdateInProgress,
    providerUpdateState,
    providerUpdateSuggestion,
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
  const requestErrorPresentation = getRequestErrorPresentation(requestErrorSummary)

  return (
    <div className="chat-panel__composer">
      <div className="chat-panel__composer-inner">
        {!activeSubagentChatView && requestErrorVisible && (
          <section
            className="chat-approval chat-request-error"
            aria-label="Request error"
            role="alert"
          >
            <div className="chat-approval__main">
              {requestErrorPresentation.label && (
                <span className="chat-approval__label">{requestErrorPresentation.label}</span>
              )}
              <span className="chat-approval__summary" title={requestErrorPresentation.summary}>
                {requestErrorPresentation.summary}
              </span>
            </div>
            <div className="chat-approval__actions">
              <Button
                aria-label="Dismiss error"
                title="Dismiss error"
                callback={handleDismissSendError}
                icon={<X aria-hidden="true" />}
                size="small"
                theme="transparent"
              />
            </div>
          </section>
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
        {!selectedChat && newChatOpen && providerUpdateSuggestion && (
          <section
            className="chat-approval chat-provider-update"
            aria-label={`${providerLabels[providerUpdateSuggestion.providerId]} update suggestion`}
          >
            <div className="chat-approval__main">
              <span className="chat-approval__label">
                {providerLabels[providerUpdateSuggestion.providerId]} update available
              </span>
              <span
                className="chat-approval__summary"
                title={getProviderUpdateSummary(providerUpdateSuggestion)}
              >
                {getProviderUpdateSummary(providerUpdateSuggestion)}
              </span>
              {providerUpdateError && (
                <span className="chat-approval__error" role="status">
                  {providerUpdateError}
                </span>
              )}
            </div>
            <div className="chat-approval__actions">
              <Button
                disabled={providerUpdateState === 'updating'}
                callback={handleSkipProviderUpdate}
                dropdownActions={[
                  {
                    id: 'never-suggest-version',
                    label: 'Never suggest this version',
                    title: `Never suggest ${providerUpdateSuggestion.latestVersion}`,
                    disabled: providerUpdateState === 'updating',
                    icon: <X aria-hidden="true" />,
                    callback: handleNeverSuggestProviderUpdateVersion
                  },
                  {
                    id: 'never-suggest',
                    label: 'Never suggest',
                    disabled: providerUpdateState === 'updating',
                    icon: <BellOff aria-hidden="true" />,
                    callback: handleNeverSuggestProviderUpdate
                  }
                ]}
                dropdownLabel="Skip update options"
                dropdownMenuAlign="end"
                dropdownPlacement="top"
                icon={<X aria-hidden="true" />}
                label={<span>Skip</span>}
                theme="secondary"
              />
              <Button
                disabled={providerUpdateState === 'updating'}
                callback={() => void handleUpdateProvider()}
                icon={<Download aria-hidden="true" />}
                label={<span>{providerUpdateState === 'updating' ? 'Updating' : 'Update'}</span>}
                theme="primary"
              />
            </div>
          </section>
        )}
      </div>
      {!selectedChat && newChatOpen && (
        <div className="chat-panel__new-session">
          <span>At</span>
          <Dropdown
            aria-label="Project"
            title={newSessionCwd ?? 'Choose folder'}
            disabled={providerUpdateInProgress || sendState === 'sending'}
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
            size="small"
            value={newSessionProjectValue}
            onChange={(cwd) => setNewSessionCwd(cwd)}
          />
          <span>with</span>
          <Dropdown
            aria-label="Provider"
            disabled={
              providerUpdateInProgress ||
              sendState === 'sending' ||
              newSessionProviderOptions.length === 0
            }
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
            disabled={providerUpdateInProgress || sendState === 'sending'}
            options={newSessionLocationOptions}
            placement="top"
            size="small"
            value={newSessionLocation}
            onChange={setNewSessionLocation}
          />
          <span>{newSessionSshEnvironmentId ? 'over' : 'from'}</span>
          <Dropdown
            aria-label="Runtime"
            disabled={providerUpdateInProgress || sendState === 'sending'}
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
                disabled={
                  providerUpdateInProgress ||
                  sendState === 'sending' ||
                  remoteContainerSuggestionsLoading
                }
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
      <div className="chat-panel__composer-inner">
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
          <section className="chat-approval" aria-label="Approval request">
            <div className="chat-approval__main">
              <span className="chat-approval__label">
                {approvalTypeLabels[pendingApproval.type]}
              </span>
              <span className="chat-approval__summary" title={getApprovalSummary(pendingApproval)}>
                {getApprovalSummary(pendingApproval)}
              </span>
              {pendingApproval.cwd && pendingApproval.command && (
                <span className="chat-approval__cwd" title={pendingApproval.cwd}>
                  {pendingApproval.cwd}
                </span>
              )}
              {approvalError && (
                <span className="chat-approval__error" role="status">
                  {approvalError}
                </span>
              )}
            </div>
            <div className="chat-approval__actions">
              <Button
                disabled={providerUpdateInProgress || Boolean(approvalDecisionInFlight)}
                callback={() => void handleResolveApproval('deny')}
                icon={<X aria-hidden="true" />}
                label={<span>Deny</span>}
                theme="secondary"
              />
              <Button
                disabled={providerUpdateInProgress || Boolean(approvalDecisionInFlight)}
                callback={() => void handleResolveApproval('allow')}
                icon={<Check aria-hidden="true" />}
                label={<span>Allow</span>}
                theme="primary"
              />
            </div>
          </section>
        )}
        {selectedChat && !activeSubagentChatView && pendingUserInput && (
          <UserInputRequestBox
            disabled={providerUpdateInProgress || userInputResolving}
            error={userInputError}
            key={pendingUserInput.id}
            request={pendingUserInput}
            onCancel={() => resolveSelectedUserInput({ kind: 'cancel' })}
            onSubmit={(answer, wasFreeform) =>
              resolveSelectedUserInput({ kind: 'answer', answer, wasFreeform })
            }
          />
        )}
        <MessageBox
          active={activeSubagentChatView ? false : editingMessage ? false : chatHasActiveTurn}
          activePrimaryMode="queue"
          activeSteeringEnabled={!chatHasPendingSteeringMessage}
          actions={appSettings.actions}
          approvalMode={effectiveApprovalMode}
          approvalModes={approvalModes}
          autoFocus={!selectedChat && newChatOpen}
          disabled={messageBoxDisabled}
          editSession={editingMessage}
          accountUsage={accountUsage}
          accountUsageError={accountUsageError}
          accountUsageState={accountUsageState}
          container={changesContainer}
          contextUsage={messageBoxContextUsage}
          displayUsage={effectiveAppSettings.chat.displayUsage}
          draftProjectKey={terminalWorkspaceKey}
          draftScopeKey={getComposerDraftScopeKey(selectedChatKey, terminalWorkspaceKey)}
          lastActionId={appSettings.lastActionId}
          model={effectiveModel}
          models={models}
          modelsLoading={modelsLoading}
          modelsUnavailable={!messageBoxProviderAvailable}
          notesContextKey={messageBoxNotesGroup?.key}
          notes={
            messageBoxNotesGroup ? (cwdNotesByGroup[messageBoxNotesGroup.key] ?? []) : undefined
          }
          notesLabel={messageBoxNotesGroup?.label}
          operationsDisabled={
            providerUpdateInProgress ||
            Boolean(activeSubagentChatView) ||
            !messageBoxProviderAvailable
          }
          pending={sendState === 'sending'}
          providerId={selectedChat?.providerId ?? newSessionProvider}
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
          onActionsChange={handleActionsChange}
          onLastActionChange={handleLastActionChange}
          onApprovalModeChange={handleApprovalModeChange}
          onCancelEdit={handleCancelEditMessage}
          onModelChange={handleModelChange}
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
          onStop={handleStopChat}
          onUsageRefresh={refreshAccountUsage}
          onUsageReset={resetAccountRateLimits}
          onSend={handleSendMessage}
        />
      </div>
    </div>
  )
}
