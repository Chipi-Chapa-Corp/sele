import type { CSSProperties, ReactElement } from 'react'
import type { ButtonMenuRowProps } from './Button.types'
import { toCssRem } from '../cssUnits'
import { getButtonClassName, renderIcon } from './buttonStyles'

export const ButtonMenuRow = ({
  className,
  disabled = false,
  endAdornment = null,
  icon = null,
  inlineActionRole,
  inlineActions = [],
  label,
  labelClassName,
  mainAriaSelected,
  mainId,
  mainRole,
  onMouseEnter,
  onSelect,
  title
}: ButtonMenuRowProps): ReactElement => {
  const interactive = Boolean(onSelect)
  const rowClassName = [
    'ui-button-menu__row',
    interactive ? 'ui-button-menu__row--interactive' : 'ui-button-menu__row--static',
    className
  ]
    .filter(Boolean)
    .join(' ')
  const mainClassName = [
    'ui-button-menu__item',
    'ui-button-menu__item--row-main',
    interactive ? null : 'ui-button-menu__item--row-static'
  ]
    .filter(Boolean)
    .join(' ')
  const labelClassNames = ['ui-button-menu__label', labelClassName].filter(Boolean).join(' ')
  const mainStyle =
    inlineActions.length > 0
      ? ({
          '--ui-button-menu-inline-action-count': inlineActions.length,
          '--ui-button-menu-row-main-padding-inline-end': toCssRem(
            12.8 + inlineActions.length * 20.8 + Math.max(0, inlineActions.length - 1) * 1.6
          )
        } as CSSProperties)
      : undefined

  const handleSelect = (): void => {
    if (!onSelect || disabled) return

    void onSelect()
  }

  return (
    <div className={rowClassName} role="presentation" onMouseEnter={onMouseEnter}>
      {interactive ? (
        <button
          aria-selected={mainAriaSelected}
          className={mainClassName}
          disabled={disabled}
          id={mainId}
          role={mainRole}
          style={mainStyle}
          title={title}
          type="button"
          onClick={handleSelect}
        >
          {renderIcon(icon, 'ui-button-menu__icon')}
          <span className={labelClassNames}>{label}</span>
          {endAdornment && (
            <span className="ui-button-menu__end-adornment" aria-hidden="true">
              {endAdornment}
            </span>
          )}
        </button>
      ) : (
        <span className={mainClassName} style={mainStyle} title={title}>
          {renderIcon(icon, 'ui-button-menu__icon')}
          <span className={labelClassNames}>{label}</span>
          {endAdornment && (
            <span className="ui-button-menu__end-adornment" aria-hidden="true">
              {endAdornment}
            </span>
          )}
        </span>
      )}
      {inlineActions.length > 0 && (
        <span className="ui-button-menu__inline-actions" role="presentation">
          {inlineActions.map((inlineAction) => (
            <button
              className={`${getButtonClassName(
                'transparent',
                'small',
                inlineAction.icon,
                null,
                false
              )} ui-button-menu__inline-action`}
              disabled={inlineAction.disabled}
              key={inlineAction.id}
              type="button"
              role={inlineActionRole}
              aria-label={inlineAction.ariaLabel}
              title={inlineAction.title}
              onClick={() => {
                if (inlineAction.disabled) return

                void inlineAction.callback()
              }}
            >
              {renderIcon(inlineAction.icon, 'ui-button__icon')}
            </button>
          ))}
        </span>
      )}
    </div>
  )
}
