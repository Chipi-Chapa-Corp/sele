import { Ellipsis, Paperclip } from 'lucide-react'
import { memo } from 'react'
import type { AppSelectedAttachment } from '../../../shared/app'
import type { ProviderActiveSendMode, ProviderApp, ProviderSkill } from '../../../shared/provider'
import { Button } from '../components/Button'
import { ComposerSettings } from '../components/ComposerSettings'
import { type PromptDraft } from '../composerDraft'
import { type ComposerLinkedChat } from '../linkedChats'
import { useCompactLayout } from '../useCompactLayout'
import { ComposerUsageControl, ComposerWorkspaceControls } from './ComposerContextControls'
import { ComposerSendControls } from './ComposerSendControls'

import type { MessageBoxProps } from '../components/MessageBox.types'

type ComposerToolbarProps = {
  settings: MessageBoxProps
  selectedAttachments: AppSelectedAttachment[]
  handleSelectAttachments: () => Promise<void>
  editing: boolean
  handleCancelEdit: () => void
  promptDrafts: readonly PromptDraft[]
  handlePopPromptDraft: (draft: PromptDraft) => void
  handleRemovePromptDraft: (draftId: string) => void
  attachmentSelectionPending: boolean
  linkedChatsBlockSend: boolean
  submitMessage: (activeMode?: ProviderActiveSendMode, content?: string) => void
  handleStop: () => void
  controlPressed: boolean
  message: string
  linkedChats: ComposerLinkedChat[]
  selectedSkills: ProviderSkill[]
  selectedApps: ProviderApp[]
}

export const ComposerToolbar = memo(function ComposerToolbar({
  settings,
  selectedAttachments,
  handleSelectAttachments,
  editing,
  handleCancelEdit,
  promptDrafts,
  handlePopPromptDraft,
  handleRemovePromptDraft,
  attachmentSelectionPending,
  linkedChatsBlockSend,
  submitMessage,
  handleStop,
  controlPressed,
  message,
  linkedChats,
  selectedSkills,
  selectedApps
}: ComposerToolbarProps) {
  const {
    showUsageIndicator = true,
    agentMode,
    agentModes,
    agentModesLoading = false,
    approvalMode,
    approvalModes,
    model,
    models,
    modelsError = null,
    modelsLoading = false,
    modelsUnavailable = false,
    providerId,
    providerUpdating = false,
    reasoningEffort,
    sandboxMode,
    sandboxModes,
    serviceTier,
    presetsEnabled = true,
    selectionAction = 'back',
    showAccessSelector = true,
    showModelSelector = true,
    showReasoningSelector = true,
    showReviewSelector = true,
    showSpeedSelector = true,
    onAgentModeChange,
    onApprovalModeChange,
    onModelChange,
    onPresetChange,
    onReasoningEffortChange,
    onSandboxModeChange,
    onServiceTierChange,
    pending = false,
    operationsDisabled = false,
    active = false,
    activePrimaryMode = 'queue',
    activeSteeringEnabled = true,
    showNotesButton = false,
    notesLabel,
    onNotesChange,
    showActions = false,
    onActionsChange,
    onLastActionChange,
    onRunAction,
    onSetGoal,
    disabled = false,
    editSession = null,
    draftScopeKey,
    selectedReview = null
  } = settings

  const selectorsVisible =
    showAccessSelector ||
    (showReviewSelector && sandboxMode !== 'danger-full-access') ||
    showModelSelector ||
    showReasoningSelector ||
    showSpeedSelector ||
    (providerId === 'copilot' && (agentModesLoading || agentModes.length > 0))

  const compact = useCompactLayout()

  const notesButtonVisible = Boolean(showNotesButton && notesLabel && onNotesChange)

  const actionsButtonVisible = Boolean(
    showActions && onActionsChange && onLastActionChange && onRunAction
  )

  const workspaceControlsVisible = Boolean(onSetGoal) || notesButtonVisible || actionsButtonVisible

  const promptControlsVisible = selectorsVisible || workspaceControlsVisible

  const controlsClassName = [
    'message-box__controls',
    promptControlsVisible ? null : 'message-box__controls--no-selectors'
  ]
    .filter(Boolean)
    .join(' ')

  const workspaceControls = <ComposerWorkspaceControls settings={settings} compact={compact} />
  const usageControl = <ComposerUsageControl settings={settings} compact={compact} />
  return (
    <>
      {selectorsVisible && (
        <label className="sr-only" htmlFor="chat-config-mode">
          Chat settings
        </label>
      )}
      <div className={controlsClassName}>
        <div className="message-box__attachment-controls">
          <Button
            aria-label="Attach files"
            title={
              selectedAttachments.length > 0
                ? `${selectedAttachments.length} file${selectedAttachments.length === 1 ? '' : 's'} attached`
                : 'Attach files'
            }
            callback={handleSelectAttachments}
            icon={<Paperclip aria-hidden="true" />}
            theme="secondary"
          />
          {compact && (workspaceControlsVisible || showUsageIndicator) && (
            <Button
              theme="secondary"
              aria-label="Chat tools"
              dropdownLabel="Chat tools"
              icon={<Ellipsis />}
              callback={() => {}}
              menuOnly
              dropdownWidth={288}
              dropdownPlacement="top"
              dropdownContent={() => (
                <div className="mobile-chat-tools">
                  {workspaceControls}
                  {usageControl}
                </div>
              )}
            />
          )}
        </div>
        {promptControlsVisible && (
          <div className="message-box__selectors">
            {selectorsVisible && (
              <ComposerSettings
                agentMode={agentMode}
                agentModes={agentModes}
                agentModesLoading={agentModesLoading}
                approvalMode={approvalMode}
                approvalModes={approvalModes}
                model={model}
                models={models}
                modelsError={modelsError}
                modelsLoading={modelsLoading}
                modelsUnavailable={modelsUnavailable}
                providerId={providerId}
                providerUpdating={providerUpdating}
                reasoningEffort={reasoningEffort}
                sandboxMode={sandboxMode}
                sandboxModes={sandboxModes}
                serviceTier={serviceTier}
                presetsEnabled={presetsEnabled}
                selectionAction={selectionAction}
                showAccessSelector={showAccessSelector}
                showModelSelector={showModelSelector}
                showReasoningSelector={showReasoningSelector}
                showReviewSelector={showReviewSelector}
                showSpeedSelector={showSpeedSelector}
                onAgentModeChange={onAgentModeChange}
                onApprovalModeChange={onApprovalModeChange}
                onModelChange={onModelChange}
                onPresetChange={onPresetChange}
                onReasoningEffortChange={onReasoningEffortChange}
                onSandboxModeChange={onSandboxModeChange}
                onServiceTierChange={onServiceTierChange}
              />
            )}
            {!compact && workspaceControls}
          </div>
        )}
        <ComposerSendControls
          editing={editing}
          pending={pending}
          handleCancelEdit={handleCancelEdit}
          promptDrafts={promptDrafts}
          handlePopPromptDraft={handlePopPromptDraft}
          handleRemovePromptDraft={handleRemovePromptDraft}
          compact={compact}
          usageControl={usageControl}
          operationsDisabled={operationsDisabled}
          active={active}
          providerUpdating={providerUpdating}
          attachmentSelectionPending={attachmentSelectionPending}
          linkedChatsBlockSend={linkedChatsBlockSend}
          submitMessage={submitMessage}
          handleStop={handleStop}
          activePrimaryMode={activePrimaryMode}
          activeSteeringEnabled={activeSteeringEnabled}
          controlPressed={controlPressed}
          editSession={editSession}
          disabled={disabled}
          draftScopeKey={draftScopeKey}
          message={message}
          selectedAttachments={selectedAttachments}
          linkedChats={linkedChats}
          selectedSkills={selectedSkills}
          selectedApps={selectedApps}
          selectedReview={selectedReview}
        />
      </div>
    </>
  )
})
