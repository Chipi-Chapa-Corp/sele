import { Copy, ExternalLink, LogIn, X } from 'lucide-react'
import { type FormEvent, type ReactElement, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import { Input } from './Input'
import './AccountDialog.css'

export type AccountAuthorizationSession = {
  userCode: string | null
  completion: Promise<void>
  authorize: () => Promise<void>
  cancel: () => Promise<void>
}

type AccountDialogProps = {
  onClose: () => void
  onLogin: (name: string) => Promise<AccountAuthorizationSession>
}

export const AccountDialog = ({ onClose, onLogin }: AccountDialogProps): ReactElement => {
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelingRef = useRef(false)
  const [name, setName] = useState('')
  const [phase, setPhase] = useState<'idle' | 'starting' | 'authorizing' | 'canceling'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [userCode, setUserCode] = useState<string | null>(null)
  const [authorization, setAuthorization] = useState<AccountAuthorizationSession | null>(null)
  const [authorizationActionPending, setAuthorizationActionPending] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const handleLogin = async (): Promise<void> => {
    if (phase !== 'idle') return
    if (!name.trim()) {
      setError('Account name is required.')
      return
    }

    setPhase('starting')
    cancelingRef.current = false
    setError(null)
    try {
      const session = await onLogin(name)
      setAuthorization(session)
      setUserCode(session.userCode)
      setPhase('authorizing')
      await session.completion
      onClose()
    } catch (loginError) {
      if (cancelingRef.current) return
      setError(
        loginError instanceof Error && loginError.message
          ? loginError.message
          : 'Unable to create the account.'
      )
      setAuthorization(null)
      setUserCode(null)
      setPhase('idle')
    }
  }

  const handleCancel = async (): Promise<void> => {
    if (phase !== 'authorizing' || !authorization) return
    cancelingRef.current = true
    setPhase('canceling')
    setError(null)
    try {
      await authorization.cancel()
      onClose()
    } catch (cancelError) {
      cancelingRef.current = false
      setError(
        cancelError instanceof Error && cancelError.message
          ? cancelError.message
          : 'Unable to cancel authorization.'
      )
      setPhase('authorizing')
    }
  }

  const handleAuthorize = async (): Promise<void> => {
    if (phase !== 'authorizing' || !authorization || authorizationActionPending) return
    setAuthorizationActionPending(true)
    setError(null)
    try {
      await authorization.authorize()
    } catch (authorizationError) {
      setError(
        authorizationError instanceof Error && authorizationError.message
          ? authorizationError.message
          : 'Unable to open authorization.'
      )
    } finally {
      setAuthorizationActionPending(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void handleLogin()
  }

  return createPortal(
    <div
      className="account-dialog-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && phase === 'idle') onClose()
      }}
    >
      <form
        className="account-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={
          phase === 'authorizing' || phase === 'canceling'
            ? 'Authorize Codex account'
            : 'Create Codex account'
        }
        onSubmit={handleSubmit}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key !== 'Escape' || phase !== 'idle') return
          event.preventDefault()
          onClose()
        }}
      >
        <div className="account-dialog__header">
          {phase === 'authorizing' || phase === 'canceling' ? (
            <span>Authorize account</span>
          ) : (
            <label htmlFor="account-dialog-name">Name</label>
          )}
          {phase === 'idle' && (
            <Button
              aria-label="Close account window"
              callback={onClose}
              icon={<X aria-hidden="true" />}
              size="small"
              theme="transparent"
              title="Close"
            />
          )}
        </div>
        {phase === 'authorizing' || phase === 'canceling' ? (
          <div className="account-dialog__authorization">
            <p>
              {userCode
                ? 'Copy the one-time code and complete authorization in your browser.'
                : 'Open the authorization page in your browser.'}{' '}
              The account will be added only after Codex confirms that sign-in succeeded.
            </p>
          </div>
        ) : (
          <Input
            id="account-dialog-name"
            ref={inputRef}
            value={name}
            disabled={phase !== 'idle'}
            maxLength={80}
            placeholder="Account name"
            onChange={(event) => {
              setName(event.currentTarget.value)
              setError(null)
            }}
          />
        )}
        {error && (
          <p className="account-dialog__error" role="alert">
            {error}
          </p>
        )}
        <div className="account-dialog__footer">
          {phase === 'authorizing' || phase === 'canceling' ? (
            <>
              <Button
                callback={handleCancel}
                disabled={phase === 'canceling'}
                label={phase === 'canceling' ? 'Canceling…' : 'Cancel'}
                theme="secondary"
              />
              <Button
                callback={handleAuthorize}
                disabled={phase === 'canceling' || authorizationActionPending}
                icon={userCode ? <Copy aria-hidden="true" /> : <ExternalLink aria-hidden="true" />}
                label={
                  authorizationActionPending
                    ? userCode
                      ? 'Copying…'
                      : 'Opening…'
                    : userCode
                      ? `Copy ${userCode}`
                      : 'Open'
                }
                theme="primary"
              />
            </>
          ) : (
            <Button
              callback={handleLogin}
              disabled={phase !== 'idle' || !name.trim()}
              icon={<LogIn aria-hidden="true" />}
              label={phase === 'starting' ? 'Starting…' : 'Log In'}
              theme="primary"
            />
          )}
        </div>
      </form>
    </div>,
    document.body
  )
}
