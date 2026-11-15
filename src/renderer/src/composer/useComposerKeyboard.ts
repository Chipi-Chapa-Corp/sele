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
import { useCompactLayout } from '../useCompactLayout'
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
  const compact = useCompactLayout()

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
    // Let the phone keyboard insert its native newline, including while a
    // suggestion or mention picker is visible. Sending has an explicit button.
    if (compact && event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey)
      return

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
    for (const menu of mentions.mentionMenus) {
      if (!menu.open || event.nativeEvent.isComposing) continue
      if (event.key === 'Escape') {
        event.preventDefault()
        menu.close()
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (menu.count === 0) return
        const direction = event.key === 'ArrowDown' ? 1 : -1
        menu.setActiveIndex((index) => (index + direction + menu.count) % menu.count)
        return
      }
      if (event.key === 'Enter' || (event.key === 'Tab' && menu.count > 0)) {
        event.preventDefault()
        menu.select(Math.min(menu.activeIndex, menu.count - 1))
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
      mentions.closeMentions()
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
    mentions.closeMentions()

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
