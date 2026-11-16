import '../assets/main.css'
import '../workspace/styles/workspace-shell.css'
import '../workspace/styles/conversation-panel.css'
import './MobileConnectionScreen.css'
import { useEffect, useRef, useState } from 'react'
import { Laptop, LoaderCircle, Radio, ArrowRight, X } from 'lucide-react'
import { Button } from './Button'
import { showPrivacyPolicy } from './PrivacyPolicyDialog'
import {
  watchNearbyComputers,
  restartNearbyDiscovery,
  pairComputer,
  type NearbyComputer
} from '../mobileDiscovery'
import { readMobileDevices, type MobileConnection } from '../mobileConnection'

export function MobileConnectionScreen({
  error: initialError,
  previous,
  validate,
  onConnect
}: {
  error?: string
  previous?: MobileConnection | null
  validate?: (connection: MobileConnection, signal: AbortSignal) => Promise<void>
  onConnect(connection: MobileConnection): void
}): React.ReactElement {
  const [computers, setComputers] = useState<NearbyComputer[]>([])
  const [error, setError] = useState(initialError ?? null)
  const [waiting, setWaiting] = useState<NearbyComputer | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [securityCode, setSecurityCode] = useState<string | null>(null)
  const [saved] = useState(readMobileDevices)
  const pairAgain = useRef(new Set<string>())
  const pairing = useRef<AbortController | null>(null)
  const retryLast = useRef(!/invalid|revoked|certificate/i.test(initialError ?? ''))
  const attempt = useRef<
    (computer: NearbyComputer, connection?: MobileConnection) => Promise<void>
  >(async () => {})
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => {
      document.documentElement.dataset.colorScheme = query.matches ? 'dark' : 'light'
    }
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    setError(initialError ?? null)
    return watchNearbyComputers((devices, discoveryError) => {
      setComputers(devices)
      if (discoveryError) setError(discoveryError)
    })
  }, [initialError])
  useEffect(() => () => pairing.current?.abort(), [])
  const connect = async (
    computer: NearbyComputer,
    savedConnection?: MobileConnection
  ): Promise<void> => {
    pairing.current?.abort()
    const abort = new AbortController()
    pairing.current = abort
    setError(null)
    setSecurityCode(null)
    setConnecting(computer.name)
    const revoked =
      savedConnection &&
      (pairAgain.current.has(savedConnection.hostId ?? savedConnection.origin) ||
        (/invalid|revoked|certificate/i.test(initialError ?? '') &&
          (savedConnection.hostId ?? savedConnection.origin) ===
            (previous?.hostId ?? previous?.origin)))
    setWaiting(savedConnection && !revoked ? null : computer)
    try {
      const connection =
        savedConnection && !revoked
          ? { ...savedConnection, origin: computer.origin }
          : await pairComputer(computer, abort.signal, (code) => {
              if (!abort.signal.aborted) setSecurityCode(code)
            })
      if (abort.signal.aborted) return
      setWaiting(null)
      await validate?.(connection, abort.signal)
      if (!abort.signal.aborted) onConnect(connection)
    } catch (error) {
      if (!abort.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error)
        if (savedConnection && /certificate/i.test(message)) {
          // Keep the original pin until an explicit second selection starts a
          // new, code-verified approval. Background retries must never replace it.
          pairAgain.current.add(savedConnection.hostId ?? savedConnection.origin)
          retryLast.current = false
        }
        if (savedConnection && !revoked && /invalid|revoked/i.test(message)) {
          retryLast.current = false
          await connect(computer)
          return
        }
        if (/invalid|revoked/i.test(message)) retryLast.current = false
        setError(message)
      }
    } finally {
      if (pairing.current === abort) {
        pairing.current = null
        setWaiting(null)
        setConnecting(null)
      }
    }
  }
  attempt.current = connect
  useEffect(() => {
    if (!previous || !validate) return
    const retry = (): void => {
      if (!retryLast.current || pairing.current) return
      void attempt.current(
        {
          id: previous.hostId ?? previous.origin,
          name: previous.name ?? 'Saved computer',
          origin: previous.origin
        },
        previous
      )
    }
    const first = setTimeout(retry, 500)
    const timer = setInterval(retry, 6000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [previous, validate])

  const devices: { computer: NearbyComputer; connection?: MobileConnection }[] = saved.map(
    (connection) => {
      const nearby = computers.find(
        (computer) => computer.id === connection.hostId || computer.origin === connection.origin
      )
      return {
        computer: nearby ?? {
          id: connection.hostId ?? connection.origin,
          name: connection.name ?? 'Saved computer',
          origin: connection.origin
        },
        connection
      }
    }
  )
  for (const computer of computers) {
    if (
      !devices.some(
        (device) => device.computer.id === computer.id || device.computer.origin === computer.origin
      )
    )
      devices.push({ computer })
  }
  return (
    <main className="chat mobile-connect">
      <section
        className="chat-panel mobile-connect__content"
        aria-labelledby="mobile-connect-title"
      >
        <header>
          <Laptop aria-hidden="true" />
          <h1 id="mobile-connect-title">Your devices</h1>
        </header>
        <p>Choose a computer running Sele. New devices ask for approval on your computer.</p>
        {waiting ? (
          <div className="mobile-connect__waiting" role="status">
            <LoaderCircle className="mobile-connect__spin" aria-hidden="true" />
            <h2>Allow this device on {waiting.name}</h2>
            {securityCode ? (
              <>
                <p>
                  Security code: <strong>{securityCode}</strong>
                </p>
                <p>Only allow access if this code matches the code shown on your computer.</p>
              </>
            ) : (
              <p>Checking the computer’s encrypted connection…</p>
            )}
            <Button
              label="Cancel request"
              icon={<X size={16} />}
              theme="secondary"
              callback={() => {
                pairing.current?.abort()
                setWaiting(null)
                setConnecting(null)
              }}
            />
          </div>
        ) : (
          <>
            {connecting && <p role="status">Connecting to {connecting}…</p>}
            {previous && retryLast.current && !connecting && (
              <p role="status">
                Reconnecting to {previous.name ?? 'your last device'} when it’s available.
              </p>
            )}
            <div className="mobile-connect__section-label">
              <Radio size={15} aria-hidden="true" /> Computers
            </div>
            <div className="mobile-connect__computers">
              {devices.map(({ computer, connection }) => (
                <Button
                  key={computer.id}
                  theme="secondary"
                  fill
                  icon={<Laptop aria-hidden="true" />}
                  callback={() => {
                    retryLast.current = false
                    void connect(computer, connection)
                  }}
                  label={
                    <span className="mobile-connect__computer-copy">
                      <span>
                        {computer.name}
                        {connection && (
                          <small>
                            {pairAgain.current.has(connection.hostId ?? connection.origin)
                              ? 'Pair again'
                              : 'Paired'}
                          </small>
                        )}
                      </span>
                      <ArrowRight aria-hidden="true" />
                    </span>
                  }
                />
              ))}
              {!devices.length && (
                <div className="mobile-connect__empty" role="status">
                  <LoaderCircle size={18} className="mobile-connect__spin" aria-hidden="true" />
                  <span>Looking for Sele devices…</span>
                  <small>Enable Local network in Sele’s settings on your computer.</small>
                </div>
              )}
            </div>
            <details className="mobile-connect__help">
              <summary className="ui-button ui-button--secondary ui-button--normal">
                Can’t find your computer?
              </summary>
              <p>
                Connect both devices to your local network and keep Sele open. Your router must
                allow devices to communicate. Wi-Fi and Ethernet can be used together. Update Sele
                on both devices to use encrypted connections.
              </p>
              <Button
                label="Search again"
                theme="secondary"
                callback={() => {
                  setError(null)
                  restartNearbyDiscovery()
                }}
              />
            </details>
          </>
        )}
        {error && (
          <p className="mobile-connect__error" role="alert">
            {error}
          </p>
        )}
        <Button
          label="Privacy policy"
          size="small"
          theme="transparent"
          callback={showPrivacyPolicy}
        />
      </section>
    </main>
  )
}
