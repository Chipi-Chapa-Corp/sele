import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Clock3, X } from 'lucide-react'
import { formatSemanticLexicalDateDifference, useSemanticDateNow } from '../semanticDateDifference'
import { Button } from './Button'
import { PopupWindow } from './PopupWindow'
import { Textarea } from './Textarea'
import './ChatGoalButton.css'
import './LimitResetQueueButton.css'

type LimitResetQueueButtonProps = {
  disabled?: boolean
  resetsAt: number | null
  onOpen?: () => void
  onQueue: (prompt: string) => Promise<void>
}

export const LimitResetQueueButton: React.FC<LimitResetQueueButtonProps> = ({
  disabled = false,
  resetsAt,
  onOpen,
  onQueue
}) => {
  const id = useId()
  const now = useSemanticDateNow()
  const reset = formatSemanticLexicalDateDifference(resetsAt, { now, compact: true })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const savingRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return

    dialog.showModal()
    inputRef.current?.focus({ preventScroll: true })
    return () => {
      dialog.close()
      buttonRef.current?.focus({ preventScroll: true })
    }
  }, [open])

  const close = (): void => {
    if (!savingRef.current) setOpen(false)
  }

  const save = async (): Promise<void> => {
    const value = draft.trim()
    if (!value || savingRef.current || disabled) return

    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      await onQueue(value)
      setOpen(false)
    } catch (error) {
      console.error('[caught:LimitResetQueueButton:save]', error)
      setError(error instanceof Error ? error.message : 'Unable to queue prompt.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        ref={buttonRef}
        theme="secondary"
        aria-label="On Limit Reset"
        title="On Limit Reset"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-dialog` : undefined}
        disabled={disabled}
        icon={<Clock3 aria-hidden="true" />}
        callback={() => {
          setDraft('')
          setError(null)
          setOpen(true)
          onOpen?.()
        }}
      />
      {open &&
        createPortal(
          <PopupWindow>
            <dialog
              ref={dialogRef}
              id={`${id}-dialog`}
              className="chat-goal-dialog"
              aria-labelledby={`${id}-title`}
              onClose={() => setOpen(false)}
              onCancel={(event) => {
                event.preventDefault()
                event.stopPropagation()
                close()
              }}
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) close()
              }}
            >
              <form
                className="chat-goal-dialog__form"
                onSubmit={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void save()
                }}
              >
                <header className="chat-goal-dialog__header">
                  <div className="limit-reset-dialog__heading">
                    <h2 id={`${id}-title`}>On Limit Reset</h2>
                    {reset ? (
                      <time
                        className="limit-reset-dialog__time"
                        dateTime={reset.dateTime}
                        title={reset.title}
                      >
                        {reset.label}
                      </time>
                    ) : (
                      <span className="limit-reset-dialog__time">Reset time unavailable</span>
                    )}
                  </div>
                  <Button
                    theme="transparent"
                    size="small"
                    aria-label="Close reset queue window"
                    title="Close"
                    disabled={saving}
                    icon={<X aria-hidden="true" />}
                    callback={close}
                  />
                </header>
                <div className="chat-goal-dialog__body">
                  <label htmlFor={`${id}-objective`}>Prompt</label>
                  <Textarea
                    ref={inputRef}
                    id={`${id}-objective`}
                    value={draft}
                    placeholder="What should happen when the limit resets?"
                    rows={4}
                    disabled={saving}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault()
                        event.stopPropagation()
                        void save()
                      }
                    }}
                  />
                  {error && (
                    <p className="chat-goal-dialog__error" role="alert">
                      {error}
                    </p>
                  )}
                </div>
                <footer className="chat-goal-dialog__footer">
                  <Button theme="secondary" label="Cancel" disabled={saving} callback={close} />
                  <Button
                    theme="primary"
                    label={saving ? 'Saving…' : 'Add to queue'}
                    disabled={disabled || saving || !draft.trim()}
                    callback={save}
                  />
                </footer>
              </form>
            </dialog>
          </PopupWindow>,
          document.body
        )}
    </>
  )
}
