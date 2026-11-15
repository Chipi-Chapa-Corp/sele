import { AnimatePresence } from 'motion/react'
import { MotionSurface } from '../motion/MotionSurface'
import { ChevronDown } from 'lucide-react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import { createPortal } from 'react-dom'
import { toCssRem } from '../cssUnits'
import { useCompactLayout } from '../useCompactLayout'
import type { ButtonProps, ButtonDropdownAction, ButtonDropdownInlineAction } from './Button.types'
import { ButtonMenuRow } from './ButtonMenuRow'
import {
  getButtonClassName,
  getButtonGroupClassName,
  getMenuRootClassName,
  renderIcon
} from './buttonStyles'
import { useButtonPointer } from './useButtonPointer'

export const DropdownButton = forwardRef<HTMLButtonElement, ButtonProps>(function DropdownButton(
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

    const resizeMenu = (): void => {
      if (menuOnly || compact) setMenuStyle(menuLayout.current())
      else {
        setOpen(false)
        setMenuStyle(null)
      }
    }

    const handleScroll = (event: Event): void => {
      const target = event.target
      const root = rootRef.current

      if (target instanceof Node) {
        if (menuRef.current?.contains(target)) return
        if (root && !target.contains(root)) return
      }

      resizeMenu()
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
    const startLeft = Math.min(
      Math.max(viewportInset, buttonRect.left),
      Math.max(viewportInset, window.innerWidth - dropdownWidth - viewportInset)
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
      const width = Math.min(dropdownWidth, window.innerWidth - 2 * viewportInset)
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
    if (dropdownDisabled) return

    const buttonRect = rootRef.current?.getBoundingClientRect()
    if (!buttonRect) return

    setMenuStyle(getMenuStyle(buttonRect))
    setOpen(true)
  }

  const closeMenu = (): void => {
    setOpen(false)
    setMenuStyle(null)
  }

  const {
    preserveTouchEditing,
    handleClick,
    handleTouchEnd,
    handleTouchMove,
    handleTouchCancel,
    isTouchCompatibilityClick
  } = useButtonPointer({
    callback,
    disabled,
    onClick,
    onPointerDown,
    onPointerUp,
    onPointerMove,
    onPointerCancel,
    toggleRef,
    onToggle: () => handleToggleClick()
  })
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

  const handleActionClick = (action: ButtonDropdownAction | ButtonDropdownInlineAction): void => {
    if (action.disabled) return

    closeMenu()
    void action.callback()
  }

  const menu = open ? (
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
                callback: () => handleActionClick(inlineAction)
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
})
