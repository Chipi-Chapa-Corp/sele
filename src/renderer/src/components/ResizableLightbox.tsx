import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'
import { PopupWindow } from './PopupWindow'
import './ResizableLightbox.css'

type ResizableLightboxProps = {
  open: boolean
  label: string
  onClose: () => void
  children: ReactNode
  actions?: ReactNode
  flushContent?: boolean
  overlayActions?: boolean
}

// Keep children in the same DOM position so interactive iframes retain their state.
// A modal dialog enters the browser's top layer without reparenting its contents.
export function ResizableLightbox({
  open,
  label,
  onClose,
  children,
  actions,
  flushContent = false,
  overlayActions = false
}: ResizableLightboxProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!open) {
      if (dialog.open) dialog.close()
      dialog.style.removeProperty('width')
      dialog.style.removeProperty('height')
      return
    }
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog.open) dialog.showModal()
    closeButtonRef.current?.focus({ preventScroll: true })
    return () => {
      if (dialog.open) dialog.close()
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [open])

  return (
    <PopupWindow>
      <dialog
        ref={dialogRef}
        className={`resizable-lightbox${flushContent ? ' resizable-lightbox--flush-content' : ''}${overlayActions ? ' resizable-lightbox--overlay-actions' : ''}`}
        aria-label={label}
        aria-modal={open ? true : undefined}
        onCancel={(event) => {
          event.preventDefault()
          onClose()
        }}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return
          const bounds = event.currentTarget.getBoundingClientRect()
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            onClose()
        }}
      >
        <div className="resizable-lightbox__content">{children}</div>
        {open && (
          <div className="resizable-lightbox__actions">
            {actions}
            <Button
              ref={closeButtonRef}
              aria-label={`Close ${label.toLowerCase()}`}
              callback={onClose}
              icon={<X aria-hidden="true" />}
              size="small"
              theme="transparent"
              title="Close"
            />
          </div>
        )}
      </dialog>
    </PopupWindow>
  )
}
