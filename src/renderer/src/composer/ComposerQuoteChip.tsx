import { Quote } from 'lucide-react'
import { useRef, useState } from 'react'
import { AttachmentChip } from '../components/AttachmentChip'
import { QuoteCommentPopover } from '../components/QuoteCommentPopover'
import { getPromptDraftPreview } from '../composerDraft'
import type { ComposerQuote } from '../composerQuotes'

export function ComposerQuoteChip({
  quote,
  onChange,
  onRemove
}: {
  quote: ComposerQuote
  onChange: (id: string, comment: string) => void
  onRemove: (id: string) => void
}): React.JSX.Element {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = (): void => {
    setOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }
  const preview = getPromptDraftPreview(quote.comment)
  return (
    <>
      <AttachmentChip
        active={open}
        className="message-box__quote"
        callback={() => setOpen(!open)}
        callbackAriaLabel={`Edit quote: ${preview}`}
        callbackTitle={quote.comment}
        icon={<Quote aria-hidden="true" />}
        label={preview}
        removeAriaLabel={`Remove quote: ${preview}`}
        removeCallback={() => onRemove(quote.id)}
        removeTitle="Remove quote"
        triggerRef={triggerRef}
        triggerAriaExpanded={open}
        triggerAriaHasPopup="dialog"
      />
      {open && triggerRef.current && (
        <QuoteCommentPopover
          anchor={triggerRef.current}
          content={quote.content}
          comment={quote.comment}
          editing
          onClose={close}
          onSubmit={(comment) => {
            onChange(quote.id, comment)
            close()
          }}
        />
      )}
    </>
  )
}
