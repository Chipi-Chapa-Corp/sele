import { ChevronRight } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './DisclosureToggle.css'

type DisclosureToggleProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-expanded' | 'children' | 'className' | 'type'
> & {
  children: ReactNode
  open: boolean
  className?: string
  chevronClassName?: string
}

const joinClassNames = (...classNames: Array<string | null | undefined | false>): string =>
  classNames.filter(Boolean).join(' ')

export const DisclosureToggle: React.FC<DisclosureToggleProps> = ({
  children,
  className,
  chevronClassName,
  open,
  ...buttonProps
}) => (
  <button
    {...buttonProps}
    className={joinClassNames(
      'ui-disclosure-toggle',
      open && 'ui-disclosure-toggle--open',
      className
    )}
    type="button"
    aria-expanded={open}
  >
    <ChevronRight
      className={joinClassNames('ui-disclosure-toggle__chevron', chevronClassName)}
      aria-hidden="true"
    />
    <span className="ui-disclosure-toggle__content">{children}</span>
  </button>
)
