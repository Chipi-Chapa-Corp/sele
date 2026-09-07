import { forwardRef, useRef, type InputHTMLAttributes } from 'react'
import './Input.css'

type InputProps = InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, onFocus, ...inputProps }, ref) => {
    const cancelFocusRetryRef = useRef<(() => void) | null>(null)

    return (
      <input
        ref={ref}
        className={['ui-input', className].filter(Boolean).join(' ')}
        {...inputProps}
        onFocus={(event) => {
          const input = event.currentTarget
          const document = input.ownerDocument
          const window = document.defaultView

          cancelFocusRetryRef.current?.()
          if (window) {
            // Electron can show DOM focus while keyboard focus remains in another view.
            window.focus()
            const frame = window.requestAnimationFrame(() => {
              cancelFocusRetryRef.current = null
              // Let this one-shot callback discard detached inputs itself. Effect cleanup
              // also runs on Strict Mode's simulated unmount and would cancel live repairs.
              if (!input.isConnected || input.disabled || document.activeElement !== input) return

              window.focus()
              input.focus({ preventScroll: true })
              // Selection cleanup elsewhere can remove Chromium's editing caret without
              // blurring the input. Focusing an already focused input does not restore it.
              if (document.getSelection()?.rangeCount === 0) {
                const { selectionStart, selectionEnd, selectionDirection } = input
                if (selectionStart !== null && selectionEnd !== null) {
                  input.setSelectionRange(
                    selectionStart,
                    selectionEnd,
                    selectionDirection ?? undefined
                  )
                }
              }
            })
            cancelFocusRetryRef.current = () => window.cancelAnimationFrame(frame)
          }

          onFocus?.(event)
        }}
      />
    )
  }
)

Input.displayName = 'Input'
