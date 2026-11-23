import { MotionSurface } from '../motion/MotionSurface'
import { Check, Copy, ExternalLink, LogIn, X } from 'lucide-react'
import {
  type FormEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import { PopupWindow } from './PopupWindow'
import { Input } from './Input'
import './AccountDialog.css'

export type AccountAuthorizationSession = {
  userCode: string | null
  completion: Promise<void>
  authorize: () => Promise<void>
  cancel: () => Promise<void>
  submitCode?: (code: string) => Promise<void>
  copyCode?: () => Promise<void>
  copyLink?: () => Promise<void>
}

type CopyTarget = 'code' | 'link'

type AccountDialogProps = {
  reauthenticate?: boolean
  providerLabel: string
  onClose: () => void
  onLogin: (signal: AbortSignal) => Promise<AccountAuthorizationSession>
}

const cancelAuthorization = (session: AccountAuthorizationSession): void => {
  void session.cancel().catch((error: unknown) => {
    console.error('Unable to cancel account sign-in.', error)
  })
}

export const AccountDialog = ({
  reauthenticate = false,
  providerLabel,
  onClose,
  onLogin
}: AccountDialogProps): ReactElement => {
  const mounted = useRef(true)
  const closing = useRef(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const attemptRef = useRef<AbortController | null>(null)
  const authorizationRef = useRef<AccountAuthorizationSession | null>(null)
  const [phase, setPhase] = useState<'idle' | 'starting' | 'authorizing'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [authorization, setAuthorization] = useState<AccountAuthorizationSession | null>(null)
  const userCode = authorization?.userCode
  const [authorizationActionPending, setAuthorizationActionPending] = useState(false)
  const [copyPending, setCopyPending] = useState<CopyTarget | null>(null)
  // Only the most recently copied value is on the clipboard.
  const [copied, setCopied] = useState<CopyTarget | null>(null)
  const [code, setCode] = useState('')
  const [codePending, setCodePending] = useState(false)

  const stopLogin = useCallback((): void => {
    const attempt = attemptRef.current
    attemptRef.current = null
    attempt?.abort()
    const session = authorizationRef.current
    authorizationRef.current = null
    if (session) cancelAuthorization(session)
  }, [])

  const handleClose = useCallback((): void => {
    if (closing.current) return
    closing.current = true
    stopLogin()
    onClose()
  }, [onClose, stopLogin])

  useLayoutEffect(() => {
    mounted.current = true
    const previousFocus = document.activeElement
    const closeButton = closeButtonRef.current
    closeButton?.focus({ preventScroll: true })
    return () => {
      mounted.current = false
      stopLogin()
      if (
        previousFocus instanceof HTMLElement &&
        closeButton?.form?.contains(document.activeElement)
      )
        previousFocus.focus({ preventScroll: true })
    }
  }, [stopLogin])

  useLayoutEffect(() => {
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || closing.current) return
      event.preventDefault()
      event.stopPropagation()
      handleClose()
    }
    window.addEventListener('keydown', dismissOnEscape, true)
    return () => window.removeEventListener('keydown', dismissOnEscape, true)
  }, [handleClose])

  const handleLogin = async (): Promise<void> => {
    if (closing.current || attemptRef.current) return
    const attempt = new AbortController()
    attemptRef.current = attempt
    const startupTimeout = window.setTimeout(() => {
      if (attemptRef.current !== attempt) return
      stopLogin()
      setError(`${providerLabel} sign-in took too long to start. Try again.`)
      setPhase('idle')
    }, 45_000)
    attempt.signal.addEventListener('abort', () => window.clearTimeout(startupTimeout), {
      once: true
    })
    setPhase('starting')
    setCode('')
    setCopied(null)
    setError(null)
    try {
      const session = await onLogin(attempt.signal)
      window.clearTimeout(startupTimeout)
      if (attemptRef.current !== attempt) {
        void session.completion.catch(() => {})
        cancelAuthorization(session)
        return
      }
      authorizationRef.current = session
      setAuthorization(session)
      setPhase('authorizing')
      await session.completion
      if (attemptRef.current !== attempt) return
      attemptRef.current = null
      authorizationRef.current = null
      handleClose()
    } catch (loginError) {
      if (attemptRef.current !== attempt) return
      attemptRef.current = null
      authorizationRef.current = null
      console.error('[caught:AccountDialog:handleLogin]', loginError)
      setError(
        loginError instanceof Error && loginError.message
          ? loginError.message
          : 'Unable to create the account.'
      )
      setAuthorization(null)
      setPhase('idle')
    } finally {
      window.clearTimeout(startupTimeout)
    }
  }

  const startSignInRef = useRef(handleLogin)
  const signInStartedRef = useRef(false)
  useEffect(() => {
    // Start once on opening; rerenders must not create another OAuth flow.
    queueMicrotask(() => {
      if (mounted.current && !closing.current && !signInStartedRef.current) {
        signInStartedRef.current = true
        void startSignInRef.current()
      }
    })
  }, [])

  const handleAuthorize = async (): Promise<void> => {
    if (closing.current || !authorization || authorizationActionPending) return
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
    if (closing.current || !authorization?.submitCode || !code.trim() || codePending) return
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

  const handleCopy = async (target: CopyTarget): Promise<void> => {
    const copy = target === 'code' ? authorization?.copyCode : authorization?.copyLink
    if (closing.current || !copy || copyPending) return
    setCopyPending(target)
    setError(null)
    try {
      await copy()
      if (mounted.current) setCopied(target)
    } catch (copyError) {
      console.error('[caught:AccountDialog:handleCopy]', copyError)
      if (mounted.current)
        setError(
          target === 'code' ? 'Unable to copy the code.' : 'Unable to copy the sign-in link.'
        )
    } finally {
      if (mounted.current) setCopyPending(null)
    }
  }

  const copyLinkButton = authorization?.copyLink && (
    <Button
      aria-label="Copy sign-in link"
      aria-busy={copyPending === 'link'}
      callback={() => handleCopy('link')}
      icon={copied === 'link' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      label={<span role="status">{copied === 'link' ? 'Copied' : 'Copy link'}</span>}
      theme="secondary"
    />
  )

  const openPageButton = (
    <Button
      aria-label="Open sign-in page"
      callback={handleAuthorize}
      disabled={authorizationActionPending}
      icon={<ExternalLink aria-hidden="true" />}
      label="Open page"
      theme="secondary"
    />
  )

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (phase === 'authorizing') void handleSubmitCode()
    else void handleLogin()
  }

  return createPortal(
    <MotionSurface
      motionKind="overlay"
      className="account-dialog-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.button === 0 && event.target === event.currentTarget) handleClose()
      }}
    >
      <PopupWindow>
        <form
          className="account-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={
            phase === 'authorizing'
              ? `Authorize ${providerLabel} account`
              : reauthenticate
                ? `Sign in to ${providerLabel} again`
                : `Create ${providerLabel} account`
          }
          onSubmit={handleSubmit}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="account-dialog__header">
            {phase === 'authorizing' ? (
              <span>Sign in to {providerLabel}</span>
            ) : reauthenticate ? (
              <span>Sign in again</span>
            ) : (
              <span>Sign in</span>
            )}
            <Button
              ref={closeButtonRef}
              aria-label="Close account window"
              callback={handleClose}
              icon={<X aria-hidden="true" />}
              size="small"
              theme="transparent"
              title="Close"
            />
          </div>
          {phase === 'authorizing' ? (
            <div className="account-dialog__authorization">
              <p>
                {userCode
                  ? 'Enter this one-time code on the sign-in page. Open the page here, or copy the link to sign in on another device.'
                  : authorization?.submitCode
                    ? 'Open the sign-in page, then paste the code below. You can also copy the link to another device.'
                    : 'Open the authorization page in your browser.'}
              </p>
              {userCode && (
                <>
                  <output className="account-dialog__user-code" aria-label="One-time code">
                    {userCode}
                  </output>
                  <div className="account-dialog__browser-actions account-dialog__browser-actions--device">
                    {authorization?.copyCode && (
                      <Button
                        aria-label="Copy one-time code"
                        aria-busy={copyPending === 'code'}
                        callback={() => handleCopy('code')}
                        icon={
                          copied === 'code' ? (
                            <Check aria-hidden="true" />
                          ) : (
                            <Copy aria-hidden="true" />
                          )
                        }
                        label={
                          <span role="status">{copied === 'code' ? 'Copied' : 'Copy code'}</span>
                        }
                        theme="primary"
                      />
                    )}
                    {openPageButton}
                    {copyLinkButton}
                  </div>
                </>
              )}
              {authorization?.submitCode && (
                <>
                  <div className="account-dialog__browser-actions">
                    {openPageButton}
                    {copyLinkButton}
                  </div>
                  <label className="account-dialog__code-label" htmlFor="account-dialog-code">
                    Authorization code
                  </label>
                  <Input
                    id="account-dialog-code"
                    type="password"
                    autoComplete="off"
                    value={code}
                    maxLength={4096}
                    disabled={codePending}
                    onChange={(event) => setCode(event.currentTarget.value)}
                  />
                </>
              )}
            </div>
          ) : (
            <p>
              {phase === 'starting'
                ? `Starting ${providerLabel} sign-in…`
                : `Sign in to ${providerLabel} to ${reauthenticate ? 'continue this conversation' : 'add your account'}.`}
            </p>
          )}
          {error && (
            <p className="account-dialog__error" role="alert">
              {error}
            </p>
          )}
          <div className="account-dialog__footer">
            {phase === 'authorizing' ? (
              <>
                <Button callback={handleClose} label="Cancel" theme="secondary" />
                {authorization?.submitCode ? (
                  <Button
                    callback={handleSubmitCode}
                    label={codePending ? 'Submitting…' : 'Submit code'}
                    disabled={!code.trim() || codePending}
                    theme="primary"
                  />
                ) : userCode ? null : (
                  <Button
                    callback={handleAuthorize}
                    disabled={authorizationActionPending}
                    icon={<ExternalLink aria-hidden="true" />}
                    label={authorizationActionPending ? 'Opening…' : 'Open'}
                    theme="primary"
                  />
                )}
              </>
            ) : (
              <Button
                callback={handleLogin}
                disabled={phase !== 'idle'}
                icon={<LogIn aria-hidden="true" />}
                label={
                  phase === 'starting' ? 'Starting…' : reauthenticate ? 'Sign in again' : 'Log In'
                }
                theme="primary"
              />
            )}
          </div>
        </form>
      </PopupWindow>
    </MotionSurface>,
    document.body
  )
}
