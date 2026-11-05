import {
  ArrowUp,
  Check,
  Copy,
  CornerDownRight,
  GitFork,
  Pencil,
  Pin,
  PinOff,
  Square,
  Trash2
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import 'react-diff-view/style/index.css'
import type { ProviderChatItem, ProviderPendingMessage } from '../../../shared/provider'
import { getChatMessagePresentation } from '../chatMessageResources'
import { getMessageModelLabel } from '../messageModelLabel'
import { useMessageArrival } from '../motion/messageFlight'
import { formatSemanticLexicalDateDifference, useSemanticDateNow } from '../semanticDateDifference'
import { Button } from './Button'
import './ChatDetailItem.css'
import type { ChatDetailItemProps } from './ChatDetailItem.types'
import { isQueuedPendingMessage } from './chatDetailItemMemo'
import { MarkdownMessage } from './MarkdownMessage'
import { MessageAttachments } from './MessageAttachments'
import './UnifiedDiff.css'

const copyTextToClipboard = async (content: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content)
    return
  }

  const textArea = document.createElement('textarea')
  textArea.value = content
  textArea.readOnly = true
  textArea.inputMode = 'none'
  textArea.setAttribute('aria-hidden', 'true')
  textArea.style.position = 'fixed'
  textArea.style.inset = '0 auto auto 0'
  textArea.style.opacity = '0'
  document.body.append(textArea)
  textArea.focus()
  textArea.select()

  try {
    if (!document.execCommand('copy')) throw new Error('Unable to copy message')
  } finally {
    textArea.remove()
  }
}

const MessageDate: React.FC<{
  timestamp: number | null | undefined
  markerSide: 'left' | 'right'
  modelLabel?: string | null
}> = ({ timestamp, markerSide, modelLabel }) => {
  const now = useSemanticDateNow()
  const timestampLabel = formatSemanticLexicalDateDifference(timestamp, { now })

  if (!timestampLabel) {
    return <span className="chat-detail__message-date chat-detail__message-date--empty" />
  }

  const title = modelLabel ? `${timestampLabel.title} · ${modelLabel}` : timestampLabel.title

  return (
    <time className="chat-detail__message-date" dateTime={timestampLabel.dateTime} title={title}>
      {markerSide === 'left' && (
        <span className="chat-detail__message-date-marker" aria-hidden="true">
          ·
        </span>
      )}
      <span>{timestampLabel.label}</span>
      {modelLabel && (
        <>
          <span className="chat-detail__message-date-marker" aria-hidden="true">
            ·
          </span>
          <span>{modelLabel}</span>
        </>
      )}
      {markerSide === 'right' && (
        <span className="chat-detail__message-date-marker" aria-hidden="true">
          ·
        </span>
      )}
    </time>
  )
}

const getPendingMessageLabel = (message: ProviderPendingMessage): string =>
  message.kind === 'steering' ? 'Steering' : 'Queue'

const getPendingMessageActionLabel = (message: ProviderPendingMessage): string =>
  message.kind === 'steering' ? 'steering' : 'queued'
type ChatMessageProps = Pick<
  ChatDetailItemProps,
  | 'motionChatKey'
  | 'canEditOwnMessages'
  | 'markdownBaseUrl'
  | 'messageBubble'
  | 'container'
  | 'messagePinned'
  | 'pendingMessageLabel'
  | 'pendingMessageDeleteDisabled'
  | 'modelLabelsById'
  | 'resolvedModelIdsById'
  | 'onDeletePendingMessage'
  | 'onEditPendingMessage'
  | 'onSteerPendingMessage'
  | 'onInterruptPendingMessage'
  | 'onEditMessage'
  | 'onForkMessage'
  | 'onOpenFileLink'
  | 'onToggleMessagePinned'
  | 'previousItem'
  | 'cwd'
  | 'projectCwd'
  | 'selectedModelId'
  | 'streaming'
  | 'turnIndex'
> & { item: Extract<ProviderChatItem, { type: 'message' | 'pendingMessage' }> }

export const ChatMessage = ({
  motionChatKey,
  canEditOwnMessages = false,
  markdownBaseUrl,
  messageBubble = false,
  container,
  item,
  messagePinned = false,
  pendingMessageLabel,
  pendingMessageDeleteDisabled = false,
  modelLabelsById,
  resolvedModelIdsById,
  onDeletePendingMessage,
  onEditPendingMessage,
  onSteerPendingMessage,
  onInterruptPendingMessage,
  onEditMessage,
  onForkMessage,
  onOpenFileLink,
  onToggleMessagePinned,
  previousItem,
  cwd,
  projectCwd,
  selectedModelId,
  streaming = false,
  turnIndex = -1
}: ChatMessageProps): React.ReactNode => {
  const messageRef = useRef<HTMLDivElement>(null)

  useMessageArrival(
    messageRef,
    item.type === 'pendingMessage' || (item.type === 'message' && item.role === 'user')
      ? item
      : null,
    motionChatKey
  )

  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return undefined

    const timeout = window.setTimeout(() => setCopied(false), 1_200)
    return () => window.clearTimeout(timeout)
  }, [copied])

  const pending = item.type === 'pendingMessage'

  const role = pending ? 'user' : item.role

  const messageLabel =
    pending && pendingMessageLabel !== undefined
      ? pendingMessageLabel
      : pending && item.kind === 'queued' && isQueuedPendingMessage(previousItem)
        ? null
        : pending
          ? getPendingMessageLabel(item)
          : (item.label ?? null)

  const pendingActionLabel = pending ? getPendingMessageActionLabel(item) : 'pending'

  const canEdit =
    !pending &&
    role === 'user' &&
    item.editTargetId !== null &&
    canEditOwnMessages &&
    Boolean(onEditMessage)

  const canEditPending = pending && Boolean(onEditPendingMessage) && item.editable !== false

  const canDelete = pending && Boolean(onDeletePendingMessage)

  const canSteer = pending && item.kind === 'queued' && Boolean(onSteerPendingMessage)

  const canInterrupt = pending && Boolean(onInterruptPendingMessage)

  const canPinMessage =
    !pending &&
    Boolean(item.content.trim()) &&
    Boolean(onToggleMessagePinned) &&
    turnIndex >= 0 &&
    (role === 'user' || !streaming)

  const canForkMessage = !pending && role === 'assistant' && !streaming && Boolean(onForkMessage)

  const timestamp = item.createdAt

  const modelLabel = pending
    ? null
    : getMessageModelLabel(item, selectedModelId, modelLabelsById, resolvedModelIdsById)

  const attachments = item.attachments ?? []

  const messagePresentation =
    role === 'user' && !markdownBaseUrl
      ? getChatMessagePresentation(item.content)
      : { content: item.content, resources: [] }

  const handleCopyMessage = async (): Promise<void> => {
    await copyTextToClipboard(item.content)
    setCopied(true)
  }

  const messageActions = (
    <span className="chat-detail__message-actions">
      {canEdit && (
        <Button
          theme="secondary"
          size="small"
          aria-label="Edit message"
          title="Edit message"
          callback={() => {
            if (item.type === 'message') onEditMessage?.(item)
          }}
          icon={<Pencil aria-hidden="true" />}
        />
      )}
      {canEditPending && pending && (
        <Button
          theme="secondary"
          size="small"
          aria-label={`Edit ${pendingActionLabel} message`}
          title={`Edit ${pendingActionLabel} message`}
          callback={() => onEditPendingMessage?.(item)}
          icon={<Pencil aria-hidden="true" />}
        />
      )}
      {canSteer && pending && (
        <Button
          theme="secondary"
          size="small"
          aria-label="Steer with queued message"
          title="Steer with queued message"
          callback={() => onSteerPendingMessage?.(item)}
          icon={<CornerDownRight aria-hidden="true" />}
        />
      )}
      {canInterrupt && pending && (
        <Button
          theme="secondary"
          size="small"
          aria-label={`Send ${pendingActionLabel} message now`}
          title={`Send ${pendingActionLabel} message now`}
          callback={() => onInterruptPendingMessage?.(item)}
          icon={
            item.kind === 'queued' ? <ArrowUp aria-hidden="true" /> : <Square aria-hidden="true" />
          }
        />
      )}
      {canDelete && pending && (
        <Button
          theme="secondary"
          size="small"
          disabled={pendingMessageDeleteDisabled}
          aria-label={`Delete ${pendingActionLabel} message`}
          title={`Delete ${pendingActionLabel} message`}
          callback={() => onDeletePendingMessage?.(item)}
          icon={<Trash2 aria-hidden="true" />}
        />
      )}
      {canForkMessage && !pending && (
        <Button
          theme="secondary"
          size="small"
          aria-label="Fork chat from message"
          title="Fork"
          callback={() => onForkMessage?.(item)}
          icon={<GitFork aria-hidden="true" />}
        />
      )}
      {canPinMessage && !pending && (
        <Button
          theme="secondary"
          size="small"
          aria-label={messagePinned ? 'Unpin message' : 'Pin message'}
          aria-pressed={messagePinned}
          title={messagePinned ? 'Unpin message' : 'Pin message'}
          callback={() => onToggleMessagePinned?.(item, turnIndex, messagePinned)}
          icon={messagePinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
        />
      )}
      <Button
        theme="secondary"
        size="small"
        aria-label={copied ? 'Copied message' : 'Copy message'}
        title={copied ? 'Copied' : 'Copy message'}
        callback={handleCopyMessage}
        icon={copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      />
    </span>
  )

  const messageDate = (
    <MessageDate
      markerSide={role === 'user' ? 'right' : 'left'}
      modelLabel={modelLabel}
      timestamp={timestamp}
    />
  )

  const messageBlockClassName = [
    'chat-detail__message-block',
    `chat-detail__message-block--${role}`,
    pending ? 'chat-detail__message-block--pending' : null,
    pending ? `chat-detail__message-block--pending-${item.kind}` : null
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={messageRef}
      className={messageBlockClassName}
      data-motion-message-id={item.id}
      data-chat-message-id={!pending ? item.id : undefined}
    >
      {messageLabel && <span className="chat-detail__pending-message-label">{messageLabel}</span>}
      {(attachments.length > 0 || messagePresentation.resources.length > 0) && (
        <MessageAttachments
          attachments={attachments}
          onOpenFileLink={onOpenFileLink}
          projectCwd={projectCwd}
          resources={messagePresentation.resources}
        />
      )}
      {messagePresentation.content.trim() && (
        <MarkdownMessage
          className={`chat-detail__message chat-detail__message--${role}${messageBubble ? ' chat-detail__message--bubble' : ''}`}
          content={messagePresentation.content}
          baseUrl={markdownBaseUrl}
          localImageContainer={container}
          localImageCwd={cwd}
          onOpenFileLink={onOpenFileLink}
          preserveLineBreaks={role === 'user' && !markdownBaseUrl}
          selectionQuoteHost={!pending && role === 'assistant'}
          streaming={!pending && role === 'assistant' && streaming}
        />
      )}
      {item.payloadTruncated && (
        <span className="chat-detail__payload-preview-note">
          Showing a bounded preview of this large message.
        </span>
      )}
      <div className="chat-detail__message-footer">
        {/* Streamed text may still be demoted into the working step, so it gets no finished-message chrome. */}
        {role === 'user' && messageDate}
        {!streaming && messageActions}
        {!streaming && role === 'assistant' && messageDate}
      </div>
    </div>
  )
}
