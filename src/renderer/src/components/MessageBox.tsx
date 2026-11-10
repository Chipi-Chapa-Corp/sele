import { ComposerImageLightbox } from '../composer/ComposerImageLightbox'
import { MessagesSquare, Paperclip, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ComposerAttachments } from '../composer/ComposerAttachments'
import { ComposerTextInput } from '../composer/ComposerTextInput'
import { ComposerToolbar } from '../composer/ComposerToolbar'
import { useComposerAttachments } from '../composer/useComposerAttachments'
import { useComposerDraftState } from '../composer/useComposerDraftState'
import { useComposerEditing } from '../composer/useComposerEditing'
import { useComposerKeyboard } from '../composer/useComposerKeyboard'
import { useComposerLinkedChats } from '../composer/useComposerLinkedChats'
import { useComposerMentions } from '../composer/useComposerMentions'
import { useComposerSubmission } from '../composer/useComposerSubmission'
import { useComposerFocus } from '../useComposerFocus'
import { Button } from './Button'
import './MessageBox.css'

import type { MessageBoxProps } from './MessageBox.types'
export type { MessageBoxQuoteRequest } from './MessageBox.types'

export const MessageBox: React.FC<MessageBoxProps> = (props) => {
  const {
    active = false,
    activePrimaryMode = 'queue',
    autoFocus = false,
    draftScopeKey,
    disabled = false,
    editSession = null,
    error = null,
    promptSuggestion = null,
    operationsDisabled = false,
    pending = false,
    providerId,
    providerUpdating = false,
    projectCwd,
    quoteRequest = null,
    selectedReview = null,
    onOpenAttachment,
    onOpenFileLink,
    onQuoteRequestHandled,
    onSelectedReviewChange,
    onStop
  } = props
  const draft = useComposerDraftState({ editSession, draftScopeKey })
  const [attachmentSelectionError, setAttachmentSelectionError] = useState<string | null>(null)
  const [dismissedPromptSuggestions, setDismissedPromptSuggestions] = useState<Map<string, string>>(
    () => new Map()
  )
  const dismissPromptSuggestion = (): void => {
    if (!promptSuggestion || dismissedPromptSuggestions.get(draftScopeKey) === promptSuggestion.id)
      return
    setDismissedPromptSuggestions((current) => {
      const next = new Map(current)
      next.delete(draftScopeKey)
      next.set(draftScopeKey, promptSuggestion.id)
      if (next.size > 100) next.delete(next.keys().next().value!)
      return next
    })
  }
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const editSessionIdRef = useRef<string | null>(null)
  const handledQuoteRequestIdRef = useRef<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useComposerFocus(textareaRef, draftScopeKey, autoFocus)
  const editing = Boolean(editSession)
  const linked = useComposerLinkedChats({
    options: props,
    setAttachmentSelectionError: setAttachmentSelectionError,
    textareaRef: textareaRef
  })
  const attachments = useComposerAttachments({
    options: props,
    draft: draft,
    linked: linked,
    setAttachmentSelectionError: setAttachmentSelectionError,
    editSessionIdRef: editSessionIdRef,
    textareaRef: textareaRef
  })
  const mentions = useComposerMentions({
    options: props,
    draft: draft,
    textareaRef: textareaRef,
    editing: editing,
    setAttachmentSelectionError: setAttachmentSelectionError
  })
  const editingState = useComposerEditing({
    options: props,
    draft: draft,
    linked: linked,
    editSessionIdRef: editSessionIdRef,
    setAttachmentSelectionError: setAttachmentSelectionError,
    textareaRef: textareaRef,
    editing: editing
  })

  const visiblePromptSuggestion =
    promptSuggestion?.text &&
    !draft.message &&
    !active &&
    !pending &&
    !disabled &&
    !operationsDisabled &&
    !providerUpdating &&
    !editSession &&
    !selectedReview &&
    draft.selectedAttachments.length === 0 &&
    draft.selectedSkills.length === 0 &&
    draft.selectedApps.length === 0 &&
    draft.selectedQuotes.length === 0 &&
    linked.linkedChats.length === 0 &&
    !mentions.mentionMenuOpen &&
    dismissedPromptSuggestions.get(draftScopeKey) !== promptSuggestion.id
      ? promptSuggestion
      : null

  useEffect(() => {
    let active = true

    queueMicrotask(() => {
      if (active) setDismissedError(null)
    })

    return () => {
      active = false
    }
  }, [error])

  useEffect(() => {
    if (
      !quoteRequest ||
      quoteRequest.scopeKey !== draftScopeKey ||
      editing ||
      handledQuoteRequestIdRef.current === quoteRequest.id
    ) {
      return
    }

    const content = quoteRequest.content.trim()
    const comment = quoteRequest.comment.trim()
    if (!content || !comment) return

    const updateFrame = window.requestAnimationFrame(() => {
      handledQuoteRequestIdRef.current = quoteRequest.id
      draft.setSelectedQuotes((quotes) => [
        ...quotes,
        { id: crypto.randomUUID(), content, comment }
      ])
      onQuoteRequestHandled?.(quoteRequest.id)
      mentions.setFileMention(null)
      mentions.setSkillMention(null)
      mentions.setProjectMention(null)

      const textarea = textareaRef.current
      if (!textarea) return

      textarea.focus({ preventScroll: true })
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    })

    return () => {
      window.cancelAnimationFrame(updateFrame)
    }
  }, [editing, quoteRequest, draftScopeKey, draft.setSelectedQuotes, onQuoteRequestHandled])
  const sending = useComposerSubmission({
    options: props,
    draft: draft,
    linked: linked,
    attachments: attachments,
    mentions: mentions,
    editing: editing,
    textareaRef: textareaRef,
    editingState: editingState,
    editSessionIdRef: editSessionIdRef,
    setAttachmentSelectionError: setAttachmentSelectionError
  })

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    sending.submitMessage()
  }

  const handleStop = (): void => {
    if (!onStop) return
    void onStop()
  }
  const keyboard = useComposerKeyboard({
    options: props,
    draft: draft,
    visiblePromptSuggestion: visiblePromptSuggestion,
    dismissPromptSuggestion: dismissPromptSuggestion,
    submitMessage: sending.submitMessage,
    mentions: mentions,
    editing: editing,
    textareaRef: textareaRef
  })

  const handleMessageChange = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const nextMessage = event.currentTarget.value
    dismissPromptSuggestion()
    draft.setMessage(nextMessage)
    mentions.updateMessageMentions(event.currentTarget)
    mentions.setActiveFileMentionIndex(0)
    mentions.setActiveSkillMentionIndex(0)
    mentions.setActiveProjectMentionIndex(0)
  }
  const linkedChatError = linked.failedLinkedChat
    ? `${linked.failedLinkedChat.name}: ${linked.failedLinkedChat.error ?? 'Unable to load the linked chat.'}`
    : null
  const messageBoxError =
    attachmentSelectionError ??
    linkedChatError ??
    (error && error !== dismissedError ? error : null)
  const messageBoxErrorLabel = attachmentSelectionError
    ? 'Attachment failed'
    : linkedChatError
      ? 'Linked chat failed'
      : 'Request failed'

  const handleDismissMessageBoxError = (): void => {
    if (attachmentSelectionError) {
      setAttachmentSelectionError(null)
      return
    }
    if (linked.failedLinkedChat) {
      linked.handleRemoveLinkedChat(linked.failedLinkedChat)
      return
    }

    if (error) setDismissedError(error)
  }

  return (
    <form className="message-box" aria-busy={pending} onSubmit={handleSubmit}>
      {messageBoxError && (
        <div className="message-box__error" role="alert">
          <div className="message-box__error-main">
            <span className="message-box__error-label">{messageBoxErrorLabel}</span>
            <span className="message-box__error-summary">{messageBoxError}</span>
          </div>
          <div className="message-box__error-actions">
            <Button
              aria-label="Dismiss error"
              title="Dismiss error"
              callback={handleDismissMessageBoxError}
              icon={<X aria-hidden="true" />}
              size="small"
              theme="transparent"
            />
          </div>
        </div>
      )}
      <label className="sr-only" htmlFor="message-input">
        Message
      </label>

      <div
        className="message-box__input"
        onDragEnter={attachments.handleAttachmentDragEnter}
        onDragLeave={attachments.handleAttachmentDragLeave}
        onDragOver={attachments.handleAttachmentDragOver}
        onDrop={(event) => void attachments.handleAttachmentDrop(event)}
      >
        {attachments.attachmentDragActive && (
          <div className="message-box__attachment-drop-target" aria-hidden="true">
            {attachments.attachmentDragKind === 'chat' ? <MessagesSquare /> : <Paperclip />}
            <span>
              {attachments.attachmentDragKind === 'chat'
                ? 'Drop chat to attach'
                : 'Drop files to attach'}
            </span>
          </div>
        )}
        <ComposerAttachments
          selectedAttachments={draft.selectedAttachments}
          linkedChats={linked.linkedChats}
          selectedSkills={draft.selectedSkills}
          selectedApps={draft.selectedApps}
          selectedQuotes={draft.selectedQuotes}
          handleChangeQuote={(id, comment) =>
            draft.setSelectedQuotes((quotes) =>
              quotes.map((quote) => (quote.id === id ? { ...quote, comment } : quote))
            )
          }
          handleRemoveQuote={(id) =>
            draft.setSelectedQuotes((quotes) => quotes.filter((quote) => quote.id !== id))
          }
          handleOpenAttachment={attachments.handleOpenAttachment}
          handleRemoveAttachment={attachments.handleRemoveAttachment}
          handleRemoveLinkedChat={linked.handleRemoveLinkedChat}
          providerId={providerId}
          textareaRef={textareaRef}
          handleRemoveSkill={attachments.handleRemoveSkill}
          handleRemoveApp={attachments.handleRemoveApp}
          onOpenAttachment={onOpenAttachment}
          selectedReview={selectedReview}
          onOpenFileLink={onOpenFileLink}
          onSelectedReviewChange={onSelectedReviewChange}
          projectCwd={projectCwd}
          editing={editing}
        />
        <ComposerTextInput
          mentions={mentions}
          autoFocus={autoFocus}
          draftScopeKey={draftScopeKey}
          draft={draft}
          visiblePromptSuggestion={visiblePromptSuggestion}
          dismissPromptSuggestion={dismissPromptSuggestion}
          textareaRef={textareaRef}
          sending={sending}
          activePrimaryMode={activePrimaryMode}
          handleMessageChange={handleMessageChange}
          keyboard={keyboard}
          attachments={attachments}
        />
        <ComposerToolbar
          settings={props}
          selectedAttachments={draft.selectedAttachments}
          handleSelectAttachments={attachments.handleSelectAttachments}
          editing={editing}
          handleCancelEdit={editingState.handleCancelEdit}
          promptDrafts={draft.promptDrafts}
          handlePopPromptDraft={keyboard.handlePopPromptDraft}
          handleRemovePromptDraft={keyboard.handleRemovePromptDraft}
          attachmentSelectionPending={attachments.attachmentSelectionPending}
          linkedChatsBlockSend={linked.linkedChatsBlockSend}
          submitMessage={sending.submitMessage}
          handleStop={handleStop}
          controlPressed={keyboard.controlPressed}
          message={draft.message}
          hasQuotes={draft.selectedQuotes.length > 0}
          linkedChats={linked.linkedChats}
          selectedSkills={draft.selectedSkills}
          selectedApps={draft.selectedApps}
        />
      </div>
      {attachments.openedImage && (
        <ComposerImageLightbox
          key={attachments.openedImage.path}
          image={attachments.openedImage}
          tool={attachments.annotationTool}
          onToolChange={attachments.setAnnotationTool}
          position={attachments.openedImagePosition}
          count={attachments.imageCount}
          annotationStartNumber={attachments.annotationStartNumber}
          onPrevious={attachments.handlePreviousImage}
          onNext={attachments.handleNextImage}
          onSave={attachments.handleSaveOpenedImage}
          onClose={() => attachments.setOpenedImage(null)}
        />
      )}
    </form>
  )
}
