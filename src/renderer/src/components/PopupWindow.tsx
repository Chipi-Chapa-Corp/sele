import { cloneElement, type ReactElement } from 'react'
import './PopupWindow.css'

type PopupWindowProps = {
  children: ReactElement<{ className?: string }>
}

// Keep each popup's semantic element (form, section, or dialog) while sharing
// its window behavior. Cloning also preserves refs on native dialogs.
export function PopupWindow({ children }: PopupWindowProps): ReactElement {
  return cloneElement(children, {
    className: `${children.props.className ?? ''} popup-window`.trim()
  })
}
