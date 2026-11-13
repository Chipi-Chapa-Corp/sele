import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Target, X } from 'lucide-react'
import { Button } from './Button'
import { PopupWindow } from './PopupWindow'
import { Textarea } from './Textarea'
import './ChatGoalButton.css'

type PromptDialogButtonProps = {
  title: string
  icon: ReactNode
  triggerLabel: string | undefined
  disabled: boolean
  initialDraft: string
  headingDetail?: ReactNode
  closeLabel: string
  inputLabel: string
  placeholder: string
  submitLabel: string
  errorTag: string
  errorMessage: string
  onOpen?: () => void
  onSubmit: (value: string) => Promise<void>
}

export const PromptDialogButton: React.FC<PromptDialogButtonProps> = ({
  title,
  icon,
  triggerLabel,
  disabled,
  initialDraft,
  headingDetail,
  closeLabel,
  inputLabel,
  placeholder,
  submitLabel,
  errorTag,
  errorMessage,
  onOpen,
  onSubmit
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
      await onSubmit(value)
      setOpen(false)
    } catch (error) {
      console.error(errorTag, error)
      setError(error instanceof Error ? error.message : errorMessage)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const heading = <h2 id={`${id}-title`}>{title}</h2>

  return (
    <>
      <Button
        ref={buttonRef}
        theme="secondary"
        aria-label={title}
        label={triggerLabel}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-dialog` : undefined}
        disabled={disabled}
        icon={icon}
        callback={() => {
          setDraft(initialDraft)
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
                  {headingDetail ? (
                    <div className="limit-reset-dialog__heading">
                      {heading}
                      {headingDetail}
                    </div>
                  ) : (
                    heading
                  )}
                  <Button
                    theme="transparent"
                    size="small"
                    aria-label={closeLabel}
                    title="Close"
                    disabled={saving}
                    icon={<X aria-hidden="true" />}
                    callback={close}
                  />
                </header>
                <div className="chat-goal-dialog__body">
                  <label htmlFor={`${id}-objective`}>{inputLabel}</label>
                  <Textarea
                    ref={inputRef}
                    id={`${id}-objective`}
                    value={draft}
                    placeholder={placeholder}
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
                    label={saving ? 'Saving…' : submitLabel}
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

export const ChatGoalButton: React.FC<{
  triggerLabel?: string
  disabled?: boolean
  objective?: string | null
  onSetGoal: (objective: string) => Promise<void>
}> = ({ triggerLabel, disabled = false, objective, onSetGoal }) => (
  <PromptDialogButton
    title="Set goal"
    icon={<Target aria-hidden="true" />}
    triggerLabel={triggerLabel}
    disabled={disabled}
    initialDraft={objective ?? ''}
    closeLabel="Close goal window"
    inputLabel="Goal description"
    placeholder="Describe the goal…"
    submitLabel="Set goal"
    errorTag="[caught:ChatGoalButton:save]"
    errorMessage="Unable to set goal."
    onSubmit={onSetGoal}
  />
)
