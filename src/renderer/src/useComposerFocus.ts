import { useEffect, useRef, type RefObject } from 'react'
import { useCompactLayout } from './useCompactLayout'

const editingSelector =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'
const focusOwnerSelector =
  'dialog[open], [role="dialog"], [role="menu"], [role="listbox"], .monaco-editor, .terminal-panel__surface, webview, iframe'
const actionSelector = 'button, [role="button"], [role="menuitem"], summary, a[href]'
const overlaySelector = 'dialog[open], [role="dialog"], [role="menu"], [role="listbox"]'

/** The composer is the default focus target, while selection and other editing surfaces own theirs. */
export function useComposerFocus(
  inputRef: RefObject<HTMLTextAreaElement | null>,
  scope: string,
  autoFocus: boolean
): void {
  const actionOrigin = useRef<Element | null>(null)
  const compact = useCompactLayout()
  const overlays = useRef(new Set<Element>())
  const mutationHandler = useRef<(() => void) | null>(null)
  // Index the small set of focus-owning overlays once per mounted composer.
  // Restoring focus must not query every node in several retained transcripts.
  useEffect(() => {
    const input = inputRef.current
    if (!input || compact) return
    const document = input.ownerDocument
    const nodes = new Set(document.querySelectorAll(overlaySelector))
    overlays.current = nodes
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof Element) {
          if (record.target.matches(overlaySelector)) nodes.add(record.target)
          else nodes.delete(record.target)
        }
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue
          if (node.matches(overlaySelector)) nodes.add(node)
          node.querySelectorAll(overlaySelector).forEach((overlay) => nodes.add(overlay))
        }
      }
      for (const node of nodes) if (!node.isConnected) nodes.delete(node)
      mutationHandler.current?.()
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role', 'open', 'hidden', 'inert', 'aria-hidden']
    })
    return () => {
      observer.disconnect()
      nodes.clear()
    }
  }, [inputRef, compact])
  // biome-ignore lint/correctness/useExhaustiveDependencies: Chat navigation and reopening must refocus a retained textarea.
  useEffect(() => {
    // Touch users choose when to open the keyboard. Desktop caret restoration
    // would reopen it after navigation and steal taps from moving controls.
    if (compact) return
    const input = inputRef.current
    if (!input) return
    const document = input.ownerDocument
    const window = document.defaultView
    if (!window) return
    let frame: number | null = null
    let pointerDown = false
    let dragStart: DragEvent | null = null
    let navigatingWithTab = false

    const visible = (element: Element): boolean =>
      !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
      element.getClientRects().length > 0
    const hasSelection = (): boolean => {
      const selection = document.getSelection()
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false
      const anchor = selection.anchorNode
      const element = anchor instanceof Element ? anchor : anchor?.parentElement
      return Boolean(element && visible(element))
    }
    const restore = (): void => {
      frame = null
      if (dragStart?.defaultPrevented) dragStart = null
      if (
        pointerDown ||
        dragStart !== null ||
        navigatingWithTab ||
        !input.isConnected ||
        input.disabled ||
        !document.hasFocus() ||
        document.visibilityState === 'hidden'
      )
        return
      const active = document.activeElement
      // Most events arrive while the caret is already here. Do not scan the
      // transcript for overlays or refocus the window on every streamed update.
      // Calling window.focus() here can itself emit focus and schedule another
      // frame, keeping this restoration loop alive indefinitely in Electron.
      if (active === input) {
        actionOrigin.current = null
        return
      }
      if (!visible(input)) return
      if (
        active &&
        active !== input &&
        visible(active) &&
        active !== actionOrigin.current &&
        (active.matches(editingSelector) || active.closest(focusOwnerSelector))
      )
        return
      if ([...overlays.current].some(visible) || hasSelection()) return

      actionOrigin.current = null
      input.focus({ preventScroll: true })
      // Chromium can retain DOM focus after clipboard/selection cleanup but lose its caret.
      if (document.activeElement === input && document.getSelection()?.rangeCount === 0) {
        input.setSelectionRange(input.selectionStart, input.selectionEnd, input.selectionDirection)
      }
    }
    const schedule = (): void => {
      if (frame === null) frame = window.requestAnimationFrame(restore)
    }
    const elementOf = (target: EventTarget | null): Element | null =>
      target instanceof Element ? target : target instanceof Node ? target.parentElement : null
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || !event.isPrimary) return
      pointerDown = true
      navigatingWithTab = false
    }
    const onMouseDown = (event: MouseEvent): void => {
      const target = elementOf(event.target)
      if (
        event.button !== 0 ||
        event.shiftKey ||
        !target ||
        target.closest('[draggable="true"]') ||
        target.closest(editingSelector) ||
        target.closest(focusOwnerSelector)
      )
        return
      // Actions must not take the editing caret or collapse selected transcript text.
      // Their click and native <summary> toggle still run normally.
      if (target.closest(actionSelector)) {
        actionOrigin.current = document.activeElement
        event.preventDefault()
      }
    }
    const onPointerUp = (): void => {
      pointerDown = false
      schedule()
    }
    const onClick = (): void => {
      navigatingWithTab = false
      schedule()
    }
    const onDragStart = (event: DragEvent): void => {
      // Read defaultPrevented during the next focus pass, after target handlers can cancel it.
      dragStart = event
    }
    const onDragEnd = (): void => {
      dragStart = null
      pointerDown = false
      schedule()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') navigatingWithTab = true
      else if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') {
        navigatingWithTab = false
        if (!elementOf(event.target)?.closest(editingSelector)) schedule()
      }
    }
    const onFocusIn = (): void => {
      if (!navigatingWithTab) schedule()
    }
    const onWindowFocus = (): void => {
      pointerDown = false
      dragStart = null
      navigatingWithTab = false
      schedule()
    }
    const onMutation = (): void => {
      // A copied temporary textarea or a dismissed dialog can be removed without blur.
      // The usual streaming path exits here without reading selection or measuring layout.
      if (document.activeElement !== input && !navigatingWithTab) schedule()
    }
    mutationHandler.current = onMutation
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('pointercancel', onPointerUp, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('dragstart', onDragStart, true)
    document.addEventListener('dragend', onDragEnd, true)
    document.addEventListener('drop', onDragEnd, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', schedule, true)
    window.addEventListener('focus', onWindowFocus)
    schedule()
    return () => {
      if (mutationHandler.current === onMutation) mutationHandler.current = null
      if (frame !== null) window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('pointercancel', onPointerUp, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('dragstart', onDragStart, true)
      document.removeEventListener('dragend', onDragEnd, true)
      document.removeEventListener('drop', onDragEnd, true)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', schedule, true)
      window.removeEventListener('focus', onWindowFocus)
    }
  }, [inputRef, scope, autoFocus, compact])
}
