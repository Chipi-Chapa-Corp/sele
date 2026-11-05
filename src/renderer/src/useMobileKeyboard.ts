import { useEffect, useState } from 'react'

export const useMobileKeyboard = (compact: boolean): boolean => {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!compact) {
      setOpen(false)
      return
    }
    let orientation = window.screen.orientation?.type
    let fullHeight = window.innerHeight
    const update = (): void => {
      const nextOrientation = window.screen.orientation?.type
      if (nextOrientation !== orientation) {
        orientation = nextOrientation
        fullHeight = window.innerHeight
      }
      fullHeight = Math.max(fullHeight, window.innerHeight)
      const height = window.visualViewport?.height ?? window.innerHeight
      const editing = document.activeElement?.matches('input, textarea, [contenteditable="true"]')
      setOpen(Boolean(editing && fullHeight - height > 150))
    }
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    window.screen.orientation?.addEventListener('change', update)
    window.visualViewport?.addEventListener('resize', update)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      window.screen.orientation?.removeEventListener('change', update)
      window.visualViewport?.removeEventListener('resize', update)
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', update)
    }
  }, [compact])
  return open
}
