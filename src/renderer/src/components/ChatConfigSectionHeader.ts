import { createElement, Fragment, type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'

export type ChatConfigSectionHeaderProps = {
  modelError?: string | null
  onBack: () => void
}

export const ChatConfigSectionHeader = ({
  modelError,
  onBack
}: ChatConfigSectionHeaderProps): ReactNode =>
  createElement(
    Fragment,
    null,
    createElement(
      'div',
      { className: 'message-box__chat-config-header' },
      createElement(
        'button',
        { className: 'message-box__chat-config-back', type: 'button', onClick: onBack },
        createElement(ChevronLeft, { 'aria-hidden': 'true' }),
        createElement('span', null, 'Back')
      )
    ),
    modelError
      ? createElement(
          'div',
          { className: 'message-box__chat-config-error', role: 'alert' },
          modelError
        )
      : null
  )
