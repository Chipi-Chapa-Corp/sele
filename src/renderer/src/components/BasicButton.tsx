import { forwardRef } from 'react'
import type { ButtonProps } from './Button.types'
import { getButtonClassName, renderIcon } from './buttonStyles'
import { useButtonPointer } from './useButtonPointer'

/** Native button behavior without any dropdown state, subscriptions, or effects. */
export const BasicButton = forwardRef<HTMLButtonElement, ButtonProps>(function BasicButton(
  {
    callback,
    disabled = false,
    icon = null,
    label = null,
    theme = 'secondary',
    size = 'normal',
    fill = false,
    onClick,
    onPointerDown,
    onPointerUp,
    onPointerMove,
    onPointerCancel,
    dropdownActions: _actions,
    dropdownContent: _content,
    dropdownOpen: _open,
    onDropdownOpenChange: _openChanged,
    menuOnly: _menuOnly,
    dropdownWidth: _width,
    dropdownLabel: _label,
    dropdownMenuAlign: _align,
    dropdownPlacement: _placement,
    ...buttonProps
  },
  ref
) {
  const { preserveTouchEditing, handleClick, handleTouchEnd, handleTouchMove, handleTouchCancel } =
    useButtonPointer({
      callback,
      disabled,
      onClick,
      onPointerDown,
      onPointerUp,
      onPointerMove,
      onPointerCancel
    })
  return (
    <button
      {...buttonProps}
      ref={ref}
      type="button"
      disabled={disabled}
      className={getButtonClassName(theme, size, icon, label, fill)}
      onClick={handleClick}
      onPointerDown={preserveTouchEditing}
      onPointerUp={handleTouchEnd}
      onPointerMove={handleTouchMove}
      onPointerCancel={handleTouchCancel}
    >
      {renderIcon(icon, 'ui-button__icon')}
      {label && <span className="ui-button__label">{label}</span>}
    </button>
  )
})
