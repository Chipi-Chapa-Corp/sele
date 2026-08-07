import { type CSSProperties, type RefObject, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Quote } from 'lucide-react'
import { Button } from './Button'
import './MessageSelectionQuoteButton.css'

type MessageSelectionQuoteButtonProps = {
  containerRef: RefObject<HTMLElement | null>
  enabled?: boolean
  onQuote: (content: string) => void
}

type SelectedQuote = {
  content: string
  left: number
  placement: 'above' | 'below'
  top: number
}

const getSelectedQuote = (container: HTMLElement): SelectedQuote | null => {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

  const content = selection.toString().trim()
  if (!content) return null

  const range = selection.getRangeAt(0)
  const assistantMessages = Array.from(
    container.querySelectorAll<HTMLElement>('.chat-detail__message--assistant')
  ).filter((message) => range.intersectsNode(message))
  if (assistantMessages.length !== 1) return null

  const assistantMessageRange = document.createRange()
  assistantMessageRange.selectNodeContents(assistantMessages[0])
  const selectedMessageRange = range.cloneRange()
  const selectionStartsBeforeMessage =
    assistantMessageRange.comparePoint(range.startContainer, range.startOffset) < 0
  const selectionEndsAfterMessage =
    assistantMessageRange.comparePoint(range.endContainer, range.endOffset) > 0

  if (selectionStartsBeforeMessage) {
    selectedMessageRange.setStart(
      assistantMessageRange.startContainer,
      assistantMessageRange.startOffset
    )
  }
  if (selectionEndsAfterMessage) {
    selectedMessageRange.setEnd(assistantMessageRange.endContainer, assistantMessageRange.endOffset)
  }

  const contentBeforeMessage = range.cloneRange()
  contentBeforeMessage.setEnd(selectedMessageRange.startContainer, selectedMessageRange.startOffset)
  const contentAfterMessage = range.cloneRange()
  contentAfterMessage.setStart(selectedMessageRange.endContainer, selectedMessageRange.endOffset)
  if (contentBeforeMessage.toString().trim() || contentAfterMessage.toString().trim()) return null

  const rects = Array.from(selectedMessageRange.getClientRects()).filter(
    (candidateRect) => candidateRect.width > 0 || candidateRect.height > 0
  )
  const rect = rects.at(-1) ?? selectedMessageRange.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null

  const viewportInset = 8
  const buttonHalfWidth = 16
  const buttonHeight = 32
  const offset = 8
  const placement = rect.top >= viewportInset + buttonHeight + offset ? 'above' : 'below'

  return {
    content,
    left: Math.min(
      Math.max(rect.left + rect.width / 2, viewportInset + buttonHalfWidth),
      window.innerWidth - viewportInset - buttonHalfWidth
    ),
    placement,
    top:
      placement === 'above'
        ? rect.top - offset
        : Math.min(rect.bottom + offset, window.innerHeight - viewportInset - buttonHeight)
  }
}

export const MessageSelectionQuoteButton: React.FC<MessageSelectionQuoteButtonProps> = ({
  containerRef,
  enabled = true,
  onQuote
}) => {
  const rootRef = useRef<HTMLDivElement>(null)
  const [selectedQuote, setSelectedQuote] = useState<SelectedQuote | null>(null)

  useEffect(() => {
    if (!enabled) {
      window.getSelection()?.removeAllRanges()
      const dismissFrame = window.requestAnimationFrame(() => setSelectedQuote(null))
      return () => window.cancelAnimationFrame(dismissFrame)
    }

    let selectionFrame: number | null = null
    let selectingWithPointer = false

    const cancelSelectionUpdate = (): void => {
      if (selectionFrame === null) return
      window.cancelAnimationFrame(selectionFrame)
      selectionFrame = null
    }

    const updateSelection = (): void => {
      selectionFrame = null
      const container = containerRef.current
      setSelectedQuote(container ? getSelectedQuote(container) : null)
    }

    const scheduleSelectionUpdate = (): void => {
      cancelSelectionUpdate()
      selectionFrame = window.requestAnimationFrame(updateSelection)
    }

    const dismiss = (): void => {
      selectingWithPointer = false
      cancelSelectionUpdate()
      setSelectedQuote(null)
    }

    const clearSelectionAndDismiss = (): void => {
      dismiss()
      window.getSelection()?.removeAllRanges()
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target)) return

      const container = containerRef.current
      dismiss()
      selectingWithPointer =
        event.isPrimary && event.button === 0 && Boolean(container?.contains(target))
      if (event.isPrimary && event.button === 0) window.getSelection()?.removeAllRanges()
    }

    const handlePointerUp = (): void => {
      if (!selectingWithPointer) return
      selectingWithPointer = false
      scheduleSelectionUpdate()
    }

    const handlePointerCancel = (): void => {
      dismiss()
    }

    const handleSelectionChange = (): void => {
      if (!selectingWithPointer) scheduleSelectionUpdate()
    }

    const handleFocusIn = (event: FocusEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target)) return
      clearSelectionAndDismiss()
    }

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') dismiss()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('pointerup', handlePointerUp, true)
    document.addEventListener('pointercancel', handlePointerCancel, true)
    document.addEventListener('selectionchange', handleSelectionChange)
    document.addEventListener('focusin', handleFocusIn, true)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)

    return () => {
      cancelSelectionUpdate()
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('pointerup', handlePointerUp, true)
      document.removeEventListener('pointercancel', handlePointerCancel, true)
      document.removeEventListener('selectionchange', handleSelectionChange)
      document.removeEventListener('focusin', handleFocusIn, true)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [containerRef, enabled])

  if (!selectedQuote) return null

  const style: CSSProperties = {
    left: selectedQuote.left,
    top: selectedQuote.top
  }

  return createPortal(
    <div
      className="message-selection-quote"
      data-placement={selectedQuote.placement}
      ref={rootRef}
      style={style}
    >
      <Button
        aria-label="Quote selected text"
        title="Quote selected text"
        theme="secondary"
        size="small"
        callback={() => {
          onQuote(selectedQuote.content)
          window.getSelection()?.removeAllRanges()
          setSelectedQuote(null)
        }}
        icon={<Quote aria-hidden="true" />}
        onPointerDown={(event) => event.preventDefault()}
      />
    </div>,
    document.body
  )
}
