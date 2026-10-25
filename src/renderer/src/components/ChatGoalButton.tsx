import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Target, X } from 'lucide-react'
import { Button } from './Button'
import { PopupWindow } from './PopupWindow'
import { Textarea } from './Textarea'
import './ChatGoalButton.css'

type ChatGoalButtonProps = {
  disabled?: boolean
  objective?: string | null
  onSetGoal: (objective: string) => Promise<void>
}

export const ChatGoalButton: React.FC<ChatGoalButtonProps> = ({
  disabled = false,
  objective = null,
  onSetGoal
}) => {
  const id = useId()
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
      await onSetGoal(value)
      setOpen(false)
    } catch (error) {
      console.error('[caught:ChatGoalButton:save]', error)
      setError(error instanceof Error ? error.message : 'Unable to set goal.')
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
        aria-label="Set goal"
        title="Set goal"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-dialog` : undefined}
        disabled={disabled}
        icon={<Target aria-hidden="true" />}
        callback={() => {
          setDraft(objective ?? '')
          setError(null)
          setOpen(true)
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
                  <h2 id={`${id}-title`}>Set goal</h2>
                  <Button
                    theme="transparent"
                    size="small"
                    aria-label="Close goal window"
                    title="Close"
                    disabled={saving}
                    icon={<X aria-hidden="true" />}
                    callback={close}
                  />
                </header>
                <div className="chat-goal-dialog__body">
                  <label htmlFor={`${id}-objective`}>Goal description</label>
                  <Textarea
                    ref={inputRef}
                    id={`${id}-objective`}
                    value={draft}
                    placeholder="Describe the goal…"
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
                    label={saving ? 'Saving…' : 'Set goal'}
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
