import { forwardRef, type TextareaHTMLAttributes } from 'react'
import './Textarea.css'

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...textareaProps }, ref) => (
    <textarea
      ref={ref}
      className={['ui-textarea', className].filter(Boolean).join(' ')}
      {...textareaProps}
    />
  )
)

Textarea.displayName = 'Textarea'
