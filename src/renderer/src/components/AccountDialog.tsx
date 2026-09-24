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
  submitCode?: (code: string) => Promise<void>
}

type AccountDialogProps = {
  providerLabel: string
  onClose: () => void
  onLogin: (name: string) => Promise<AccountAuthorizationSession>
}

export const AccountDialog = ({
  providerLabel,
  onClose,
  onLogin
}: AccountDialogProps): ReactElement => {
  const inputRef = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  const authorizationRef = useRef<AccountAuthorizationSession | null>(null)
  const cancelingRef = useRef(false)
  const [name, setName] = useState('')
  const [phase, setPhase] = useState<'idle' | 'starting' | 'authorizing' | 'canceling'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [userCode, setUserCode] = useState<string | null>(null)
  const [authorization, setAuthorization] = useState<AccountAuthorizationSession | null>(null)
  const [authorizationActionPending, setAuthorizationActionPending] = useState(false)
  const [code, setCode] = useState('')
  const [codePending, setCodePending] = useState(false)

  useEffect(() => {
    mounted.current = true
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => {
      mounted.current = false
      window.cancelAnimationFrame(frame)
      void authorizationRef.current?.cancel().catch((error: unknown) => {
        console.error('Unable to cancel sign-in after closing the account dialog.', error)
      })
    }
  }, [])

  const handleLogin = async (): Promise<void> => {
    if (phase !== 'idle') return
    if (!name.trim()) {
      setError('Account name is required.')
      return
    }

    setPhase('starting')
    setCode('')
    cancelingRef.current = false
    setError(null)
    try {
      const session = await onLogin(name)
      if (!mounted.current) {
        void session.completion.catch((error: unknown) => {
          console.warn('Account authorization ended after closing its dialog.', error)
        })
        await session.cancel()
        return
      }
      authorizationRef.current = session
      setAuthorization(session)
      setUserCode(session.userCode)
      setPhase('authorizing')
      await session.completion
      authorizationRef.current = null
      if (!mounted.current) return
      onClose()
    } catch (loginError) {
      console.error('[caught:AccountDialog:handleLogin]', loginError)
      authorizationRef.current = null
      if (cancelingRef.current || !mounted.current) return
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
      authorizationRef.current = null
      onClose()
    } catch (cancelError) {
      console.error('[caught:AccountDialog:handleCancel]', cancelError)
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
      console.error('[caught:AccountDialog:handleAuthorize]', authorizationError)
      setError(
        authorizationError instanceof Error && authorizationError.message
          ? authorizationError.message
          : 'Unable to open authorization.'
      )
    } finally {
      setAuthorizationActionPending(false)
    }
  }

  const handleSubmitCode = async (): Promise<void> => {
    if (!authorization?.submitCode || !code.trim() || codePending || phase !== 'authorizing') return
    setCodePending(true)
    setError(null)
    try {
      await authorization.submitCode(code)
      setCode('')
    } catch (error) {
      console.error('Unable to submit the account authorization code.', error)
      setError(error instanceof Error ? error.message : 'Unable to submit authorization code.')
    } finally {
      setCodePending(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (phase === 'authorizing') void handleSubmitCode()
    else void handleLogin()
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
            ? `Authorize ${providerLabel} account`
            : `Create ${providerLabel} account`
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
              The account will be added only after {providerLabel} confirms that sign-in succeeded.
            </p>
            {authorization?.submitCode && (
              <>
                <label htmlFor="account-dialog-code">
                  If the browser gives you a code, paste it here
                </label>
                <Input
                  id="account-dialog-code"
                  type="password"
                  autoComplete="off"
                  value={code}
                  maxLength={4096}
                  disabled={phase !== 'authorizing' || codePending}
                  onChange={(event) => setCode(event.currentTarget.value)}
                />
                <Button
                  callback={handleSubmitCode}
                  label={codePending ? 'Submitting…' : 'Submit code'}
                  disabled={phase !== 'authorizing' || !code.trim() || codePending}
                  theme="secondary"
                />
              </>
            )}
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
