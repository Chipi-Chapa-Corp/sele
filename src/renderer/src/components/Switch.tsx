import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import './Switch.css'

type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'role' | 'type'> & {
  className?: string
  label?: ReactNode
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, disabled, label, ...inputProps }, ref) => (
    <label
      className={['ui-switch', label ? 'ui-switch--with-label' : null, className]
        .filter(Boolean)
        .join(' ')}
      data-disabled={disabled ? 'true' : undefined}
    >
      {label && <span className="ui-switch__label">{label}</span>}
      <input ref={ref} type="checkbox" role="switch" disabled={disabled} {...inputProps} />
      <span className="ui-switch__control" aria-hidden="true" />
    </label>
  )
)

Switch.displayName = 'Switch'
