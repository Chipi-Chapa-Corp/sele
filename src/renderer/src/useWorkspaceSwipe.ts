import { useEffect, useRef, type RefObject } from 'react'
import { consumeTouchClick } from './touchInput'

const ownsHorizontalInput = (target: Element, container: HTMLElement): boolean => {
  if (
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="slider"], [role="combobox"], .xterm, .monaco-editor, .remote-browser__page, .mobile-code-editor, [data-touch-actions="open"]'
    )
  )
    return true
  for (
    let element: Element | null = target;
    element && element !== container;
    element = element.parentElement
  ) {
    if (
      element.scrollWidth > element.clientWidth + 2 &&
      /auto|scroll/.test(getComputedStyle(element).overflowX)
    )
      return true
  }
  return false
}

/** Horizontal page gestures leave vertical scrolling, selection and editors native. */
export const useWorkspaceSwipe = (
  ref: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  onSwipe: (direction: 'next' | 'previous') => void,
  canSwipe?: (direction: 'next' | 'previous') => boolean
): void => {
  const callback = useRef(onSwipe)
  callback.current = onSwipe
  const allowed = useRef(canSwipe)
  allowed.current = canSwipe
  useEffect(() => {
    const container = ref.current
    if (!enabled || !container) return
    let gesture: { x: number; y: number; at: number; locked: boolean } | null = null
    const start = (event: TouchEvent): void => {
      gesture = null
      if (event.touches.length !== 1 || !(event.target instanceof Element)) return
      if (
        document.querySelector(
          'dialog[open], [role="dialog"]:not([data-mobile-sidebar]), [role="menu"], [role="listbox"]'
        )
      )
        return
      if (ownsHorizontalInput(event.target, container) || !window.getSelection()?.isCollapsed)
        return
      const touch = event.touches[0]
      gesture = { x: touch.clientX, y: touch.clientY, at: performance.now(), locked: false }
    }
    const move = (event: TouchEvent): void => {
      if (!gesture) return
      if (!window.getSelection()?.isCollapsed) {
        gesture = null
        return
      }
      if (event.touches.length !== 1) {
        gesture = null
        return
      }
      const dx = event.touches[0].clientX - gesture.x
      const dy = event.touches[0].clientY - gesture.y
      if (Math.abs(dx) > 14 && allowed.current?.(dx < 0 ? 'next' : 'previous') === false) {
        gesture = null
        return
      }
      if (!gesture.locked && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
        gesture = null
        return
      }
      if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.6) gesture.locked = true
      if (gesture.locked) event.preventDefault()
    }
    const end = (event: TouchEvent): void => {
      const current = gesture
      gesture = null
      if (!current?.locked || !event.changedTouches.length) return
      const dx = event.changedTouches[0].clientX - current.x
      if (
        Math.abs(dx) < Math.max(64, container.clientWidth * 0.18) ||
        performance.now() - current.at > 900
      )
        return
      event.preventDefault()
      consumeTouchClick(container.ownerDocument)
      callback.current(dx < 0 ? 'next' : 'previous')
    }
    const cancel = (): void => {
      gesture = null
    }
    container.addEventListener('touchstart', start, { passive: true })
    container.addEventListener('touchmove', move, { passive: false })
    container.addEventListener('touchend', end, { passive: false })
    container.addEventListener('touchcancel', cancel)
    return () => {
      container.removeEventListener('touchstart', start)
      container.removeEventListener('touchmove', move)
      container.removeEventListener('touchend', end)
      container.removeEventListener('touchcancel', cancel)
    }
  }, [ref, enabled])
}
