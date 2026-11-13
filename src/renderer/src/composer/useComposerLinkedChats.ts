import type { RefObject } from 'react'
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  defaultLinkedChatSummaryPrompt,
  getLinkedChatKey,
  maxLinkedChatCount,
  type ComposerLinkedChat,
  type LinkedChatReference
} from '../linkedChats'
import { providerApi } from '../providerApi'
import { getErrorMessage } from '../workspace/chatControllerUtils'

export const noLinkedChats: ComposerLinkedChat[] = []

import type { MessageBoxProps } from '../components/MessageBox.types'

type ComposerLinkedChatsDependencies = {
  options: Pick<
    MessageBoxProps,
    'draftScopeKey' | 'providerId' | 'chatId' | 'linkedChatSummaryPrompt'
  >
  setAttachmentSelectionError: Dispatch<SetStateAction<string | null>>
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

export function useComposerLinkedChats({
  options,
  setAttachmentSelectionError,
  textareaRef
}: ComposerLinkedChatsDependencies) {
  const { draftScopeKey, providerId, chatId, linkedChatSummaryPrompt } = options

  // Linked chats are summarized live and are not persisted with drafts.
  const [linkedChatsByScope, setLinkedChatsByScope] = useState<
    Record<string, ComposerLinkedChat[]>
  >({})

  const loadingLinkedChatOperationsRef = useRef(new Set<string>())

  // The composer's own linked chats, set aside while a sent message is edited in their place.
  const linkedChatsBeforeEditRef = useRef<{ scope: string; chats: ComposerLinkedChat[] } | null>(
    null
  )

  const linkedChats = linkedChatsByScope[draftScopeKey] ?? noLinkedChats

  const linkedChatsRef = useRef(linkedChats)

  const linkedChatsByScopeRef = useRef(linkedChatsByScope)

  const linkedChatsLoading = linkedChats.some((chat) => chat.status === 'loading')

  const failedLinkedChat = linkedChats.find((chat) => chat.status === 'failed')

  const linkedChatsBlockSend = linkedChatsLoading || Boolean(failedLinkedChat)

  const updateLinkedChats = useCallback(
    (scope: string, update: (chats: ComposerLinkedChat[]) => ComposerLinkedChat[]): void => {
      setLinkedChatsByScope((current) => {
        const next = update(current[scope] ?? noLinkedChats)
        if (next === current[scope]) return current
        const nextByScope = { ...current }
        if (next.length > 0) nextByScope[scope] = next
        else delete nextByScope[scope]
        return nextByScope
      })
    },
    []
  )

  // Leaving the composer abandons unfinished summaries; their hidden forks stop as well.
  useEffect(() => {
    const operations = loadingLinkedChatOperationsRef.current
    return () => {
      for (const operationId of operations) {
        void providerApi.cancelLinkedChatContext(operationId).catch((error: unknown) => {
          console.error('Unable to cancel linked chat preparation.', error)
        })
      }
      operations.clear()
    }
  }, [])

  const handleLinkChat = (reference: LinkedChatReference): void => {
    const scope = draftScopeKey
    if (reference.providerId === providerId && reference.chatId === chatId) {
      setAttachmentSelectionError('A chat cannot be linked to itself.')
      return
    }
    if (linkedChats.some((chat) => getLinkedChatKey(chat) === getLinkedChatKey(reference))) {
      textareaRef.current?.focus({ preventScroll: true })
      return
    }
    if (linkedChats.length >= maxLinkedChatCount) {
      setAttachmentSelectionError(`Link up to ${maxLinkedChatCount} chats per message.`)
      return
    }

    const operationId = crypto.randomUUID()
    const settle = (patch: Partial<ComposerLinkedChat>): void => {
      loadingLinkedChatOperationsRef.current.delete(operationId)
      updateLinkedChats(scope, (chats) =>
        chats.some((chat) => chat.operationId === operationId)
          ? chats.map((chat) => (chat.operationId === operationId ? { ...chat, ...patch } : chat))
          : chats
      )
    }
    loadingLinkedChatOperationsRef.current.add(operationId)
    setAttachmentSelectionError(null)
    updateLinkedChats(scope, (chats) => [
      ...chats,
      { ...reference, operationId, status: 'loading' }
    ])
    textareaRef.current?.focus({ preventScroll: true })
    void providerApi
      .prepareLinkedChatContext(reference.providerId, reference.chatId, {
        operationId,
        summaryPrompt: linkedChatSummaryPrompt?.trim() || defaultLinkedChatSummaryPrompt
      })
      .then((context) => {
        // Null means the chip was removed (and the preparation cancelled) meanwhile.
        if (!context) {
          loadingLinkedChatOperationsRef.current.delete(operationId)
          return
        }
        settle({ status: 'ready', summary: context.summary })
      })
      .catch((linkError: unknown) => {
        console.error('Unable to prepare the linked chat.', linkError)
        settle({
          status: 'failed',
          error: getErrorMessage(linkError, 'Unable to load the linked chat.')
        })
      })
  }

  /** Ends an edit's linked chats: unfinished ones stop, and the saved draft chats return. */
  const restoreLinkedChatsBeforeEdit = useCallback((): void => {
    const saved = linkedChatsBeforeEditRef.current
    if (!saved) return
    linkedChatsBeforeEditRef.current = null
    const keptOperations = new Set(saved.chats.map((chat) => chat.operationId))
    for (const chat of linkedChatsByScopeRef.current[saved.scope] ?? noLinkedChats) {
      if (
        !keptOperations.has(chat.operationId) &&
        loadingLinkedChatOperationsRef.current.delete(chat.operationId)
      ) {
        void providerApi.cancelLinkedChatContext(chat.operationId).catch((error: unknown) => {
          console.error('Unable to cancel linked chat preparation.', error)
        })
      }
    }
    updateLinkedChats(saved.scope, () => saved.chats)
  }, [updateLinkedChats])

  const handleRemoveLinkedChat = (linkedChat: ComposerLinkedChat): void => {
    if (loadingLinkedChatOperationsRef.current.delete(linkedChat.operationId)) {
      void providerApi.cancelLinkedChatContext(linkedChat.operationId).catch((error: unknown) => {
        console.error('Unable to cancel linked chat preparation.', error)
      })
    }
    updateLinkedChats(draftScopeKey, (chats) =>
      chats.filter((chat) => chat.operationId !== linkedChat.operationId)
    )
    textareaRef.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    linkedChatsRef.current = linkedChats
    linkedChatsByScopeRef.current = linkedChatsByScope
  }, [linkedChats, linkedChatsByScope])
  return {
    linkedChatsBeforeEditRef,
    linkedChats,
    linkedChatsRef,
    failedLinkedChat,
    linkedChatsBlockSend,
    updateLinkedChats,
    handleLinkChat,
    restoreLinkedChatsBeforeEdit,
    handleRemoveLinkedChat
  }
}
