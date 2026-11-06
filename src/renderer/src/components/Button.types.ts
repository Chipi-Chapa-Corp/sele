import type { ButtonHTMLAttributes, MouseEventHandler, ReactNode } from 'react'

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

export type ButtonProps = NativeButtonProps & {
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
