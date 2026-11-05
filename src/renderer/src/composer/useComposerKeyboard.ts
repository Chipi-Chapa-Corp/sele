import type { RefObject } from 'react'
import { useEffect, useState } from 'react'
import type { ProviderActiveSendMode, ProviderPromptSuggestion } from '../../../shared/provider'
import {
  addPromptDraft,
  appendPromptDraft,
  removePromptDraft,
  type PromptDraft
} from '../composerDraft'
import { getModifiedActiveSendMode } from '../messageSendMode'
import { restoreAncestorScrollAfterNativeNavigation } from './nativeNavigation'
import { useComposerMentions } from './useComposerMentions'

import type { MessageBoxProps } from '../components/MessageBox.types'
import type { useComposerDraftState } from './useComposerDraftState'

type ComposerKeyboardDependencies = {
  options: Pick<
    MessageBoxProps,
    'activePrimaryMode' | 'draftScopeKey' | 'active' | 'activeSteeringEnabled'
  >
  draft: Pick<
    ReturnType<typeof useComposerDraftState>,
    'setMessage' | 'message' | 'setPromptDraftsByScope'
  >
  visiblePromptSuggestion: ProviderPromptSuggestion | null
  dismissPromptSuggestion: () => void
  submitMessage: (activeMode?: ProviderActiveSendMode, content?: string) => void
  mentions: ReturnType<typeof useComposerMentions>
  editing: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

export function useComposerKeyboard({
  options,
  draft,
  visiblePromptSuggestion,
  dismissPromptSuggestion,
  submitMessage,
  mentions,
  editing,
  textareaRef
}: ComposerKeyboardDependencies) {
  const {
    activePrimaryMode = 'queue',
    draftScopeKey,
    active = false,
    activeSteeringEnabled = true
  } = options
  const { setMessage, message, setPromptDraftsByScope } = draft

  const [controlPressed, setControlPressed] = useState(false)

  useEffect(() => {
    let pressed = false
    const updateControlPressed = (next: boolean): void => {
      if (pressed === next) return
      pressed = next
      setControlPressed(next)
    }
    const handleControlChange = (event: KeyboardEvent): void => {
      updateControlPressed(event.ctrlKey)
    }
    const handleWindowBlur = (): void => updateControlPressed(false)

    window.addEventListener('keydown', handleControlChange)
    window.addEventListener('keyup', handleControlChange)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('keydown', handleControlChange)
      window.removeEventListener('keyup', handleControlChange)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [])

  const handleMessageKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (
      visiblePromptSuggestion &&
      !event.nativeEvent.isComposing &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      if (event.key === 'Tab') {
        event.preventDefault()
        dismissPromptSuggestion()
        setMessage(visiblePromptSuggestion.text)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        dismissPromptSuggestion()
        submitMessage(activePrimaryMode, visiblePromptSuggestion.text)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        dismissPromptSuggestion()
        return
      }
    }
    if (mentions.projectMentionMenuOpen && !event.nativeEvent.isComposing) {
      if (event.key === 'Escape') {
        event.preventDefault()
        mentions.setProjectMention(null)
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (mentions.projectMentionResults.length === 0) return
        const direction = event.key === 'ArrowDown' ? 1 : -1
        mentions.setActiveProjectMentionIndex(
          (index) =>
            (index + direction + mentions.projectMentionResults.length) %
            mentions.projectMentionResults.length
        )
        return
      }
      if (
        event.key === 'Enter' ||
        (event.key === 'Tab' && mentions.projectMentionResults.length > 0)
      ) {
        event.preventDefault()
        const project =
          mentions.projectMentionResults[
            Math.min(mentions.activeProjectMentionIndex, mentions.projectMentionResults.length - 1)
          ]
        if (project) mentions.handleSelectProjectMention(project)
        return
      }
    }
    if (mentions.skillMentionMenuOpen && !event.nativeEvent.isComposing) {
      if (event.key === 'Escape') {
        event.preventDefault()
        mentions.setSkillMention(null)
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (mentions.composerResults.length === 0) return

        const direction = event.key === 'ArrowDown' ? 1 : -1
        mentions.setActiveSkillMentionIndex(
          (currentIndex) =>
            (currentIndex + direction + mentions.composerResults.length) %
            mentions.composerResults.length
        )
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        const selectedResult =
          mentions.composerResults[
            Math.min(mentions.activeSkillMentionIndex, mentions.composerResults.length - 1)
          ]
        if (selectedResult) mentions.handleSelectComposerMention(selectedResult)
        return
      }

      if (event.key === 'Tab' && mentions.composerResults.length > 0) {
        event.preventDefault()
        mentions.handleSelectComposerMention(
          mentions.composerResults[
            Math.min(mentions.activeSkillMentionIndex, mentions.composerResults.length - 1)
          ]
        )
        return
      }
    }

    if (mentions.fileMentionMenuOpen && !event.nativeEvent.isComposing) {
      if (event.key === 'Escape') {
        event.preventDefault()
        mentions.setFileMention(null)
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (mentions.fileMentionResults.length === 0) return

        const direction = event.key === 'ArrowDown' ? 1 : -1
        mentions.setActiveFileMentionIndex(
          (currentIndex) =>
            (currentIndex + direction + mentions.fileMentionResults.length) %
            mentions.fileMentionResults.length
        )
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        const selectedFile =
          mentions.fileMentionResults[
            Math.min(mentions.activeFileMentionIndex, mentions.fileMentionResults.length - 1)
          ]
        if (selectedFile) mentions.handleSelectFileMention(selectedFile)
        return
      }

      if (event.key === 'Tab' && mentions.fileMentionResults.length > 0) {
        event.preventDefault()
        mentions.handleSelectFileMention(
          mentions.fileMentionResults[
            Math.min(mentions.activeFileMentionIndex, mentions.fileMentionResults.length - 1)
          ]
        )
        return
      }
    }

    if (
      event.key === 'PageUp' ||
      event.key === 'PageDown' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      event.stopPropagation()
      restoreAncestorScrollAfterNativeNavigation(event.currentTarget)
    }

    if (event.key === 'Tab' && !event.nativeEvent.isComposing && !editing && message.trim()) {
      event.preventDefault()
      const prompt = message.trim()
      const draft: PromptDraft = {
        id: crypto.randomUUID(),
        prompt
      }

      setPromptDraftsByScope((drafts) => addPromptDraft(drafts, draftScopeKey, draft))
      setMessage('')
      mentions.setFileMention(null)
      mentions.setSkillMention(null)
      mentions.setProjectMention(null)
      return
    }

    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return

    event.preventDefault()
    submitMessage(
      active
        ? getModifiedActiveSendMode(activePrimaryMode, activeSteeringEnabled, event.ctrlKey)
        : activePrimaryMode
    )
  }

  const handlePopPromptDraft = (draft: PromptDraft): void => {
    setPromptDraftsByScope((drafts) => removePromptDraft(drafts, draftScopeKey, draft.id))
    setMessage((currentMessage) => appendPromptDraft(currentMessage, draft.prompt))
    mentions.setFileMention(null)
    mentions.setSkillMention(null)
    mentions.setProjectMention(null)

    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return

      textarea.focus({ preventScroll: true })
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    })
  }

  const handleRemovePromptDraft = (draftId: string): void => {
    setPromptDraftsByScope((drafts) => removePromptDraft(drafts, draftScopeKey, draftId))
  }
  return { controlPressed, handleMessageKeyDown, handlePopPromptDraft, handleRemovePromptDraft }
}
