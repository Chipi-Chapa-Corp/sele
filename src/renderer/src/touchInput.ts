// Consume the compatibility click produced after a completed touch gesture.
// A new pointer-down always starts a fresh gesture, including mouse input.
const guards = new WeakMap<Document, { until: number; mouse: boolean }>()
const editingTouches = new WeakSet<Document>()

export const isTouchEditingActivation = (document: Document): boolean =>
  editingTouches.has(document)

export const touchClickGuard = (document: Document): { until: number; mouse: boolean } => {
  let guard = guards.get(document)
  if (guard) return guard
  guard = { until: 0, mouse: false }
  guards.set(document, guard)
  const current = guard
  document.addEventListener(
    'pointerdown',
    () => {
      current.until = 0
      current.mouse = false
    },
    true
  )
  document.addEventListener(
    'keydown',
    () => {
      current.until = 0
      current.mouse = false
    },
    true
  )
  // Android dispatches compatibility mouse-down before click. Its default can
  // blur a newly focused input even if the later click is suppressed. A real
  // new mouse gesture has already cleared this guard through pointer-down.
  for (const type of ['mousedown', 'mouseup'])
    document.addEventListener(
      type,
      (event) => {
        if (performance.now() >= current.until) return
        current.mouse = true
        event.preventDefault()
        event.stopImmediatePropagation()
      },
      true
    )
  document.addEventListener(
    'click',
    (event) => {
      const native = event as MouseEvent & {
        pointerType?: string
        sourceCapabilities?: { firesTouchEvents?: boolean }
      }
      if (
        performance.now() < current.until &&
        (current.mouse ||
          native.detail > 0 ||
          native.pointerType === 'touch' ||
          native.sourceCapabilities?.firesTouchEvents === true)
      ) {
        current.until = 0
        current.mouse = false
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    },
    true
  )
  return guard
}

export const consumeTouchClick = (document: Document): void => {
  touchClickGuard(document).until = performance.now() + 1000
}

/** Complete a control tap before Android can blur its editor and resize the
 * WebView. This also covers native form buttons and portaled menu options. */
export const installTouchEditingActivation = (keyboard?: {
  visible: () => boolean
  restore: () => void
}): void => {
  const doc = document
  const guard = touchClickGuard(doc)
  let press: {
    id: number
    x: number
    y: number
    target: HTMLElement
    editor: HTMLElement
    selection: [number, number, 'forward' | 'backward' | 'none'] | null
    keyboard: boolean
  } | null = null
  const cancel = (): void => {
    press = null
    editingTouches.delete(doc)
  }
  doc.addEventListener(
    'pointerdown',
    (event) => {
      cancel()
      if (event.pointerType !== 'touch' || !event.isPrimary || !(event.target instanceof Element))
        return
      const editor = doc.activeElement
      if (
        !(editor instanceof HTMLElement) ||
        !editor.matches('input, textarea, [contenteditable="true"]')
      )
        return
      const target = event.target.closest<HTMLElement>(
        'button, [role="option"], [role="button"], input[type="submit"]'
      )
      if (
        !target ||
        target.matches(':disabled, [aria-disabled="true"]') ||
        target.closest('[inert]')
      )
        return
      press = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        target,
        editor,
        selection:
          (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) &&
          editor.selectionStart !== null &&
          editor.selectionEnd !== null
            ? [editor.selectionStart, editor.selectionEnd, editor.selectionDirection ?? 'none']
            : null,
        keyboard: keyboard?.visible() ?? false
      }
      editingTouches.add(doc)
      event.preventDefault()
    },
    { capture: true, passive: false }
  )
  doc.addEventListener(
    'pointermove',
    (event) => {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) cancel()
    },
    true
  )
  doc.addEventListener('pointercancel', cancel, true)
  doc.addEventListener(
    'pointerup',
    (event) => {
      const current = press
      if (!current || current.id !== event.pointerId) return
      if (
        guard.until > performance.now() ||
        !current.target.isConnected ||
        current.target.matches(':disabled, [aria-disabled="true"]') ||
        current.target.closest('[inert]')
      ) {
        cancel()
        return
      }
      // Some Android IMEs reset the caret without blurring the DOM editor.
      // Keep that transient selection out of autocomplete until the tap acts.
      if (doc.activeElement === current.editor && current.selection)
        (current.editor as HTMLInputElement | HTMLTextAreaElement).setSelectionRange(
          ...current.selection
        )
      // A programmatic click still performs native form submission; it is sent
      // inside the trusted gesture, while its original target still exists.
      current.target.click()
      cancel()
      if (current.keyboard && doc.activeElement === current.editor && current.editor.isConnected)
        keyboard?.restore()
      guard.until = performance.now() + 1000
      event.preventDefault()
      event.stopImmediatePropagation()
    },
    { capture: true, passive: false }
  )
}
