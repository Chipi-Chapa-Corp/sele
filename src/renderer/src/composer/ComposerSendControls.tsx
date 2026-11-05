import type { ReactNode } from 'react'
import type { ProviderReview } from '../../../shared/provider'
import { ArrowUp, CornerDownRight, ListPlus, Square } from 'lucide-react'
import { memo } from 'react'
import type { AppSelectedAttachment } from '../../../shared/app'
import type { ProviderActiveSendMode, ProviderApp, ProviderSkill } from '../../../shared/provider'
import { Button } from '../components/Button'
import { PromptDraftsButton } from '../components/PromptDraftsButton'
import { type PromptDraft } from '../composerDraft'
import { type ComposerLinkedChat } from '../linkedChats'
import { getModifiedActiveSendMode } from '../messageSendMode'
import { useCompactLayout } from '../useCompactLayout'
import { useSwitchSettledDisabled } from '../useSwitchSettledDisabled'

type ComposerSendControlsProps = {
  editing: boolean
  pending: boolean
  handleCancelEdit: () => void
  promptDrafts: readonly PromptDraft[]
  handlePopPromptDraft: (draft: PromptDraft) => void
  handleRemovePromptDraft: (draftId: string) => void
  compact: ReturnType<typeof useCompactLayout>
  usageControl: ReactNode
  operationsDisabled: boolean
  active: boolean
  providerUpdating: boolean
  attachmentSelectionPending: boolean
  linkedChatsBlockSend: boolean
  submitMessage: (activeMode?: ProviderActiveSendMode, content?: string) => void
  handleStop: () => void
  activePrimaryMode: 'steer' | 'queue'
  activeSteeringEnabled: boolean
  controlPressed: boolean
  editSession: {
    id: string
    content: string
    attachments: AppSelectedAttachment[]
    type?: 'message' | 'pending'
  } | null
  disabled: boolean
  draftScopeKey: string
  message: string
  selectedAttachments: AppSelectedAttachment[]
  linkedChats: ComposerLinkedChat[]
  selectedSkills: ProviderSkill[]
  selectedApps: ProviderApp[]
  selectedReview: Omit<ProviderReview, 'prompt'> | null
}

export const ComposerSendControls = memo(function ComposerSendControls({
  editing,
  pending,
  handleCancelEdit,
  promptDrafts,
  handlePopPromptDraft,
  handleRemovePromptDraft,
  compact,
  usageControl,
  operationsDisabled,
  active,
  providerUpdating,
  attachmentSelectionPending,
  linkedChatsBlockSend,
  submitMessage,
  handleStop,
  activePrimaryMode,
  activeSteeringEnabled,
  controlPressed,
  editSession,
  disabled,
  draftScopeKey,
  message,
  selectedAttachments,
  linkedChats,
  selectedSkills,
  selectedApps,
  selectedReview
}: ComposerSendControlsProps) {
  const modifiedActiveSendMode = getModifiedActiveSendMode(
    activePrimaryMode,
    activeSteeringEnabled,
    controlPressed
  )

  const activePrimaryLabel =
    modifiedActiveSendMode === 'queue' ? 'Queue message' : 'Steer current turn'

  const editingPendingMessage = editSession?.type === 'pending'

  // The prompt, attachments, usage, chat settings and notes stay usable in every state; only
  // the send button and actions are gated by pending, unavailable or read-only states.
  // Chat switches briefly report the next chat as loading; only show Send as blocked when that
  // outlasts the switch. submitMessage still checks the real `disabled` and `operationsDisabled`.
  const sendBlockedDisplay = useSwitchSettledDisabled(
    operationsDisabled || (!active && disabled),
    draftScopeKey
  )

  const hasContent =
    Boolean(message.trim()) ||
    selectedAttachments.length > 0 ||
    linkedChats.length > 0 ||
    selectedSkills.length > 0 ||
    selectedApps.length > 0 ||
    Boolean(selectedReview && !editing)

  const activeWithContent = active && hasContent

  const buttonLabel = activeWithContent
    ? activePrimaryLabel
    : active
      ? 'Stop response'
      : editing
        ? 'Save edit'
        : 'Send message'

  const activeDropdownActions = activeWithContent
    ? [
        ...(modifiedActiveSendMode === 'steer'
          ? [
              {
                id: 'queue',
                label: 'Queue',
                title: 'Send this as the next turn after the current response finishes',
                callback: () => submitMessage('queue'),
                disabled: operationsDisabled || providerUpdating,
                icon: <ListPlus aria-hidden="true" />
              }
            ]
          : activeSteeringEnabled
            ? [
                {
                  id: 'steer',
                  label: 'Steer',
                  title: 'Send this guidance to the current response',
                  callback: () => submitMessage('steer'),
                  disabled: operationsDisabled || providerUpdating,
                  icon: <CornerDownRight aria-hidden="true" />
                }
              ]
            : []),
        {
          id: 'interrupt',
          label: 'Interrupt',
          title: 'Stop the current response and send this message',
          callback: () => submitMessage('interrupt'),
          disabled: operationsDisabled || providerUpdating,
          icon: <Square aria-hidden="true" />
        }
      ]
    : undefined
  return (
    <div className="message-box__send-controls">
      {editing && (
        <Button disabled={pending} callback={handleCancelEdit} label="Cancel" theme="secondary" />
      )}
      {promptDrafts.length > 0 && (
        <PromptDraftsButton
          drafts={promptDrafts}
          disabled={editing}
          onPop={handlePopPromptDraft}
          onRemove={handleRemovePromptDraft}
        />
      )}
      {!compact && usageControl}
      <Button
        aria-label={buttonLabel}
        title={buttonLabel}
        disabled={
          (activeWithContent ? operationsDisabled : sendBlockedDisplay) ||
          ((!active || activeWithContent) && providerUpdating) ||
          (attachmentSelectionPending && (!active || activeWithContent)) ||
          (linkedChatsBlockSend && (!active || activeWithContent)) ||
          (activeWithContent ? pending : active ? false : pending || !hasContent)
        }
        callback={activeWithContent ? submitMessage : active ? handleStop : submitMessage}
        onClick={
          activeWithContent
            ? (event) => {
                event.preventDefault()
                submitMessage(
                  getModifiedActiveSendMode(activePrimaryMode, activeSteeringEnabled, event.ctrlKey)
                )
              }
            : undefined
        }
        dropdownActions={activeDropdownActions}
        dropdownLabel="Message actions"
        dropdownMenuAlign="end"
        dropdownPlacement="top"
        icon={
          editingPendingMessage ? (
            <ListPlus aria-hidden="true" />
          ) : activeWithContent && modifiedActiveSendMode === 'steer' ? (
            <CornerDownRight aria-hidden="true" />
          ) : activeWithContent ? (
            <ListPlus aria-hidden="true" />
          ) : active ? (
            <Square aria-hidden="true" />
          ) : (
            <ArrowUp aria-hidden="true" />
          )
        }
        theme="primary"
      />
      {activeWithContent && (
        <Button
          aria-label="Stop response"
          title="Stop response"
          disabled={operationsDisabled}
          callback={handleStop}
          icon={<Square aria-hidden="true" />}
          theme="secondary"
        />
      )}
    </div>
  )
})
