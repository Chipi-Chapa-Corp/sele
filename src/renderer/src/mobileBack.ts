/** Dismiss the highest visible popup before navigating the phone workspace. */
export const dismissMobileOverlay = (): boolean => {
  const layers = [
    ...document.querySelectorAll<HTMLElement>(
      'dialog[open], [role="dialog"]:not([data-mobile-sidebar]), [role="menu"], [role="listbox"], .ui-button-menu-root, .popup-window'
    )
  ].filter(
    (element) =>
      element.getAttribute('aria-label') !== 'Settings' &&
      !element.closest('[inert]') &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== 'hidden'
  )
  const order = (element: HTMLElement): number => {
    if (element.closest('dialog:modal')) return Number.MAX_SAFE_INTEGER
    let depth = 0
    for (let current: HTMLElement | null = element; current; current = current.parentElement)
      depth = Math.max(depth, Number.parseInt(getComputedStyle(current).zIndex, 10) || 0)
    return depth
  }
  // Equal-depth portals are ordered by insertion, with the newest on top.
  const overlay = layers
    .map((element, index) => ({ element, index, depth: order(element) }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .at(-1)?.element
  if (!overlay) return false
  if (overlay instanceof HTMLDialogElement) {
    // A synthetic Escape does not perform a native dialog's cancel default.
    if (overlay.dispatchEvent(new Event('cancel', { cancelable: true }))) overlay.close()
    return true
  }
  const trigger = [
    ...document.querySelectorAll<HTMLElement>('[aria-expanded="true"][aria-controls]')
  ].find((element) => element.getAttribute('aria-controls')?.split(' ').includes(overlay.id))
  // Dropdown options are portaled from their trigger. Sending Escape through
  // the option container would also reach the chat row's hold-action handler.
  if (overlay.getAttribute('role') === 'listbox' && trigger) {
    trigger.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
    return true
  }
  const active = document.activeElement
  const target =
    active instanceof HTMLElement && overlay.contains(active)
      ? active
      : (overlay.querySelector<HTMLElement>(
          'button:not(:disabled), input, textarea, [tabindex="0"]'
        ) ?? overlay)
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  if (target.dispatchEvent(event)) {
    if (trigger)
      trigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      )
    else
      overlay
        .querySelector<HTMLButtonElement>('button[aria-label^="Close"]:not(:disabled)')
        ?.click()
  }
  return true
}
