import { useLayoutEffect, useRef } from 'react'
import { Button } from './Button'

export const UnsavedFileDialog = ({
  fileName,
  saving,
  error,
  onDiscard,
  onSave,
  onCancel
}: {
  fileName: string
  saving: boolean
  error: string | null
  onDiscard: () => void
  onSave: () => Promise<void>
  onCancel: () => void
}): React.JSX.Element => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus = document.activeElement
    dialog.showModal()
    cancelRef.current?.focus()
    return () => {
      dialog.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="file-editor-confirm"
      aria-label="Unsaved changes"
      onCancel={(event) => {
        event.preventDefault()
        if (!saving) onCancel()
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <h2>Save changes to {fileName}?</h2>
      <p>Your changes will be lost if you discard them.</p>
      {error && <p role="alert">{error}</p>}
      <div className="file-editor-confirm__actions">
        <Button label="Discard" disabled={saving} callback={onDiscard} />
        <Button
          label={saving ? 'Saving…' : 'Save'}
          disabled={saving}
          theme="primary"
          callback={onSave}
        />
        <Button ref={cancelRef} label="Cancel" disabled={saving} callback={onCancel} />
      </div>
    </dialog>
  )
}
