import { useRef, type RefObject } from 'react'
import type { MouseEventHandler } from 'react'
import type { ButtonProps } from './Button.types'
import { touchClickGuard } from '../touchInput'

type Props = Pick<
  ButtonProps,
  | 'callback'
  | 'disabled'
  | 'onClick'
  | 'onPointerDown'
  | 'onPointerUp'
  | 'onPointerMove'
  | 'onPointerCancel'
> & {
  toggleRef?: RefObject<HTMLButtonElement | null>
  onToggle?: () => void
}
export function useButtonPointer({
  callback,
  disabled,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerMove,
  onPointerCancel,
  toggleRef,
  onToggle
}: Props) {
  const touch = useRef<{ id: number; x: number; y: number } | null>(null)
  const ignoreTouchClickUntil = useRef(0)
  const preserveTouchEditing: React.PointerEventHandler<HTMLButtonElement> = (event) => {
    touchClickGuard(event.currentTarget.ownerDocument).until = 0
    onPointerDown?.(event)
    if (event.pointerType === 'touch' && event.isPrimary)
      touch.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    // Moving focus to a button hides Android's keyboard before touch-up. The
    // resulting resize can cancel clicks on Send, Save, and editor actions.
    // Let the completed action move focus or close its editing surface instead.
    if (
      event.pointerType === 'touch' &&
      document.activeElement?.matches('input, textarea, [contenteditable="true"]')
    )
      event.preventDefault()
  }

  const activate: MouseEventHandler<HTMLButtonElement> = (event): void => {
    onClick?.(event)
    if (event.defaultPrevented) return

    void callback()
  }

  const isTouchCompatibilityClick = (event: React.MouseEvent<HTMLButtonElement>): boolean => {
    const native = event.nativeEvent as MouseEvent & {
      pointerType?: string
      sourceCapabilities?: { firesTouchEvents?: boolean }
    }
    return (
      performance.now() < ignoreTouchClickUntil.current &&
      (native.pointerType === 'touch' || native.sourceCapabilities?.firesTouchEvents === true)
    )
  }
  const handleClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    if (isTouchCompatibilityClick(event)) {
      event.preventDefault()
      return
    }
    activate(event)
  }
  const handleTouchMove: React.PointerEventHandler<HTMLButtonElement> = (event) => {
    onPointerMove?.(event)
    const start = touch.current
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10)
      touch.current = null
  }
  const handleTouchCancel: React.PointerEventHandler<HTMLButtonElement> = (event) => {
    touch.current = null
    onPointerCancel?.(event)
  }
  const handleTouchEnd: React.PointerEventHandler<HTMLButtonElement> = (event) => {
    onPointerUp?.(event)
    const start = touch.current
    touch.current = null
    if (!start || start.id !== event.pointerId || event.defaultPrevented || disabled) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      return
    // Android may retarget its delayed compatibility click after an IME/layout
    // change. Complete the actual touch once, without relying on that later hit test.
    ignoreTouchClickUntil.current = performance.now() + 1000
    touchClickGuard(event.currentTarget.ownerDocument).until = ignoreTouchClickUntil.current
    if (event.currentTarget === toggleRef?.current) onToggle?.()
    else activate(event)
    event.preventDefault()
  }

  return {
    preserveTouchEditing,
    handleClick,
    handleTouchEnd,
    handleTouchMove,
    handleTouchCancel,
    isTouchCompatibilityClick
  }
}
