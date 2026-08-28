import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import './TableLightbox.css'

type TableLightboxProps = {
  tableHtml: string
  onClose: () => void
}

export const TableLightbox = ({ tableHtml, onClose }: TableLightboxProps): React.ReactElement => {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previouslyFocusedElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus({ preventScroll: true })

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocusedElement?.focus({ preventScroll: true })
    }
  }, [onClose])

  return createPortal(
    <div
      className="table-lightbox"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="table-lightbox__dialog"
        role="dialog"
        aria-label="Expanded table"
        aria-modal="true"
      >
        <div className="table-lightbox__content" dangerouslySetInnerHTML={{ __html: tableHtml }} />
        <div className="table-lightbox__actions">
          <Button
            ref={closeButtonRef}
            aria-label="Close expanded table"
            callback={onClose}
            icon={<X aria-hidden="true" />}
            size="small"
            theme="transparent"
            title="Close"
          />
        </div>
      </section>
    </div>,
    document.body
  )
}
