import { forwardRef } from 'react'
import type { ButtonProps } from './Button.types'
import { BasicButton } from './BasicButton'
import { DropdownButton } from './DropdownButton'
import './Button.css'

export type { ButtonDropdownAction } from './Button.types'
export { ButtonMenuRow } from './ButtonMenuRow'

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const Component =
    props.dropdownActions?.length || props.dropdownContent ? DropdownButton : BasicButton
  return <Component {...props} ref={ref} />
})
