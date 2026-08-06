import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, FolderOpen, X } from 'lucide-react'
import type { AppCreateSshEnvironmentOptions } from '../../../shared/app'
import { appApi } from '../appApi'
import { Button } from './Button'
import { Input } from './Input'
import './SshEnvironmentDialog.css'

type SshEnvironmentDialogProps = {
  open: boolean
  onClose: () => void
  onSave: (options: AppCreateSshEnvironmentOptions) => Promise<void>
}

type SshEnvironmentDraft = {
  name: string
  host: string
  port: string
  user: string
  identityFile: string
}

const emptyDraft: SshEnvironmentDraft = {
  name: '',
  host: '',
  port: '22',
  user: '',
  identityFile: ''
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'Unable to save SSH environment.'

export const SshEnvironmentDialog = ({
  open,
  onClose,
  onSave
}: SshEnvironmentDialogProps): React.ReactElement | null => {
  const reactId = useId().replace(/:/g, '')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<SshEnvironmentDraft>(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [selectingIdentity, setSelectingIdentity] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameInputId = `ssh-environment-name-${reactId}`
  const hostInputId = `ssh-environment-host-${reactId}`
  const userInputId = `ssh-environment-user-${reactId}`
  const portInputId = `ssh-environment-port-${reactId}`
  const identityInputId = `ssh-environment-identity-${reactId}`

  useEffect(() => {
    if (!open) return

    const frame = window.requestAnimationFrame(() => nameInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  const updateDraft = (update: Partial<SshEnvironmentDraft>): void => {
    setDraft((currentDraft) => ({ ...currentDraft, ...update }))
    setError(null)
  }

  const handleClose = (): void => {
    if (saving || selectingIdentity) return

    setDraft(emptyDraft)
    setError(null)
    onClose()
  }

  const handleSelectIdentity = async (): Promise<void> => {
    if (saving || selectingIdentity) return

    setSelectingIdentity(true)
    setError(null)
    try {
      const identityFile = await appApi.selectSshIdentityFile()
      if (identityFile) updateDraft({ identityFile })
    } catch (selectionError) {
      setError(getErrorMessage(selectionError))
    } finally {
      setSelectingIdentity(false)
    }
  }

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>): Promise<void> => {
    event?.preventDefault()
    if (saving) return

    const name = draft.name.trim()
    const host = draft.host.trim()
    const port = Number(draft.port)
    if (!name) {
      setError('Name is required.')
      return
    }
    if (!host) {
      setError('Host is required.')
      return
    }
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      setError('Port must be between 1 and 65535.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onSave({
        name,
        host,
        port,
        user: draft.user.trim() || null,
        identityFile: draft.identityFile.trim() || null
      })
      setDraft(emptyDraft)
      onClose()
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const dialog = (
    <div
      className="ssh-environment-dialog-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) handleClose()
      }}
    >
      <form
        className="ssh-environment-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add environment"
        onSubmit={(event) => void handleSubmit(event)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          handleClose()
        }}
      >
        <div className="ssh-environment-dialog__body">
          <div className="ssh-environment-dialog__label-row">
            <label htmlFor={nameInputId}>Name</label>
            <Button
              theme="transparent"
              size="small"
              aria-label="Close environment window"
              title="Close"
              disabled={saving || selectingIdentity}
              callback={handleClose}
              icon={<X aria-hidden="true" />}
            />
          </div>
          <Input
            id={nameInputId}
            ref={nameInputRef}
            value={draft.name}
            maxLength={80}
            placeholder="Development server"
            disabled={saving}
            onChange={(event) => updateDraft({ name: event.currentTarget.value })}
          />
          <div className="ssh-environment-dialog__connection-row">
            <label className="ssh-environment-dialog__field" htmlFor={hostInputId}>
              <span>Host</span>
              <Input
                id={hostInputId}
                value={draft.host}
                maxLength={253}
                placeholder="server.example.com"
                autoCapitalize="none"
                autoCorrect="off"
                disabled={saving}
                onChange={(event) => updateDraft({ host: event.currentTarget.value })}
              />
            </label>
            <label className="ssh-environment-dialog__field" htmlFor={portInputId}>
              <span>Port</span>
              <Input
                id={portInputId}
                type="number"
                inputMode="numeric"
                min={1}
                max={65_535}
                value={draft.port}
                disabled={saving}
                onChange={(event) => updateDraft({ port: event.currentTarget.value })}
              />
            </label>
          </div>
          <label className="ssh-environment-dialog__field" htmlFor={userInputId}>
            <span>
              User <small>Optional</small>
            </span>
            <Input
              id={userInputId}
              value={draft.user}
              maxLength={128}
              placeholder="deploy"
              autoCapitalize="none"
              autoCorrect="off"
              disabled={saving}
              onChange={(event) => updateDraft({ user: event.currentTarget.value })}
            />
          </label>
          <label className="ssh-environment-dialog__field" htmlFor={identityInputId}>
            <span>
              Identity file <small>Optional</small>
            </span>
            <span className="ssh-environment-dialog__identity-row">
              <Input
                id={identityInputId}
                value={draft.identityFile}
                placeholder="Use SSH config or ssh-agent"
                autoCapitalize="none"
                autoCorrect="off"
                disabled={saving || selectingIdentity}
                onChange={(event) => updateDraft({ identityFile: event.currentTarget.value })}
              />
              <Button
                theme="secondary"
                aria-label="Choose identity file"
                title="Choose identity file"
                disabled={saving || selectingIdentity}
                callback={() => void handleSelectIdentity()}
                icon={<FolderOpen aria-hidden="true" />}
              />
            </span>
          </label>
          {error && (
            <p className="ssh-environment-dialog__error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="ssh-environment-dialog__footer">
          <Button
            theme="secondary"
            label="Cancel"
            disabled={saving || selectingIdentity}
            callback={handleClose}
          />
          <Button
            theme="primary"
            label={saving ? 'Saving' : 'Save'}
            disabled={saving || selectingIdentity}
            callback={() => void handleSubmit()}
            icon={<Check aria-hidden="true" />}
          />
        </footer>
      </form>
    </div>
  )

  return createPortal(dialog, document.body)
}
