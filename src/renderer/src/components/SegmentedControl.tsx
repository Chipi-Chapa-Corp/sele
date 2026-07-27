import { type CSSProperties, type ReactNode } from 'react'
import './SegmentedControl.css'

export type SegmentedControlOption<TValue extends string = string> = {
  value: TValue
  label: ReactNode
  actionAriaLabel?: string
  actionCallback?: () => Promise<void> | void
  actionIcon?: ReactNode
  actionTitle?: string
  ariaLabel?: string
  icon?: ReactNode
  title?: string
  disabled?: boolean
}

type SegmentedControlProps<TValue extends string = string> = {
  'aria-label': string
  className?: string
  disabled?: boolean
  options: readonly SegmentedControlOption<TValue>[]
  size?: 'normal' | 'small'
  value: TValue
  onChange: (value: TValue) => void
}

export const SegmentedControl = <TValue extends string>({
  'aria-label': ariaLabel,
  className,
  disabled = false,
  options,
  size = 'normal',
  value,
  onChange
}: SegmentedControlProps<TValue>): React.ReactElement => {
  const style = {
    '--ui-segmented-control-count': Math.max(options.length, 1)
  } as CSSProperties

  return (
    <div
      className={['ui-segmented-control', `ui-segmented-control--${size}`, className]
        .filter(Boolean)
        .join(' ')}
      role="group"
      aria-label={ariaLabel}
      style={style}
    >
      {options.map((option) => {
        const selected = option.value === value
        const hasAction = Boolean(option.actionIcon && option.actionCallback)
        const actionEnabled = hasAction && !disabled && !option.disabled

        return (
          <div
            className={`ui-segmented-control__item${
              selected ? ' ui-segmented-control__item--active' : ''
            }`}
            key={option.value}
            onMouseDown={(event) => {
              if (event.button === 1 && actionEnabled) event.preventDefault()
            }}
            onAuxClick={(event) => {
              if (event.button !== 1 || !actionEnabled) return
              event.preventDefault()
              void option.actionCallback?.()
            }}
          >
            <button
              className={[
                'ui-segmented-control__option',
                selected ? 'ui-segmented-control__option--active' : null,
                hasAction ? 'ui-segmented-control__option--with-action' : null
              ]
                .filter(Boolean)
                .join(' ')}
              type="button"
              aria-label={option.ariaLabel}
              aria-pressed={selected}
              title={option.title}
              disabled={disabled || option.disabled}
              onClick={() => onChange(option.value)}
            >
              {option.icon && (
                <span className="ui-segmented-control__icon" aria-hidden="true">
                  {option.icon}
                </span>
              )}
              {option.label && <span className="ui-segmented-control__label">{option.label}</span>}
            </button>
            {hasAction && (
              <button
                className="ui-segmented-control__action"
                type="button"
                aria-label={option.actionAriaLabel ?? option.actionTitle ?? 'Option action'}
                title={option.actionTitle}
                disabled={disabled || option.disabled}
                onClick={() => void option.actionCallback?.()}
              >
                <span aria-hidden="true">{option.actionIcon}</span>
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
