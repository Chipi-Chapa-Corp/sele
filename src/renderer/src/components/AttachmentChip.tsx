import { X } from 'lucide-react'
import type { AriaAttributes, ReactNode, Ref } from 'react'
import './AttachmentChip.css'

type AttachmentChipProps = {
  active?: boolean
  callback: () => void
  callbackAriaLabel: string
  callbackDisabled?: boolean
  callbackTitle: string
  className?: string
  disabledAppearance?: boolean
  icon: ReactNode
  label: ReactNode
  removeAriaLabel: string
  removeCallback: () => void
  removeDisabled?: boolean
  removeTitle: string
  triggerAriaControls?: string
  triggerAriaExpanded?: boolean
  triggerAriaHasPopup?: AriaAttributes['aria-haspopup']
  triggerRef?: Ref<HTMLButtonElement>
  title?: string
}

export const AttachmentChip: React.FC<AttachmentChipProps> = ({
  active = false,
  callback,
  callbackAriaLabel,
  callbackDisabled = false,
  callbackTitle,
  className,
  disabledAppearance = false,
  icon,
  label,
  removeAriaLabel,
  removeCallback,
  removeDisabled = false,
  removeTitle,
  triggerAriaControls,
  triggerAriaExpanded,
  triggerAriaHasPopup,
  triggerRef,
  title
}) => (
  <div
    className={['attachment-chip', className].filter(Boolean).join(' ')}
    data-active={active || undefined}
    data-disabled={disabledAppearance || undefined}
    role="listitem"
    title={title}
  >
    <button
      ref={triggerRef}
      type="button"
      className="attachment-chip__trigger"
      aria-controls={triggerAriaControls}
      aria-expanded={triggerAriaExpanded}
      aria-haspopup={triggerAriaHasPopup}
      aria-label={callbackAriaLabel}
      disabled={callbackDisabled}
      title={callbackTitle}
      onClick={callback}
    >
      <span className="attachment-chip__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="attachment-chip__label">{label}</span>
    </button>
    <button
      type="button"
      className="attachment-chip__remove"
      aria-label={removeAriaLabel}
      disabled={removeDisabled}
      title={removeTitle}
      onClick={removeCallback}
    >
      <X aria-hidden="true" />
    </button>
  </div>
)
