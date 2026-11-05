import { Blocks, LoaderCircle, MessagesSquare, Package, X } from 'lucide-react'
import type { RefObject } from 'react'
import { memo } from 'react'
import type { AppSelectedAttachment } from '../../../shared/app'
import type { ProviderApp, ProviderReview, ProviderSkill } from '../../../shared/provider'
import { AttachmentChip } from '../components/AttachmentChip'
import { Button } from '../components/Button'
import { useLinkedChatOpener } from '../components/LinkedChatOpener'
import { ReviewCommentsButton } from '../components/ReviewCommentsButton'
import { FileIcon as SymbolsFileIcon } from '../components/SymbolIcons'
import { type ComposerLinkedChat } from '../linkedChats'
import { getSkillSummary } from './mentionResults'

const copilotMultipleSkillsTooltip = "Copilot doesn't support multiple skills invocation"

type ComposerAttachmentsProps = {
  selectedAttachments: AppSelectedAttachment[]
  linkedChats: ComposerLinkedChat[]
  selectedSkills: ProviderSkill[]
  selectedApps: ProviderApp[]
  handleOpenAttachment: (attachment: AppSelectedAttachment) => void
  handleRemoveAttachment: (path: string) => void
  handleRemoveLinkedChat: (linkedChat: ComposerLinkedChat) => void
  providerId: 'codex' | 'claude' | 'copilot' | 'opencode-v2'
  textareaRef: RefObject<HTMLTextAreaElement | null>
  handleRemoveSkill: (path: string) => void
  handleRemoveApp: (id: string) => void
  onOpenAttachment: ((attachment: AppSelectedAttachment) => void) | undefined
  selectedReview: Omit<ProviderReview, 'prompt'> | null
  onOpenFileLink:
    | ((path: string, displayPath: string, line?: number, endLine?: number) => void)
    | undefined
  onSelectedReviewChange: ((review: Omit<ProviderReview, 'prompt'> | null) => void) | undefined
  projectCwd: string | null | undefined
  editing: boolean
}

export const ComposerAttachments = memo(function ComposerAttachments({
  selectedAttachments,
  linkedChats,
  selectedSkills,
  selectedApps,
  handleOpenAttachment,
  handleRemoveAttachment,
  handleRemoveLinkedChat,
  providerId,
  textareaRef,
  handleRemoveSkill,
  handleRemoveApp,
  onOpenAttachment,
  selectedReview,
  onOpenFileLink,
  onSelectedReviewChange,
  projectCwd,
  editing
}: ComposerAttachmentsProps) {
  const openLinkedChat = useLinkedChatOpener()

  const selectedImages = selectedAttachments.filter((attachment) => attachment.kind === 'image')

  const selectedFiles = selectedAttachments.filter((attachment) => attachment.kind === 'file')

  const showSelectedReview = Boolean(selectedReview && !editing)
  return (
    (selectedAttachments.length > 0 ||
      linkedChats.length > 0 ||
      selectedSkills.length > 0 ||
      selectedApps.length > 0 ||
      showSelectedReview) && (
      <div className="message-box__attachment-previews">
        {selectedImages.length > 0 && (
          <div
            className="message-box__attachment-preview-group message-box__attachment-preview-group--images"
            aria-label="Selected images"
            role="list"
          >
            {selectedImages.map((attachment) => (
              <div
                className="message-box__attachment-preview message-box__attachment-preview--image"
                key={attachment.path}
                role="listitem"
              >
                <button
                  type="button"
                  className="message-box__attachment-open"
                  aria-label={`Open ${attachment.name}`}
                  title={`Open ${attachment.name}`}
                  onClick={() => handleOpenAttachment(attachment)}
                >
                  <img src={attachment.dataUrl} alt="" />
                </button>
                <Button
                  aria-label={`Remove ${attachment.name}`}
                  callback={() => handleRemoveAttachment(attachment.path)}
                  icon={<X aria-hidden="true" />}
                  size="small"
                  theme="secondary"
                  title={`Remove ${attachment.name}`}
                />
              </div>
            ))}
          </div>
        )}
        {(selectedFiles.length > 0 ||
          linkedChats.length > 0 ||
          selectedSkills.length > 0 ||
          selectedApps.length > 0 ||
          showSelectedReview) && (
          <div
            className="message-box__attachment-preview-group message-box__attachment-preview-group--other"
            aria-label="Selected context"
            role="list"
          >
            {linkedChats.map((linkedChat) => (
              <AttachmentChip
                key={linkedChat.operationId}
                className="message-box__linked-chat"
                callback={() =>
                  openLinkedChat?.({
                    providerId: linkedChat.providerId,
                    chatId: linkedChat.chatId,
                    name: linkedChat.name
                  })
                }
                callbackAriaLabel={`Open linked chat ${linkedChat.name}`}
                callbackDisabled={!openLinkedChat}
                callbackTitle={
                  linkedChat.status === 'loading'
                    ? `Summarizing ${linkedChat.name}…`
                    : linkedChat.status === 'failed'
                      ? (linkedChat.error ?? 'Unable to load the linked chat.')
                      : `Open ${linkedChat.name}`
                }
                disabledAppearance={linkedChat.status === 'failed'}
                icon={
                  linkedChat.status === 'loading' ? (
                    <LoaderCircle className="app-loading-spinner" aria-hidden="true" />
                  ) : (
                    <MessagesSquare aria-hidden="true" />
                  )
                }
                label={linkedChat.name}
                removeAriaLabel={
                  linkedChat.status === 'loading'
                    ? `Cancel linking ${linkedChat.name}`
                    : `Remove linked chat ${linkedChat.name}`
                }
                removeCallback={() => handleRemoveLinkedChat(linkedChat)}
                removeTitle={
                  linkedChat.status === 'loading' ? 'Cancel loading' : 'Remove linked chat'
                }
              />
            ))}
            {selectedSkills.map((skill, index) => {
              const disabledByCopilot =
                providerId === 'copilot' && index < selectedSkills.length - 1
              const skillTitle = disabledByCopilot
                ? copilotMultipleSkillsTooltip
                : [skill.displayName || skill.name, getSkillSummary(skill)]
                    .filter(Boolean)
                    .join(' · ')

              return (
                <AttachmentChip
                  key={skill.path}
                  callback={() => textareaRef.current?.focus({ preventScroll: true })}
                  callbackAriaLabel={`Selected skill ${skill.name}`}
                  callbackDisabled
                  callbackTitle={skillTitle}
                  disabledAppearance={disabledByCopilot}
                  icon={<Package aria-hidden="true" />}
                  label={skill.displayName || skill.name}
                  removeAriaLabel={`Remove ${skill.name} skill`}
                  removeCallback={() => handleRemoveSkill(skill.path)}
                  removeTitle={`Remove ${skill.name} skill`}
                  title={disabledByCopilot ? copilotMultipleSkillsTooltip : undefined}
                />
              )
            })}
            {selectedApps.map((app) => (
              <AttachmentChip
                key={app.id}
                callback={() => textareaRef.current?.focus({ preventScroll: true })}
                callbackAriaLabel={`Selected app ${app.name}`}
                callbackDisabled
                callbackTitle={app.description ? `${app.name} · ${app.description}` : app.name}
                icon={<Blocks aria-hidden="true" />}
                label={`$${app.name}`}
                removeAriaLabel={`Remove ${app.name} app`}
                removeCallback={() => handleRemoveApp(app.id)}
                removeTitle={`Remove ${app.name} app`}
              />
            ))}
            {selectedFiles.map((attachment) => (
              <AttachmentChip
                key={attachment.path}
                callback={() => handleOpenAttachment(attachment)}
                callbackAriaLabel={`Open ${attachment.name}`}
                callbackDisabled={!onOpenAttachment}
                callbackTitle={`Open ${attachment.name}`}
                icon={<SymbolsFileIcon fileName={attachment.name} autoAssign />}
                label={attachment.name}
                removeAriaLabel={`Remove ${attachment.name}`}
                removeCallback={() => handleRemoveAttachment(attachment.path)}
                removeTitle={`Remove ${attachment.name}`}
              />
            ))}
            {selectedReview && showSelectedReview && (
              <ReviewCommentsButton
                comments={selectedReview.comments}
                onOpenFileLink={onOpenFileLink}
                onRemove={() => onSelectedReviewChange?.(null)}
                projectCwd={projectCwd}
              />
            )}
          </div>
        )}
      </div>
    )
  )
})
