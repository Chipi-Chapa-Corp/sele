import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { ProviderActiveSendMode } from '../../../shared/provider'
import { restoreFailedComposerDraft } from '../composerDraft'
import { buildQuotedPrompt } from '../composerQuotes'
import { buildLinkedChatPrompt, getLinkedChatKey } from '../linkedChats'
import { captureMessageFlight } from '../motion/messageFlight'
import { maxSelectedAppCount, maxSelectedSkillCount } from './composerLimits'
import { getSelectedSkillInputs, isComposerCacheCurrent } from './mentionResults'
import { useComposerEditing } from './useComposerEditing'
import { noLinkedChats } from './useComposerLinkedChats'
import { useComposerMentions } from './useComposerMentions'

import type { MessageBoxProps } from '../components/MessageBox.types'
import type { useComposerAttachments } from './useComposerAttachments'
import type { useComposerDraftState } from './useComposerDraftState'
import type { useComposerLinkedChats } from './useComposerLinkedChats'

type ComposerSubmissionDependencies = {
  options: Pick<
    MessageBoxProps,
    | 'activePrimaryMode'
    | 'providerId'
    | 'cwd'
    | 'providerResourcesRevision'
    | 'selectedReview'
    | 'operationsDisabled'
    | 'providerUpdating'
    | 'pending'
    | 'active'
    | 'disabled'
    | 'draftScopeKey'
    | 'onSend'
    | 'onSelectedReviewChange'
  >
  draft: Pick<
    ReturnType<typeof useComposerDraftState>,
    | 'message'
    | 'selectedSkills'
    | 'selectedApps'
    | 'selectedQuotes'
    | 'setSelectedQuotes'
    | 'selectedAttachments'
    | 'setMessage'
    | 'setSelectedAttachments'
    | 'setSelectedSkills'
    | 'setSelectedApps'
    | 'setComposerDrafts'
  >
  linked: Pick<
    ReturnType<typeof useComposerLinkedChats>,
    'linkedChats' | 'linkedChatsBlockSend' | 'updateLinkedChats' | 'restoreLinkedChatsBeforeEdit'
  >
  attachments: Pick<ReturnType<typeof useComposerAttachments>, 'attachmentSelectionPending'>
  mentions: ReturnType<typeof useComposerMentions>
  editing: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  editingState: ReturnType<typeof useComposerEditing>
  editSessionIdRef: RefObject<string | null>
  setAttachmentSelectionError: Dispatch<SetStateAction<string | null>>
}

export function useComposerSubmission({
  options,
  draft,
  linked,
  attachments,
  mentions,
  editing,
  textareaRef,
  editingState,
  editSessionIdRef,
  setAttachmentSelectionError
}: ComposerSubmissionDependencies) {
  const {
    activePrimaryMode = 'queue',
    providerId,
    cwd = null,
    providerResourcesRevision = 0,
    selectedReview = null,
    operationsDisabled = false,
    providerUpdating = false,
    pending = false,
    active = false,
    disabled = false,
    draftScopeKey,
    onSend,
    onSelectedReviewChange
  } = options
  const {
    message,
    selectedSkills,
    selectedApps,
    selectedQuotes,
    setSelectedQuotes,
    selectedAttachments,
    setMessage,
    setSelectedAttachments,
    setSelectedSkills,
    setSelectedApps,
    setComposerDrafts
  } = draft
  const { linkedChats, linkedChatsBlockSend, updateLinkedChats, restoreLinkedChatsBeforeEdit } =
    linked
  const { attachmentSelectionPending } = attachments

  const submitMessage = (
    activeMode: ProviderActiveSendMode = activePrimaryMode,
    content: string = message
  ): void => {
    const nextMessage = content.trim()
    const typedSkillInputs = getSelectedSkillInputs(
      nextMessage,
      isComposerCacheCurrent(
        mentions.composerCache,
        providerId,
        cwd,
        mentions.composerSourceKey,
        providerResourcesRevision
      )
        ? mentions.composerCache.skills
        : []
    )
    const availableSkillInputs = Array.from(
      new Map(
        [
          ...selectedSkills.map((skill) => ({ name: skill.name, path: skill.path })),
          ...typedSkillInputs
        ].map((skill) => [skill.path, skill])
      ).values()
    ).slice(0, maxSelectedSkillCount)
    const selectedSkillInputs =
      providerId === 'copilot' ? availableSkillInputs.slice(-1) : availableSkillInputs
    const selectedAppInputs = selectedApps
      .map((app) => ({ id: app.id, name: app.name }))
      .slice(0, maxSelectedAppCount)
    const submittingReview = editing ? null : selectedReview
    if (
      (!nextMessage &&
        selectedAttachments.length === 0 &&
        selectedSkillInputs.length === 0 &&
        selectedAppInputs.length === 0 &&
        selectedQuotes.length === 0 &&
        linkedChats.length === 0 &&
        !submittingReview) ||
      operationsDisabled ||
      providerUpdating ||
      attachmentSelectionPending ||
      linkedChatsBlockSend ||
      pending ||
      (!active && disabled)
    ) {
      return
    }

    textareaRef.current?.focus({ preventScroll: true })

    const sendScope = draftScopeKey
    const sentLinkedChats = linkedChats
    const outgoingMessage = buildLinkedChatPrompt(
      sentLinkedChats.map((chat) => ({
        providerId: chat.providerId,
        chatId: chat.chatId,
        name: chat.name,
        summary: chat.summary ?? ''
      })),
      buildQuotedPrompt(selectedQuotes, nextMessage)
    )
    const restoreLinkedChats = (): void => {
      if (sentLinkedChats.length === 0) return
      updateLinkedChats(sendScope, (chats) => [
        ...sentLinkedChats.filter(
          (sent) => !chats.some((chat) => getLinkedChatKey(chat) === getLinkedChatKey(sent))
        ),
        ...chats
      ])
    }
    if (editing) {
      const previousDraft = {
        message: editingState.messageBeforeEditRef.current ?? '',
        attachments: editingState.attachmentsBeforeEditRef.current ?? [],
        skills: editingState.skillsBeforeEditRef.current ?? [],
        apps: editingState.appsBeforeEditRef.current ?? [],
        quotes: editingState.quotesBeforeEditRef.current ?? []
      }
      void Promise.resolve(
        onSend(
          outgoingMessage,
          undefined,
          selectedAttachments,
          undefined,
          selectedSkillInputs,
          selectedAppInputs
        )
      )
        .then((sent) => {
          if (!sent) return

          restoreLinkedChatsBeforeEdit()
          setMessage(previousDraft.message)
          setSelectedAttachments(previousDraft.attachments)
          setSelectedSkills(previousDraft.skills)
          setSelectedApps(previousDraft.apps)
          setSelectedQuotes(previousDraft.quotes)
          editSessionIdRef.current = null
          editingState.messageBeforeEditRef.current = null
          editingState.attachmentsBeforeEditRef.current = null
          editingState.skillsBeforeEditRef.current = null
          editingState.appsBeforeEditRef.current = null
          editingState.quotesBeforeEditRef.current = null
        })
        .catch((error: unknown) => {
          console.error('Unable to persist the cleared composer draft.', error)
        })
      return
    }

    const cancelFlight = captureMessageFlight(textareaRef.current, nextMessage, draftScopeKey)
    const restoreFailedSend = (): void => {
      cancelFlight()
      restoreLinkedChats()
      setComposerDrafts((drafts) =>
        restoreFailedComposerDraft(drafts, sendScope, {
          message: nextMessage,
          attachments: selectedAttachments,
          skills: selectedSkills,
          apps: selectedApps,
          quotes: selectedQuotes
        })
      )
    }
    setMessage('')
    setSelectedAttachments([])
    setSelectedSkills([])
    setSelectedApps([])
    setSelectedQuotes([])
    updateLinkedChats(sendScope, () => noLinkedChats)
    onSelectedReviewChange?.(null)
    setAttachmentSelectionError(null)
    void Promise.resolve()
      .then(() =>
        onSend(
          outgoingMessage,
          active ? activeMode : undefined,
          selectedAttachments,
          submittingReview,
          selectedSkillInputs,
          selectedAppInputs
        )
      )
      .then((sent) => {
        if (sent) return
        restoreFailedSend()
      })
      .catch((error: unknown) => {
        console.error('Unable to send the composer message.', error)
        restoreFailedSend()
      })
  }
  return { submitMessage }
}
