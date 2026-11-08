import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useEffect, useRef } from 'react'
import type { AppSelectedAttachment } from '../../../shared/app'
import type { ProviderApp, ProviderSkill } from '../../../shared/provider'
import { parseLinkedChatMessage, type ComposerLinkedChat } from '../linkedChats'
import type { ComposerQuote } from '../composerQuotes'

import type { MessageBoxProps } from '../components/MessageBox.types'
import type { useComposerDraftState } from './useComposerDraftState'
import type { useComposerLinkedChats } from './useComposerLinkedChats'

type ComposerEditingDependencies = {
  options: Pick<
    MessageBoxProps,
    'editSession' | 'draftScopeKey' | 'selectedReview' | 'onCancelEdit'
  >
  draft: Pick<
    ReturnType<typeof useComposerDraftState>,
    | 'message'
    | 'selectedAttachments'
    | 'selectedSkills'
    | 'selectedApps'
    | 'selectedQuotes'
    | 'setSelectedQuotes'
    | 'setMessage'
    | 'setSelectedAttachments'
    | 'setSelectedSkills'
    | 'setSelectedApps'
  >
  linked: Pick<
    ReturnType<typeof useComposerLinkedChats>,
    | 'restoreLinkedChatsBeforeEdit'
    | 'linkedChatsBeforeEditRef'
    | 'linkedChatsRef'
    | 'updateLinkedChats'
  >
  editSessionIdRef: RefObject<string | null>
  setAttachmentSelectionError: Dispatch<SetStateAction<string | null>>
  textareaRef: RefObject<HTMLTextAreaElement | null>
  editing: boolean
}

export function useComposerEditing({
  options,
  draft,
  linked,
  editSessionIdRef,
  setAttachmentSelectionError,
  textareaRef,
  editing
}: ComposerEditingDependencies) {
  const { editSession = null, draftScopeKey, selectedReview = null, onCancelEdit } = options
  const {
    message,
    selectedAttachments,
    selectedSkills,
    selectedApps,
    selectedQuotes,
    setSelectedQuotes,
    setMessage,
    setSelectedAttachments,
    setSelectedSkills,
    setSelectedApps
  } = draft
  const {
    restoreLinkedChatsBeforeEdit,
    linkedChatsBeforeEditRef,
    linkedChatsRef,
    updateLinkedChats
  } = linked

  const messageRef = useRef(message)

  const selectedAttachmentsRef = useRef(selectedAttachments)

  const selectedSkillsRef = useRef(selectedSkills)

  const selectedAppsRef = useRef(selectedApps)
  const selectedQuotesRef = useRef(selectedQuotes)
  const quotesBeforeEditRef = useRef<ComposerQuote[] | null>(null)

  const messageBeforeEditRef = useRef<string | null>(null)

  const attachmentsBeforeEditRef = useRef<AppSelectedAttachment[] | null>(null)

  const skillsBeforeEditRef = useRef<ProviderSkill[] | null>(null)

  const appsBeforeEditRef = useRef<ProviderApp[] | null>(null)

  useEffect(() => {
    messageRef.current = message
  }, [message])

  useEffect(() => {
    selectedAttachmentsRef.current = selectedAttachments
  }, [selectedAttachments])

  useEffect(() => {
    selectedSkillsRef.current = selectedSkills
  }, [selectedSkills])

  useEffect(() => {
    selectedAppsRef.current = selectedApps
  }, [selectedApps])
  useEffect(() => {
    selectedQuotesRef.current = selectedQuotes
  }, [selectedQuotes])

  useEffect(() => {
    if (!editSession) {
      editSessionIdRef.current = null
      messageBeforeEditRef.current = null
      attachmentsBeforeEditRef.current = null
      skillsBeforeEditRef.current = null
      appsBeforeEditRef.current = null
      quotesBeforeEditRef.current = null
      restoreLinkedChatsBeforeEdit()
      return
    }

    if (editSessionIdRef.current === editSession.id) return

    editSessionIdRef.current = editSession.id
    if (messageBeforeEditRef.current === null) {
      messageBeforeEditRef.current = messageRef.current
      attachmentsBeforeEditRef.current = selectedAttachmentsRef.current
      skillsBeforeEditRef.current = selectedSkillsRef.current
      appsBeforeEditRef.current = selectedAppsRef.current
      quotesBeforeEditRef.current = selectedQuotesRef.current
    }
    if (linkedChatsBeforeEditRef.current === null) {
      linkedChatsBeforeEditRef.current = { scope: draftScopeKey, chats: linkedChatsRef.current }
    }
    // The sent linked-chat section becomes chips again; saving rebuilds it from them.
    const editedMessage = parseLinkedChatMessage(editSession.content)
    updateLinkedChats(linkedChatsBeforeEditRef.current.scope, () =>
      editedMessage.linkedChats.map(
        (chat): ComposerLinkedChat => ({
          ...chat,
          operationId: crypto.randomUUID(),
          status: 'ready'
        })
      )
    )
    setMessage(editedMessage.content)
    setSelectedAttachments(editSession.attachments)
    setSelectedSkills([])
    setSelectedApps([])
    setSelectedQuotes([])
    setAttachmentSelectionError(null)

    const animationFrame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true })
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [
    draftScopeKey,
    editSession,
    restoreLinkedChatsBeforeEdit,
    setMessage,
    setSelectedApps,
    setSelectedAttachments,
    setSelectedSkills,
    setSelectedQuotes,
    updateLinkedChats
  ])

  useEffect(() => {
    if (!selectedReview || editing) return
    const frame = window.requestAnimationFrame(() =>
      textareaRef.current?.focus({ preventScroll: true })
    )
    return () => window.cancelAnimationFrame(frame)
  }, [editing, selectedReview])

  const handleCancelEdit = (): void => {
    restoreLinkedChatsBeforeEdit()
    setMessage(messageBeforeEditRef.current ?? '')
    setSelectedAttachments(attachmentsBeforeEditRef.current ?? [])
    setSelectedSkills(skillsBeforeEditRef.current ?? [])
    setSelectedApps(appsBeforeEditRef.current ?? [])
    setSelectedQuotes(quotesBeforeEditRef.current ?? [])
    editSessionIdRef.current = null
    messageBeforeEditRef.current = null
    attachmentsBeforeEditRef.current = null
    skillsBeforeEditRef.current = null
    appsBeforeEditRef.current = null
    quotesBeforeEditRef.current = null
    onCancelEdit?.()
  }
  return {
    messageBeforeEditRef,
    attachmentsBeforeEditRef,
    skillsBeforeEditRef,
    appsBeforeEditRef,
    quotesBeforeEditRef,
    handleCancelEdit
  }
}
