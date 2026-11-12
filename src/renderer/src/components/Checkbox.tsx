import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import './Checkbox.css'

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: ReactNode
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, ...inputProps }, ref) => {
    const input = (
      <input
        {...inputProps}
        ref={ref}
        type="checkbox"
        className={['ui-checkbox', className].filter(Boolean).join(' ')}
      />
    )

    return label == null ? (
      input
    ) : (
      <label className="ui-checkbox-field">
        {input}
        <span className="ui-checkbox__label">{label}</span>
      </label>
    )
  }
)

Checkbox.displayName = 'Checkbox'
