import '../assets/main.css'
import './MobileConnectionScreen.css'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Laptop, LoaderCircle, ArrowRight, X } from 'lucide-react'
import { Button } from './Button'
import { Input } from './Input'
import { showPrivacyPolicy } from './PrivacyPolicyDialog'
import {
  watchNearbyComputers,
  restartNearbyDiscovery,
  pairComputer,
  type NearbyComputer
} from '../mobileDiscovery'
import {
  parseMobilePairingAddress,
  readMobileDevices,
  type MobileConnection
} from '../mobileConnection'
import { LanAccessRevokedError, LanCertificateError } from '../lanTransport'

export function MobileConnectionScreen({
  error: initialError,
  previous,
  validate,
  onConnect
}: {
  error?: string
  previous: MobileConnection | null
  validate: (connection: MobileConnection, signal: AbortSignal) => Promise<void>
  onConnect(connection: MobileConnection): void
}): React.ReactElement {
  const [computers, setComputers] = useState<NearbyComputer[]>([])
  const [error, setError] = useState(initialError ?? null)
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [waiting, setWaiting] = useState<NearbyComputer | null>(null)
  const [connecting, setConnecting] = useState<NearbyComputer | null>(null)
  const [securityCode, setSecurityCode] = useState<string | null>(null)
  const [pairByAddress, setPairByAddress] = useState(false)
  const [address, setAddress] = useState('')
  const [searchAttempt, setSearchAttempt] = useState(0)
  const [completedSearch, setCompletedSearch] = useState<number | null>(null)
  const [saved] = useState(readMobileDevices)
  const pairAgain = useRef(new Set<string>())
  const pairing = useRef<AbortController | null>(null)
  const autoReconnect = useRef(true)
  const lastAutoAddresses = useRef<string | null>(null)
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => {
      document.documentElement.dataset.colorScheme = query.matches ? 'dark' : 'light'
    }
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(
    () =>
      watchNearbyComputers((devices, failure) => {
        setComputers(devices)
        setDiscoveryError(failure ?? null)
      }),
    []
  )
  useEffect(() => () => pairing.current?.abort(), [])
  useEffect(() => {
    if (searchAttempt > 0) restartNearbyDiscovery()
    const timeout = window.setTimeout(() => setCompletedSearch(searchAttempt), 8000)
    return () => window.clearTimeout(timeout)
  }, [searchAttempt])
  const connect = async (
    computer: NearbyComputer,
    savedConnection?: MobileConnection,
    automatic = false
  ): Promise<void> => {
    if (!automatic) autoReconnect.current = false
    pairing.current?.abort()
    const abort = new AbortController()
    pairing.current = abort
    setError(null)
    setSecurityCode(null)
    setConnecting(computer)
    const savedId = savedConnection?.hostId ?? savedConnection?.origin
    const useSavedConnection =
      savedConnection && savedId && (automatic || !pairAgain.current.has(savedId))
    setWaiting(useSavedConnection ? null : computer)
    try {
      const connection = useSavedConnection
        ? savedConnection
        : await pairComputer(computer, abort.signal, (code) => {
            if (!abort.signal.aborted) setSecurityCode(code)
          })
      if (abort.signal.aborted) return
      setWaiting(null)
      await validate(connection, abort.signal)
      if (!abort.signal.aborted) onConnect(connection)
    } catch (error) {
      if (!abort.signal.aborted) {
        if (savedId && error instanceof LanAccessRevokedError) {
          pairAgain.current.add(savedId)
          if (!(error instanceof LanCertificateError) || !savedConnection?.hostId)
            autoReconnect.current = false
        }
        setError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (pairing.current === abort) {
        pairing.current = null
        setWaiting(null)
        setConnecting(null)
      }
    }
  }
  const previousComputer = computers.find((computer) => computer.id === previous?.hostId)
  const previousAddresses = JSON.stringify(
    [...(previousComputer?.origins ?? (previousComputer ? [previousComputer.origin] : []))].sort()
  )
  const resumePrevious = useEffectEvent((connection: MobileConnection, addresses: string) => {
    if (!autoReconnect.current || pairing.current || lastAutoAddresses.current === addresses) return
    lastAutoAddresses.current = addresses
    void connect(
      {
        id: connection.hostId ?? connection.origin,
        name: connection.name ?? 'Saved computer',
        origin: connection.origin
      },
      connection,
      true
    )
  })
  useEffect(() => {
    if (previous && !connecting) resumePrevious(previous, previousAddresses)
  }, [previous, previousAddresses, connecting])

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
  const searching = completedSearch !== searchAttempt && !discoveryError
  const visibleError = error ?? (!pairByAddress && !devices.length ? discoveryError : null)

  return (
    <main className="mobile-connect">
      <section className="mobile-connect__content" aria-labelledby="mobile-connect-title">
        <header>
          <Laptop aria-hidden="true" />
          <h1 id="mobile-connect-title">Your devices</h1>
        </header>
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
        ) : pairByAddress ? (
          <form
            className="mobile-connect__address"
            onSubmit={(event) => {
              event.preventDefault()
              try {
                const origin = parseMobilePairingAddress(address)
                void connect({ id: origin, name: 'your computer', origin })
              } catch (error) {
                setError(error instanceof Error ? error.message : String(error))
              }
            }}
          >
            <label htmlFor="mobile-computer-address">Computer address</label>
            <Input
              id="mobile-computer-address"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={32}
              placeholder="192.168.1.20:4589"
              value={address}
              onChange={(event) => setAddress(event.currentTarget.value)}
              aria-describedby="mobile-computer-address-hint"
              required
            />
            <p id="mobile-computer-address-hint">
              Find the address in Sele → Settings → Local network on your computer.
            </p>
            <div className="mobile-connect__actions">
              <Button
                label="Back"
                theme="secondary"
                callback={() => {
                  setError(null)
                  setPairByAddress(false)
                }}
              />
              <button type="submit" className="ui-button ui-button--primary ui-button--normal">
                Pair
              </button>
            </div>
          </form>
        ) : (
          <>
            {devices.length ? (
              <div className="mobile-connect__computers">
                {devices.map(({ computer, connection }) => {
                  const savedId = connection?.hostId ?? connection?.origin
                  const busy =
                    connecting !== null &&
                    (connecting.id === computer.id || connecting.id === savedId)
                  return (
                    <Button
                      key={computer.id}
                      theme="secondary"
                      fill
                      icon={<Laptop aria-hidden="true" />}
                      aria-busy={busy || undefined}
                      disabled={busy}
                      callback={() => void connect(computer, connection)}
                      label={
                        <span className="mobile-connect__computer-copy">
                          <span>
                            {computer.name}
                            {busy ? (
                              <small role="status">Connecting…</small>
                            ) : (
                              savedId && (
                                <small>
                                  {pairAgain.current.has(savedId) ? 'Pair again' : 'Paired'}
                                </small>
                              )
                            )}
                          </span>
                          {busy ? (
                            <LoaderCircle className="mobile-connect__spin" aria-hidden="true" />
                          ) : (
                            <ArrowRight aria-hidden="true" />
                          )}
                        </span>
                      }
                    />
                  )
                })}
              </div>
            ) : (
              <div className="mobile-connect__empty" role="status">
                {searching ? (
                  <>
                    <LoaderCircle size={18} className="mobile-connect__spin" aria-hidden="true" />
                    <span>Looking nearby…</span>
                  </>
                ) : (
                  <>
                    <span>No devices found</span>
                    <p>Enable Local network in Sele’s settings on your computer.</p>
                  </>
                )}
              </div>
            )}
            <div className="mobile-connect__actions">
              {!devices.length && !searching && (
                <Button
                  label="Search again"
                  theme="secondary"
                  callback={() => {
                    setDiscoveryError(null)
                    setSearchAttempt((attempt) => attempt + 1)
                  }}
                />
              )}
              <Button
                label="Pair by address"
                theme="transparent"
                callback={() => {
                  autoReconnect.current = false
                  pairing.current?.abort()
                  setError(null)
                  setPairByAddress(true)
                }}
              />
            </div>
          </>
        )}
        {visibleError && (
          <p className="mobile-connect__error" role="alert">
            {visibleError}
          </p>
        )}
      </section>
      <footer className="mobile-connect__footer">
        <Button
          label="Privacy policy"
          size="small"
          theme="transparent"
          callback={showPrivacyPolicy}
        />
      </footer>
    </main>
  )
}
