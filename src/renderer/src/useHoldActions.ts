import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { consumeTouchClick } from './touchInput'

/** Touch context actions: hold to reveal, move/scroll to cancel, tap elsewhere to dismiss. */
export const useHoldActions = (ref: RefObject<HTMLElement | null>) => {
  const [open, setOpen] = useState(false)
  const [touch, setTouch] = useState(false)
  const press = useRef<{
    x: number
    y: number
    timer: ReturnType<typeof setTimeout> | null
    held: boolean
  } | null>(null)
  const cancel = (): void => {
    if (press.current?.timer) clearTimeout(press.current.timer)
    press.current = null
  }
  useEffect(
    () => () => {
      if (press.current?.timer) clearTimeout(press.current.timer)
    },
    []
  )
  useEffect(() => {
    if (!open) return
    const dismiss = (event: globalThis.PointerEvent): void => {
      if (!(event.target instanceof Element)) return
      if (
        ref.current?.contains(event.target) ||
        event.target.closest(
          '[role="menu"], [role="listbox"], [role="dialog"]:not([data-mobile-sidebar]), .ui-dropdown__menu, .ui-button-menu'
        )
      )
        return
      setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open, ref])
  return {
    open,
    touch,
    close: () => setOpen(false),
    onPointerDown: (event: PointerEvent<HTMLElement>): void => {
      if (event.target instanceof Node && !event.currentTarget.contains(event.target)) return
      if (event.pointerType !== 'touch') {
        setTouch(false)
        return
      }
      setTouch(true)
      cancel()
      if (
        !event.isPrimary ||
        (event.target instanceof Element &&
          event.target.closest('input, textarea, .chat-list-item__actions'))
      )
        return
      // React clears currentTarget after dispatch; retain the document for the timer.
      const document = event.currentTarget.ownerDocument
      const entry: NonNullable<typeof press.current> = {
        x: event.clientX,
        y: event.clientY,
        timer: null,
        held: false
      }
      entry.timer = setTimeout(() => {
        entry.held = true
        setOpen(true)
        consumeTouchClick(document)
      }, 450)
      press.current = entry
    },
    onPointerMove: (event: PointerEvent<HTMLElement>): void => {
      const start = press.current
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancel()
    },
    onPointerUp: (event: PointerEvent<HTMLElement>): void => {
      if (press.current?.held) {
        consumeTouchClick(event.currentTarget.ownerDocument)
        event.preventDefault()
      }
      cancel()
    },
    onPointerCancel: cancel,
    onContextMenu: (event: React.MouseEvent<HTMLElement>): void => {
      if (!touch && !window.matchMedia('(pointer: coarse)').matches) return
      event.preventDefault()
      setOpen(true)
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>): void => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') setOpen(false)
    }
  }
}
