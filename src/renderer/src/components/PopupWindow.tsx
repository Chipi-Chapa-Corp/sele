import { cloneElement, type PointerEvent, type ReactElement, type ReactNode } from 'react'
import './PopupWindow.css'

type PopupWindowProps = {
  children: ReactElement<{ className?: string; children?: ReactNode }>
}

// Every popup is centered by its overlay, so a size change moves both edges
// by half of the change. Doubling the pointer delta keeps the dragged corner
// under the cursor; native CSS resize tracks the cursor at half speed instead.
function startResize(event: PointerEvent<HTMLSpanElement>): void {
  if (event.button !== 0) return
  const handle = event.currentTarget
  const popup = handle.parentElement
  if (!popup) return

  event.preventDefault()
  event.stopPropagation()
  const bounds = popup.getBoundingClientRect()
  const startX = event.clientX
  const startY = event.clientY
  const pointerId = event.pointerId
  handle.setPointerCapture(pointerId)

  const resize = (move: globalThis.PointerEvent): void => {
    if (move.pointerId !== pointerId) return
    popup.style.width = `${bounds.width + 2 * (move.clientX - startX)}px`
    popup.style.height = `${bounds.height + 2 * (move.clientY - startY)}px`
  }
  const stop = (): void => {
    handle.removeEventListener('pointermove', resize)
    handle.removeEventListener('lostpointercapture', stop)
  }
  handle.addEventListener('pointermove', resize)
  handle.addEventListener('lostpointercapture', stop)
}

// Keep each popup's semantic element (form, section, or dialog) while sharing
// its window behavior. Cloning also preserves refs on native dialogs.
export function PopupWindow({ children }: PopupWindowProps): ReactElement {
  return cloneElement(
    children,
    { className: `${children.props.className ?? ''} popup-window`.trim() },
    children.props.children,
    <span
      key="popup-window-resize-handle"
      className="popup-window__resize-handle"
      aria-hidden="true"
      onPointerDown={startResize}
    />
  )
}
