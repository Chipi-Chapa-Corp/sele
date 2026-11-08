export const installMiddleClickPasteGuard = (): (() => void) => {
  if (!navigator.platform.toLowerCase().startsWith('linux')) return () => {}

  const preventPaste = (event: MouseEvent): void => {
    if (
      event.button === 1 &&
      event
        .composedPath()
        .some(
          (target) =>
            target instanceof HTMLElement &&
            (target.matches('input, textarea') || target.isContentEditable)
        )
    ) {
      // Chromium pastes the Linux primary selection as a mouseup default action.
      event.preventDefault()
    }
  }

  document.addEventListener('mouseup', preventPaste, true)
  return () => document.removeEventListener('mouseup', preventPaste, true)
}
