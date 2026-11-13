import { forwardRef, type TextareaHTMLAttributes } from 'react'
import './Textarea.css'

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...textareaProps }, ref) => (
  <textarea
    ref={ref}
    className={['ui-textarea', className].filter(Boolean).join(' ')}
    {...textareaProps}
  />
))

Textarea.displayName = 'Textarea'
