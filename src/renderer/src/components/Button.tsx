import { ChevronDown } from 'lucide-react'
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  MouseEventHandler,
  ReactElement,
  ReactNode
} from 'react'
import { forwardRef, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './Button.css'

export type ButtonTheme = 'primary' | 'secondary' | 'transparent'
export type ButtonSize = 'normal' | 'small'
export type ButtonDropdownInlineAction = {
  id: string
  ariaLabel: string
  callback: () => Promise<void> | void
  disabled?: boolean
  icon: ReactNode
  title?: string
}
export type ButtonDropdownAction = {
  id: string
  label: ReactNode
  callback: () => Promise<void> | void
  buttonTheme?: ButtonTheme
  disabled?: boolean
  icon?: ReactNode
  inlineActions?: readonly ButtonDropdownInlineAction[]
  title?: string
}

export type ButtonMenuRowProps = {
  className?: string
  disabled?: boolean
  endAdornment?: ReactNode
  icon?: ReactNode
  inlineActionRole?: 'menuitem'
  inlineActions?: readonly ButtonDropdownInlineAction[]
  label: ReactNode
  labelClassName?: string
  mainAriaSelected?: boolean
  mainId?: string
  mainRole?: 'menuitem' | 'option'
  onMouseEnter?: MouseEventHandler<HTMLDivElement>
  onSelect?: () => Promise<void> | void
  title?: string
}

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'className' | 'onClick' | 'type'
>

type ButtonProps = NativeButtonProps & {
  callback: () => Promise<void> | void
  icon?: ReactNode
  label?: ReactNode
  theme?: ButtonTheme
  size?: ButtonSize
  fill?: boolean
  dropdownActions?: readonly ButtonDropdownAction[]
  dropdownLabel?: string
  dropdownMenuAlign?: 'start' | 'end'
  dropdownPlacement?: 'bottom' | 'top'
  onClick?: MouseEventHandler<HTMLButtonElement>
}

const getButtonClassName = (
  theme: ButtonTheme,
  size: ButtonSize,
  icon: ReactNode,
  label: ReactNode,
  fill: boolean,
  splitPart?: 'main' | 'toggle'
): string =>
  [
    'ui-button',
    `ui-button--${theme}`,
    `ui-button--${size}`,
    icon && !label ? 'ui-button--icon-only' : null,
    fill ? 'ui-button--fill' : null,
    splitPart ? `ui-button--split-${splitPart}` : null
  ]
    .filter(Boolean)
    .join(' ')

const getButtonGroupClassName = (
  theme: ButtonTheme,
  size: ButtonSize,
  fill: boolean,
  open: boolean
): string =>
  [
    'ui-button-group',
    `ui-button-group--${theme}`,
    `ui-button-group--${size}`,
    fill ? 'ui-button-group--fill' : null,
    open ? 'ui-button-group--open' : null
  ]
    .filter(Boolean)
    .join(' ')

const getMenuRootClassName = (
  theme: ButtonTheme,
  size: ButtonSize,
  placement: 'bottom' | 'top',
  menuAlign: 'start' | 'end'
): string =>
  [
    'ui-button-menu-root',
    `ui-button-menu-root--${theme}`,
    `ui-button-menu-root--${size}`,
    `ui-button-menu-root--${placement}`,
    `ui-button-menu-root--${menuAlign}`
  ].join(' ')

const renderIcon = (icon: ReactNode, className: string): ReactNode =>
  icon ? (
    <span className={className} aria-hidden="true">
      {icon}
    </span>
  ) : null

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
          '--ui-button-menu-row-main-padding-inline-end': `${
            16 + inlineActions.length * 26 + Math.max(0, inlineActions.length - 1) * 2
          }px`
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

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    callback,
    disabled = false,
    dropdownActions,
    dropdownLabel = 'More actions',
    dropdownMenuAlign = 'start',
    dropdownPlacement = 'bottom',
    icon = null,
    label = null,
    onClick,
    theme = 'secondary',
    size = 'normal',
    fill = false,
    ...buttonProps
  },
  forwardedRef
) {
  const reactId = useId().replace(/:/g, '')
  const buttonId = buttonProps.id ?? `button-${reactId}`
  const menuId = `${buttonId}-menu`
  const rootRef = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const enabledDropdownActions = dropdownActions?.filter((action) => !action.disabled) ?? []
  const hasDropdownActions = Boolean(dropdownActions?.length)
  const dropdownDisabled = enabledDropdownActions.length === 0

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node

      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
        setMenuStyle(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)

    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  useEffect(() => {
    if (!open) return

    const closeMenu = (): void => {
      setOpen(false)
      setMenuStyle(null)
    }

    const handleScroll = (event: Event): void => {
      const target = event.target
      const root = rootRef.current

      if (target instanceof Node) {
        if (menuRef.current?.contains(target)) return
        if (root && !target.contains(root)) return
      }

      closeMenu()
    }

    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [open])

  const getMenuStyle = (buttonRect: DOMRect): CSSProperties => {
    const viewportInset = 12
    const menuOffset = 6
    const maxMenuWidth = 280
    const startLeft = Math.min(
      Math.max(viewportInset, buttonRect.left),
      Math.max(viewportInset, window.innerWidth - maxMenuWidth - viewportInset)
    )
    const nextMenuStyle: CSSProperties = {
      minWidth: buttonRect.width
    }

    if (dropdownPlacement === 'top') {
      nextMenuStyle.bottom = window.innerHeight - buttonRect.top + menuOffset
    } else {
      nextMenuStyle.top = buttonRect.bottom + menuOffset
    }

    if (dropdownMenuAlign === 'end') {
      nextMenuStyle.right = Math.max(viewportInset, window.innerWidth - buttonRect.right)
    } else {
      nextMenuStyle.left = startLeft
    }

    return nextMenuStyle
  }

  const openMenu = (): void => {
    if (dropdownDisabled || typeof window === 'undefined') return

    const buttonRect = rootRef.current?.getBoundingClientRect()
    if (!buttonRect) return

    setMenuStyle(getMenuStyle(buttonRect))
    setOpen(true)
  }

  const closeMenu = (): void => {
    setOpen(false)
    setMenuStyle(null)
  }

  const handleClick: MouseEventHandler<HTMLButtonElement> = (event): void => {
    onClick?.(event)
    if (event.defaultPrevented) return

    void callback()
  }

  const handleToggleClick = (): void => {
    if (open) {
      closeMenu()
      return
    }

    openMenu()
  }

  const handleToggleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openMenu()
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault()
      closeMenu()
    }
  }

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
      toggleRef.current?.focus({ preventScroll: true })
    }
  }

  const handleActionClick = (action: ButtonDropdownAction): void => {
    if (action.disabled) return

    closeMenu()
    void action.callback()
  }

  const handleInlineActionClick = (action: ButtonDropdownInlineAction): void => {
    if (action.disabled) return

    closeMenu()
    void action.callback()
  }

  if (hasDropdownActions) {
    const menu =
      open && dropdownActions ? (
        <div
          ref={menuRef}
          className={getMenuRootClassName(theme, size, dropdownPlacement, dropdownMenuAlign)}
          style={menuStyle ?? undefined}
        >
          <div
            className="ui-button-menu"
            id={menuId}
            role="menu"
            aria-labelledby={buttonId}
            onKeyDown={handleMenuKeyDown}
          >
            {dropdownActions.map((action) =>
              action.inlineActions?.length ? (
                <ButtonMenuRow
                  disabled={action.disabled}
                  icon={action.icon}
                  inlineActionRole="menuitem"
                  inlineActions={action.inlineActions.map((inlineAction) => ({
                    ...inlineAction,
                    callback: () => handleInlineActionClick(inlineAction)
                  }))}
                  key={action.id}
                  label={action.label}
                  mainRole="menuitem"
                  title={action.title}
                  onSelect={() => handleActionClick(action)}
                />
              ) : action.buttonTheme ? (
                <button
                  className={`${getButtonClassName(
                    action.buttonTheme,
                    'small',
                    action.icon,
                    action.label,
                    true
                  )} ui-button-menu__button-item`}
                  disabled={action.disabled}
                  key={action.id}
                  role="menuitem"
                  title={action.title}
                  type="button"
                  onClick={() => handleActionClick(action)}
                >
                  {renderIcon(action.icon, 'ui-button__icon')}
                  <span className="ui-button__label">{action.label}</span>
                </button>
              ) : (
                <button
                  className="ui-button-menu__item"
                  disabled={action.disabled}
                  key={action.id}
                  role="menuitem"
                  title={action.title}
                  type="button"
                  onClick={() => handleActionClick(action)}
                >
                  {renderIcon(action.icon, 'ui-button-menu__icon')}
                  <span className="ui-button-menu__label">{action.label}</span>
                </button>
              )
            )}
          </div>
        </div>
      ) : null

    return (
      <span
        className={getButtonGroupClassName(theme, size, fill, open)}
        ref={rootRef}
        data-button-menu-root="true"
      >
        <button
          {...buttonProps}
          aria-haspopup={undefined}
          className={getButtonClassName(theme, size, icon, label, false, 'main')}
          disabled={disabled}
          id={buttonId}
          ref={forwardedRef}
          type="button"
          onClick={handleClick}
        >
          {renderIcon(icon, 'ui-button__icon')}
          {label && <span className="ui-button__label">{label}</span>}
        </button>
        <button
          aria-controls={open ? menuId : undefined}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={dropdownLabel}
          className={getButtonClassName(
            theme,
            size,
            <ChevronDown aria-hidden="true" />,
            null,
            false,
            'toggle'
          )}
          disabled={dropdownDisabled}
          ref={toggleRef}
          title={dropdownLabel}
          type="button"
          onClick={handleToggleClick}
          onKeyDown={handleToggleKeyDown}
        >
          {renderIcon(<ChevronDown aria-hidden="true" />, 'ui-button__icon')}
        </button>
        {menu && createPortal(menu, document.body)}
      </span>
    )
  }

  return (
    <button
      {...buttonProps}
      className={getButtonClassName(theme, size, icon, label, fill)}
      disabled={disabled}
      id={buttonProps.id}
      ref={forwardedRef}
      type="button"
      onClick={handleClick}
    >
      {renderIcon(icon, 'ui-button__icon')}
      {label && <span className="ui-button__label">{label}</span>}
    </button>
  )
})
