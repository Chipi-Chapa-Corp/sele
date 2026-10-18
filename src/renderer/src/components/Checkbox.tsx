import { forwardRef, useCallback, type InputHTMLAttributes, type ReactNode } from 'react'
import './Checkbox.css'

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: ReactNode
  indeterminate?: boolean
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, indeterminate = false, ...inputProps }, ref) => {
    const setRef = useCallback(
      (input: HTMLInputElement | null) => {
        if (input) input.indeterminate = indeterminate
        if (typeof ref === 'function') return ref(input)
        if (ref) ref.current = input
      },
      [ref, indeterminate]
    )
    const input = (
      <input
        {...inputProps}
        ref={setRef}
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
