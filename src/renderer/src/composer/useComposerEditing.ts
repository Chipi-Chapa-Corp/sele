import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useEffect, useRef } from 'react'
import { parseLinkedChatMessage, type ComposerLinkedChat } from '../linkedChats'

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

  const currentDraft = {
    message,
    attachments: selectedAttachments,
    skills: selectedSkills,
    apps: selectedApps,
    quotes: selectedQuotes
  }
  const draftRef = useRef(currentDraft)
  const draftBeforeEditRef = useRef<typeof currentDraft | null>(null)

  useEffect(() => {
    draftRef.current = currentDraft
  })

  useEffect(() => {
    if (!editSession) {
      editSessionIdRef.current = null
      draftBeforeEditRef.current = null
      restoreLinkedChatsBeforeEdit()
      return
    }

    if (editSessionIdRef.current === editSession.id) return

    editSessionIdRef.current = editSession.id
    draftBeforeEditRef.current ??= draftRef.current
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

  const restoreDraftBeforeEdit = (previousDraft = draftBeforeEditRef.current): void => {
    restoreLinkedChatsBeforeEdit()
    setMessage(previousDraft?.message ?? '')
    setSelectedAttachments(previousDraft?.attachments ?? [])
    setSelectedSkills(previousDraft?.skills ?? [])
    setSelectedApps(previousDraft?.apps ?? [])
    setSelectedQuotes(previousDraft?.quotes ?? [])
    editSessionIdRef.current = null
    draftBeforeEditRef.current = null
  }

  const handleCancelEdit = (): void => {
    restoreDraftBeforeEdit()
    onCancelEdit?.()
  }
  return { draftBeforeEditRef, restoreDraftBeforeEdit, handleCancelEdit }
}
