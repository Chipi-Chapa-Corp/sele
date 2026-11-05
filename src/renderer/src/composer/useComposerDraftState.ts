import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { AppSelectedAttachment } from '../../../shared/app'
import type { ProviderApp, ProviderSkill } from '../../../shared/provider'
import { getComposerDraft, getPromptDrafts, updateComposerDraft } from '../composerDraft'
import { useComposerDrafts } from '../useComposerDrafts'

type ComposerDraftStateDependencies = {
  editSession: {
    id: string
    content: string
    attachments: AppSelectedAttachment[]
    type?: 'message' | 'pending'
  } | null
  draftScopeKey: string
}

export function useComposerDraftState({
  editSession,
  draftScopeKey
}: ComposerDraftStateDependencies) {
  const { composerDrafts, setComposerDrafts, promptDraftsByScope, setPromptDraftsByScope } =
    useComposerDrafts(Boolean(editSession))

  const composerDraft = getComposerDraft(composerDrafts, draftScopeKey)

  const promptDrafts = getPromptDrafts(promptDraftsByScope, draftScopeKey)

  const message = composerDraft.message

  const selectedAttachments = composerDraft.attachments

  const selectedSkills = composerDraft.skills

  const selectedApps = composerDraft.apps

  const setMessage = useCallback<Dispatch<SetStateAction<string>>>(
    (action) => {
      setComposerDrafts((drafts) => updateComposerDraft(drafts, draftScopeKey, 'message', action))
    },
    [draftScopeKey]
  )

  const setSelectedAttachments = useCallback<Dispatch<SetStateAction<AppSelectedAttachment[]>>>(
    (action) => {
      setComposerDrafts((drafts) =>
        updateComposerDraft(drafts, draftScopeKey, 'attachments', action)
      )
    },
    [draftScopeKey]
  )

  const setSelectedSkills = useCallback<Dispatch<SetStateAction<ProviderSkill[]>>>(
    (action) => {
      setComposerDrafts((drafts) => updateComposerDraft(drafts, draftScopeKey, 'skills', action))
    },
    [draftScopeKey]
  )

  const setSelectedApps = useCallback<Dispatch<SetStateAction<ProviderApp[]>>>(
    (action) => {
      setComposerDrafts((drafts) => updateComposerDraft(drafts, draftScopeKey, 'apps', action))
    },
    [draftScopeKey]
  )
  return {
    setComposerDrafts,
    setPromptDraftsByScope,
    promptDrafts,
    message,
    selectedAttachments,
    selectedSkills,
    selectedApps,
    setMessage,
    setSelectedAttachments,
    setSelectedSkills,
    setSelectedApps
  }
}
