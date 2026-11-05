import { AnimatePresence } from 'motion/react'
import { MotionSurface } from '../motion/MotionSurface'
import { ChevronDown } from 'lucide-react'
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  MouseEventHandler,
  ReactElement,
  ReactNode
} from 'react'
import { forwardRef, useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toCssRem } from '../cssUnits'
import './Button.css'

import { useCompactLayout } from '../useCompactLayout'
import { touchClickGuard } from '../touchInput'

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
  dropdownContent?: (close: () => void) => ReactNode
  dropdownOpen?: boolean
  onDropdownOpenChange?: (open: boolean) => void
  menuOnly?: boolean
  dropdownWidth?: number
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

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    callback,
    disabled = false,
    dropdownActions,
    dropdownContent,
    menuOnly = false,
    dropdownOpen,
    onDropdownOpenChange,
    dropdownWidth = 224,
    dropdownLabel = 'More actions',
    dropdownMenuAlign = 'start',
    dropdownPlacement = 'bottom',
    icon = null,
    label = null,
    onClick,
    onPointerDown,
    onPointerUp,
    onPointerMove,
    onPointerCancel,
    theme = 'secondary',
    size = 'normal',
    fill = false,
    ...buttonProps
  },
  forwardedRef
) {
  const touch = useRef<{ id: number; x: number; y: number } | null>(null)
  const ignoreTouchClickUntil = useRef(0)
  const reactId = useId().replace(/:/g, '')
  const buttonId = buttonProps.id ?? `button-${reactId}`
  const menuId = `${buttonId}-menu`
  const rootRef = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const compact = useCompactLayout()
  const [ownOpen, setOwnOpen] = useState(false)
  const open = dropdownOpen ?? ownOpen
  const onOpenChanged = useRef(onDropdownOpenChange)
  onOpenChanged.current = onDropdownOpenChange
  const setOpen = useCallback((value: boolean): void => {
    setOwnOpen(value)
    onOpenChanged.current?.(value)
  }, [])
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const menuLayout = useRef<() => CSSProperties>(() => ({}))
  useEffect(() => {
    if (open) setMenuStyle(menuLayout.current())
  }, [open])
  const enabledDropdownActions = dropdownActions?.filter((action) => !action.disabled) ?? []
  const hasDropdown = Boolean(dropdownActions?.length || dropdownContent)
  const dropdownDisabled = !dropdownContent && enabledDropdownActions.length === 0

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node

      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        // Content menus may open a portaled picker or dialog of their own.
        if (
          menuOnly &&
          target instanceof Element &&
          target.closest('dialog[open], [role="dialog"], [role="menu"], [role="listbox"]')
        )
          return
        setOpen(false)
        setMenuStyle(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)

    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open, menuOnly, setOpen])

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

      if (menuOnly || compact) setMenuStyle(menuLayout.current())
      else closeMenu()
    }

    const resizeMenu = (): void => {
      if (menuOnly || compact) setMenuStyle(menuLayout.current())
      else closeMenu()
    }
    window.addEventListener('resize', resizeMenu)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      window.removeEventListener('resize', resizeMenu)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [open, menuOnly, compact, setOpen])

  const getMenuStyle = (buttonRect: DOMRect): CSSProperties => {
    const viewportInset = 9.6
    const menuOffset = 4.8
    const maxMenuWidth = dropdownWidth
    const startLeft = Math.min(
      Math.max(viewportInset, buttonRect.left),
      Math.max(viewportInset, window.innerWidth - maxMenuWidth - viewportInset)
    )
    const nextMenuStyle: CSSProperties = {
      minWidth: menuOnly
        ? `min(${toCssRem(buttonRect.width)}, calc(100vw - 1.2rem))`
        : toCssRem(buttonRect.width)
    }

    if (dropdownPlacement === 'top') {
      nextMenuStyle.bottom = toCssRem(window.innerHeight - buttonRect.top + menuOffset)
    } else {
      nextMenuStyle.top = toCssRem(buttonRect.bottom + menuOffset)
    }

    if (dropdownContent) {
      const width = Math.min(maxMenuWidth, window.innerWidth - 2 * viewportInset)
      const left = dropdownMenuAlign === 'end' ? buttonRect.right - width : buttonRect.left
      nextMenuStyle.width = toCssRem(width)
      if (compact) nextMenuStyle.minWidth = toCssRem(width)
      nextMenuStyle.left = toCssRem(
        Math.max(viewportInset, Math.min(left, window.innerWidth - width - viewportInset))
      )
    } else if (dropdownMenuAlign === 'end') {
      nextMenuStyle.right = toCssRem(Math.max(viewportInset, window.innerWidth - buttonRect.right))
    } else {
      nextMenuStyle.left = toCssRem(startLeft)
    }

    if (compact) {
      const height = Math.min(
        menuRef.current?.getBoundingClientRect().height || 200,
        window.innerHeight - viewportInset * 2
      )
      const below = buttonRect.bottom + menuOffset
      const above = buttonRect.top - menuOffset - height
      const preferAbove =
        dropdownPlacement === 'top' || below + height > window.innerHeight - viewportInset
      const top = preferAbove && above >= viewportInset ? above : below
      delete nextMenuStyle.bottom
      nextMenuStyle.top = toCssRem(
        Math.max(viewportInset, Math.min(top, window.innerHeight - viewportInset - height))
      )
    }
    return nextMenuStyle
  }
  menuLayout.current = () => {
    const rect = rootRef.current?.getBoundingClientRect()
    return rect ? getMenuStyle(rect) : {}
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

  const preserveTouchEditing: React.PointerEventHandler<HTMLButtonElement> = (event) => {
    touchClickGuard(event.currentTarget.ownerDocument).until = 0
    onPointerDown?.(event)
    if (event.pointerType === 'touch' && event.isPrimary)
      touch.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    // Moving focus to a button hides Android's keyboard before touch-up. The
    // resulting resize can cancel clicks on Send, Save, and editor actions.
    // Let the completed action move focus or close its editing surface instead.
    if (
      event.pointerType === 'touch' &&
      document.activeElement?.matches('input, textarea, [contenteditable="true"]')
    )
      event.preventDefault()
  }

  const activate: MouseEventHandler<HTMLButtonElement> = (event): void => {
    onClick?.(event)
    if (event.defaultPrevented) return

    void callback()
  }

  const isTouchCompatibilityClick = (event: React.MouseEvent<HTMLButtonElement>): boolean => {
    const native = event.nativeEvent as MouseEvent & {
      pointerType?: string
      sourceCapabilities?: { firesTouchEvents?: boolean }
    }
    return (
      performance.now() < ignoreTouchClickUntil.current &&
      (native.pointerType === 'touch' || native.sourceCapabilities?.firesTouchEvents === true)
    )
  }
  const handleClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    if (isTouchCompatibilityClick(event)) {
      event.preventDefault()
      return
    }
    activate(event)
  }
  const handleTouchMove: React.PointerEventHandler<HTMLButtonElement> = (event) => {
    onPointerMove?.(event)
    const start = touch.current
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10)
      touch.current = null
  }
  const handleTouchCancel: React.PointerEventHandler<HTMLButtonElement> = (event) => {
    touch.current = null
    onPointerCancel?.(event)
  }
  const handleTouchEnd: React.PointerEventHandler<HTMLButtonElement> = (event) => {
    onPointerUp?.(event)
    const start = touch.current
    touch.current = null
    if (!start || start.id !== event.pointerId || event.defaultPrevented || disabled) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      return
    // Android may retarget its delayed compatibility click after an IME/layout
    // change. Complete the actual touch once, without relying on that later hit test.
    ignoreTouchClickUntil.current = performance.now() + 1000
    touchClickGuard(event.currentTarget.ownerDocument).until = ignoreTouchClickUntil.current
    if (event.currentTarget === toggleRef.current) handleToggleClick()
    else activate(event)
    event.preventDefault()
  }
  const handleToggleClick = (event?: React.MouseEvent<HTMLButtonElement>): void => {
    if (event && isTouchCompatibilityClick(event)) {
      event.preventDefault()
      return
    }
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
    if (event.defaultPrevented) return
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

  if (hasDropdown) {
    const menu =
      open && (dropdownActions || dropdownContent) ? (
        <div
          ref={menuRef}
          className={getMenuRootClassName(theme, size, dropdownPlacement, dropdownMenuAlign)}
          style={menuStyle ?? undefined}
        >
          <MotionSurface
            className="ui-button-menu"
            id={menuId}
            role={dropdownContent ? 'dialog' : 'menu'}
            aria-label={dropdownContent ? dropdownLabel : undefined}
            aria-labelledby={dropdownContent ? undefined : buttonId}
            onKeyDown={handleMenuKeyDown}
          >
            {dropdownContent?.(closeMenu)}
            {dropdownActions?.map((action) =>
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
          </MotionSurface>
        </div>
      ) : null

    return (
      <span
        className={getButtonGroupClassName(theme, size, fill, open)}
        ref={rootRef}
        data-button-menu-root="true"
      >
        {menuOnly ? (
          <button
            {...buttonProps}
            ref={toggleRef}
            id={buttonId}
            type="button"
            className={getButtonClassName(theme, size, icon, label, fill)}
            aria-controls={open ? menuId : undefined}
            aria-expanded={open}
            aria-haspopup={dropdownContent ? 'dialog' : 'menu'}
            disabled={disabled || dropdownDisabled}
            onClick={handleToggleClick}
            onPointerDown={preserveTouchEditing}
            onPointerUp={handleTouchEnd}
            onPointerMove={handleTouchMove}
            onPointerCancel={handleTouchCancel}
            onKeyDown={handleToggleKeyDown}
          >
            {renderIcon(icon, 'ui-button__icon')}
            {label && <span className="ui-button__label">{label}</span>}
          </button>
        ) : (
          <>
            <button
              {...buttonProps}
              onPointerDown={preserveTouchEditing}
              onPointerUp={handleTouchEnd}
              onPointerMove={handleTouchMove}
              onPointerCancel={handleTouchCancel}
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
              aria-haspopup={dropdownContent ? 'dialog' : 'menu'}
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
              onPointerDown={preserveTouchEditing}
              onPointerUp={handleTouchEnd}
              onPointerMove={handleTouchMove}
              onPointerCancel={handleTouchCancel}
              onKeyDown={handleToggleKeyDown}
            >
              {renderIcon(<ChevronDown aria-hidden="true" />, 'ui-button__icon')}
            </button>
          </>
        )}
        {createPortal(<AnimatePresence>{menu}</AnimatePresence>, document.body)}
      </span>
    )
  }

  return (
    <button
      {...buttonProps}
      onPointerDown={preserveTouchEditing}
      onPointerUp={handleTouchEnd}
      onPointerMove={handleTouchMove}
      onPointerCancel={handleTouchCancel}
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
