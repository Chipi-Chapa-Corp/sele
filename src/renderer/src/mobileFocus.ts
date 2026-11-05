import { compactLayoutQuery } from './useCompactLayout'

const editing = (element: HTMLElement): boolean =>
  !element.matches('[readonly][inputmode="none"][aria-hidden="true"]') &&
  element.matches(
    'input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]'
  )
const search = (element: HTMLElement): boolean =>
  element.matches(
    'input[type="search"], [role="searchbox"], input[name="search"], [data-mobile-search]'
  ) || /\bsearch\b/i.test(element.getAttribute('aria-label') ?? '')

/** Mobile users choose when to edit. Keep explicit taps, keyboard navigation,
 * search autofocus and an existing editing caret; suppress other JS autofocus.
 * This policy applies only to Sele's document, not native browser page content. */
export function installMobileFocusPolicy(): void {
  const originalFocus = HTMLElement.prototype.focus
  let tapped: HTMLElement | null = null
  let expires = 0
  let keyboardFocus = false
  let dialogTransition = 0
  document.addEventListener(
    'pointerdown',
    (event) => {
      keyboardFocus = false
      const target = event.target instanceof Element ? event.target : null
      tapped = target?.closest<HTMLElement>('input, textarea, [contenteditable="true"]') ?? null
      // Terminal canvases and editor gutters delegate their explicit tap to a
      // nested editor. Grant only that control, never unrelated form fields.
      if (!tapped)
        tapped =
          target
            ?.closest('[data-mobile-editor]')
            ?.querySelector<HTMLElement>('textarea, input, [contenteditable="true"]') ?? null
      const label = target?.closest('label')
      if (!tapped && label instanceof HTMLLabelElement) tapped = label.control
      expires = performance.now() + 700
    },
    true
  )
  document.addEventListener(
    'keydown',
    (event) => {
      keyboardFocus = event.key === 'Tab'
    },
    true
  )
  const allowed = (element: HTMLElement): boolean =>
    !window.matchMedia(compactLayoutQuery).matches ||
    !editing(element) ||
    search(element) ||
    element === document.activeElement ||
    keyboardFocus ||
    Boolean(
      tapped && (tapped === element || element.contains(tapped)) && performance.now() < expires
    )
  HTMLElement.prototype.focus = function (options?: FocusOptions): void {
    if (allowed(this)) originalFocus.call(this, options)
  }
  for (const prototype of [HTMLInputElement.prototype, HTMLTextAreaElement.prototype]) {
    const select = prototype.select
    prototype.select = function (): void {
      if (allowed(this)) select.call(this)
    }
  }
  document.addEventListener(
    'focusin',
    (event) => {
      const element = event.target
      if (
        dialogTransition &&
        element instanceof HTMLElement &&
        window.matchMedia(compactLayoutQuery).matches &&
        editing(element) &&
        !search(element) &&
        !keyboardFocus &&
        !(tapped && (tapped === element || element.contains(tapped)) && performance.now() < expires)
      )
        element.blur()
      keyboardFocus = false
    },
    true
  )
  // Native dialog focusing steps can select the first input without calling
  // HTMLElement.focus. Focus the dialog itself unless it requests search.
  for (const method of ['showModal', 'show', 'close'] as const) {
    const original: (this: HTMLDialogElement, value?: string) => void =
      HTMLDialogElement.prototype[method]
    HTMLDialogElement.prototype[method] = function (value?: string): void {
      const first = this.querySelector<HTMLElement>('[autofocus]')
      const protect = window.matchMedia(compactLayoutQuery).matches && !(first && search(first))
      const previous = this.hasAttribute('autofocus')
      if (protect) this.setAttribute('autofocus', '')
      dialogTransition++
      try {
        if (value === undefined) original.call(this)
        else original.call(this, value)
      } finally {
        dialogTransition--
        if (protect && !previous) this.removeAttribute('autofocus')
      }
    }
  }
}
