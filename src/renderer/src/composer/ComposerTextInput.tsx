import type { ProviderPromptSuggestion } from '../../../shared/provider'
import type { RefObject } from 'react'
import { memo } from 'react'
import { createPortal } from 'react-dom'
import { ComposerPlaceholder } from '../components/ComposerPlaceholder'
import { Dropdown } from '../components/Dropdown'
import { isTouchEditingActivation } from '../touchInput'
import { useCompactLayout } from '../useCompactLayout'
import { useComposerAttachments } from './useComposerAttachments'
import { useComposerDraftState } from './useComposerDraftState'
import { useComposerKeyboard } from './useComposerKeyboard'
import { useComposerMentions } from './useComposerMentions'
import { useComposerSubmission } from './useComposerSubmission'

type ComposerTextInputProps = {
  mentions: ReturnType<typeof useComposerMentions>
  autoFocus: boolean
  draftScopeKey: string
  draft: ReturnType<typeof useComposerDraftState>
  visiblePromptSuggestion: ProviderPromptSuggestion | null
  dismissPromptSuggestion: () => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  sending: ReturnType<typeof useComposerSubmission>
  activePrimaryMode: 'steer' | 'queue'
  handleMessageChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void
  keyboard: ReturnType<typeof useComposerKeyboard>
  attachments: ReturnType<typeof useComposerAttachments>
}

export const ComposerTextInput = memo(function ComposerTextInput({
  mentions,
  autoFocus,
  draftScopeKey,
  draft,
  visiblePromptSuggestion,
  dismissPromptSuggestion,
  textareaRef,
  sending,
  activePrimaryMode,
  handleMessageChange,
  keyboard,
  attachments
}: ComposerTextInputProps) {
  const compact = useCompactLayout()
  return (
    <div ref={mentions.textareaWrapRef} className="message-box__textarea-wrap">
      {autoFocus && draftScopeKey.startsWith('new-chat:') && (
        <ComposerPlaceholder scope={draftScopeKey} empty={!draft.message} />
      )}
      {mentions.mentionMenuOpen &&
        mentions.mentionMenuStyle &&
        createPortal(
          <div
            ref={mentions.mentionMenuRef}
            className="message-box__file-mention-menu"
            style={mentions.mentionMenuStyle}
          >
            <Dropdown
              activeIndex={mentions.activeMentionMenu.activeIndex}
              aria-label={mentions.activeMentionMenu.label}
              emptyContent={mentions.mentionDropdownEmptyContent}
              listboxId={mentions.activeMentionMenu.listboxId}
              menuOnly
              options={mentions.mentionDropdownOptions}
              value=""
              onActiveIndexChange={mentions.activeMentionMenu.setActiveIndex}
              onChange={(value) => mentions.activeMentionMenu.select(Number(value))}
            />
          </div>,
          document.body
        )}
      {visiblePromptSuggestion && (
        <div className="message-box__prompt-suggestion">
          <button
            type="button"
            className="message-box__suggestion-key"
            tabIndex={-1}
            aria-label="Accept suggestion into draft (Tab)"
            title="Accept into draft (Tab)"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              dismissPromptSuggestion()
              draft.setMessage(visiblePromptSuggestion.text)
              textareaRef.current?.focus({ preventScroll: true })
            }}
          >
            <span>Tab</span>
          </button>
          <span className="message-box__suggestion-text" aria-hidden="true">
            {visiblePromptSuggestion.text}
          </span>
          <button
            type="button"
            className="message-box__suggestion-key"
            tabIndex={-1}
            aria-label={
              compact ? 'Send suggestion immediately' : 'Send suggestion immediately (Enter)'
            }
            title={compact ? 'Send immediately' : 'Send immediately (Enter)'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              dismissPromptSuggestion()
              sending.submitMessage(activePrimaryMode, visiblePromptSuggestion.text)
            }}
          >
            <span>{compact ? 'Send' : 'Enter'}</span>
          </button>
        </div>
      )}
      <textarea
        ref={textareaRef}
        id="message-input"
        rows={1}
        enterKeyHint={compact ? 'enter' : undefined}
        value={draft.message}
        placeholder={
          visiblePromptSuggestion ? '' : 'Use @ for files, $ for skills and # for projects'
        }
        aria-autocomplete={visiblePromptSuggestion ? 'inline' : 'list'}
        aria-description={
          visiblePromptSuggestion
            ? `Suggested next prompt: ${visiblePromptSuggestion.text}. ${compact ? 'Tap Send to send immediately.' : 'Press Tab to accept into draft, Enter to send immediately, or Escape to dismiss.'}`
            : undefined
        }
        aria-controls={mentions.mentionMenuOpen ? mentions.activeMentionMenu.listboxId : undefined}
        aria-expanded={mentions.mentionMenuOpen}
        aria-activedescendant={
          mentions.mentionMenuOpen && mentions.mentionDropdownOptions.length > 0
            ? `${mentions.activeMentionMenu.listboxId}-option-${Math.min(mentions.activeMentionMenu.activeIndex, mentions.mentionDropdownOptions.length - 1)}`
            : undefined
        }
        onBlur={(event) => {
          if (isTouchEditingActivation(event.currentTarget.ownerDocument)) return
          mentions.closeMentions()
        }}
        onChange={handleMessageChange}
        onKeyDown={keyboard.handleMessageKeyDown}
        onPaste={(event) => void attachments.handlePaste(event)}
        onSelect={mentions.handleMessageSelect}
      />
    </div>
  )
})
