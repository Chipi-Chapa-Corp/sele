import type { ReactNode } from 'react'
import type { ButtonTheme, ButtonSize } from './Button.types'

export const getButtonClassName = (
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

export const getButtonGroupClassName = (
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

export const getMenuRootClassName = (
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

export const renderIcon = (icon: ReactNode, className: string): ReactNode =>
  icon ? (
    <span className={className} aria-hidden="true">
      {icon}
    </span>
  ) : null
