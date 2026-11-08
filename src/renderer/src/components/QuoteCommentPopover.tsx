import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  type VirtualElement
} from '@floating-ui/dom'
import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ReviewInput } from './diffReview'
import { toCssRem } from '../cssUnits'
import './QuoteCommentPopover.css'

export const QuoteCommentPopover = ({
  anchor,
  content,
  comment = '',
  editing = false,
  onSubmit,
  onClose
}: {
  anchor: HTMLElement | VirtualElement
  content: string
  comment?: string
  editing?: boolean
  onSubmit: (comment: string) => void
  onClose: () => void
}): React.JSX.Element => {
  const popupRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    const popup = popupRef.current
    if (!popup) return
    let active = true
    const update = (): void => {
      void computePosition(anchor, popup, {
        strategy: 'fixed',
        placement: 'top-start',
        middleware: [offset(6), flip(), shift({ padding: 10 })]
      }).then(({ x, y }) => {
        if (!active) return
        popup.style.left = toCssRem(x)
        popup.style.top = toCssRem(y)
        popup.style.visibility = 'visible'
      })
    }
    const cleanup = autoUpdate(anchor, popup, update)
    const dismiss = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node) || popup.contains(target)) return
      if (anchor instanceof HTMLElement && anchor.contains(target)) return
      closeRef.current()
    }
    document.addEventListener('pointerdown', dismiss)
    return () => {
      active = false
      cleanup()
      document.removeEventListener('pointerdown', dismiss)
    }
  }, [anchor])

  return createPortal(
    <div
      ref={popupRef}
      className="quote-comment-popover"
      role="dialog"
      aria-label={editing ? 'Edit quote comment' : 'Comment on quote'}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      <blockquote className="quote-comment-popover__quote">{content}</blockquote>
      <ReviewInput
        ariaLabel="Quote comment"
        initialValue={comment}
        submitLabel={editing ? 'Save comment' : 'Add comment'}
        position={{ left: 0, top: 0 }}
        onCancel={onClose}
        onSubmit={onSubmit}
      />
    </div>,
    document.body
  )
}
