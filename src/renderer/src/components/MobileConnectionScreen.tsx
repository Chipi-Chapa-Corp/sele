import '../assets/main.css'
import '../workspace/styles/workspace-shell.css'
import '../workspace/styles/conversation-panel.css'
import './MobileConnectionScreen.css'
import { useEffect, useRef, useState } from 'react'
import { Laptop, LoaderCircle, Radio, ArrowRight, X } from 'lucide-react'
import { Button } from './Button'
import { Input } from './Input'
import {
  localNetwork,
  nativeDiscoveryAvailable,
  pairComputer,
  type NearbyComputer
} from '../mobileDiscovery'
import type { MobileConnection } from '../mobileConnection'

export function MobileConnectionScreen({
  error: initialError,
  previous,
  onConnect
}: {
  error?: string
  previous?: MobileConnection | null
  onConnect(connection: MobileConnection): void
}): React.ReactElement {
  const [computers, setComputers] = useState<NearbyComputer[]>([])
  const [error, setError] = useState(initialError ?? null)
  const [waiting, setWaiting] = useState<NearbyComputer | null>(null)
  const [address, setAddress] = useState('')
  const [scanning, setScanning] = useState(true)
  const [scan, setScan] = useState(0)
  const pairing = useRef<AbortController | null>(null)
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
    console.debug('Starting nearby Sele discovery.', scan)
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async (): Promise<void> => {
      if (!active) return
      try {
        const result = await localNetwork.getServices()
        if (active) {
          setComputers(result.services)
          if (result.error) {
            setError(result.error)
            setScanning(false)
          }
        }
      } catch (error) {
        console.warn('Unable to list nearby Sele computers.', error)
        if (active) {
          setError('Nearby discovery is unavailable. Try again or enter your computer’s address.')
          setScanning(false)
        }
      } finally {
        if (active) timer = setTimeout(() => void poll(), 1500)
      }
    }
    if (nativeDiscoveryAvailable()) {
      void localNetwork
        .startDiscovery()
        .then(poll)
        .catch((error) => {
          console.warn('Unable to start nearby discovery.', error)
          if (active) {
            setError('Could not start nearby discovery. Check Wi-Fi and try again.')
            setScanning(false)
          }
        })
    } else setScanning(false)
    return () => {
      active = false
      clearTimeout(timer)
      pairing.current?.abort()
      if (nativeDiscoveryAvailable())
        void localNetwork
          .stopDiscovery()
          .catch((error) => console.warn('Unable to stop nearby discovery.', error))
    }
  }, [scan])
  const connect = async (computer: NearbyComputer): Promise<void> => {
    pairing.current?.abort()
    const abort = new AbortController()
    pairing.current = abort
    setWaiting(computer)
    setError(null)
    try {
      const connection = await pairComputer(computer, abort.signal)
      if (!abort.signal.aborted) onConnect(connection)
    } catch (error) {
      console.warn('Unable to pair Sele device.', error)
      if (!abort.signal.aborted) setError(error instanceof Error ? error.message : String(error))
    } finally {
      if (pairing.current === abort) setWaiting(null)
    }
  }
  return (
    <main className="chat mobile-connect">
      <section className="chat-panel mobile-connect__content" aria-labelledby="mobile-connect-title">
        <header>
          <Laptop aria-hidden="true" />
          <h1 id="mobile-connect-title">Connect to Sele</h1>
        </header>
        <p>Choose your computer on the same Wi-Fi, then approve this device in Sele.</p>
        {waiting ? (
          <div className="mobile-connect__waiting" role="status">
            <LoaderCircle className="mobile-connect__spin" aria-hidden="true" />
            <h2>Allow this device on {waiting.name}</h2>
            <p>A request is waiting in Sele on your computer. You only need to do this once.</p>
            <Button
              label="Cancel request"
              icon={<X size={16} />}
              theme="secondary"
              callback={() => {
                pairing.current?.abort()
                setWaiting(null)
              }}
            />
          </div>
        ) : (
          <>
            <div className="mobile-connect__section-label">
              <Radio size={15} aria-hidden="true" /> Nearby computers
            </div>
            <div className="mobile-connect__computers">
              {computers.map((computer) => (
                <Button
                  key={computer.id}
                  theme="secondary"
                  fill
                  callback={() => void connect(computer)}
                  icon={<Laptop aria-hidden="true" />}
                  label={
                    <span className="mobile-connect__computer-copy">
                      <span>{computer.name}</span>
                      <ArrowRight aria-hidden="true" />
                    </span>
                  }
                />
              ))}
              {!computers.length && (
                <div className="mobile-connect__empty" role="status">
                  {scanning && (
                    <LoaderCircle size={18} className="mobile-connect__spin" aria-hidden="true" />
                  )}
                  <span>{scanning ? 'Looking for Sele…' : 'No computers found yet'}</span>
                  <small>Enable Local network in Sele’s settings on your computer.</small>
                </div>
              )}
            </div>
            {previous && (
              <Button
                label={
                  /invalid|revoked/i.test(initialError ?? '')
                    ? `Request access to ${previous.name ?? 'saved computer'}`
                    : 'Reconnect to saved computer'
                }
                theme="secondary"
                fill
                callback={() =>
                  /invalid|revoked/i.test(initialError ?? '')
                    ? connect({
                        id: previous.hostId ?? previous.origin,
                        name: previous.name ?? 'your computer',
                        origin: previous.origin
                      })
                    : onConnect(previous)
                }
              />
            )}
            <details className="mobile-connect__help">
              <summary className="ui-button ui-button--secondary ui-button--normal">
                Can’t find your computer?
              </summary>
              <p>
                Some Wi-Fi networks block discovery. Check that both devices use the same network,
                then search again.
              </p>
              <Button
                label="Search again"
                theme="secondary"
                callback={() => {
                  setError(null)
                  setScanning(true)
                  setScan((value) => value + 1)
                }}
              />
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  try {
                    const url = new URL(address.includes('://') ? address : `http://${address}`)
                    if (!url.port) url.port = '4589'
                    void connect({ id: url.origin, name: url.hostname, origin: url.origin })
                  } catch (error) {
                    console.warn('Invalid computer address.', error)
                    setError('Enter your computer’s local address, for example 192.168.1.20.')
                  }
                }}
              >
                <label htmlFor="sele-computer-address">Computer address</label>
                <Input
                  id="sele-computer-address"
                  value={address}
                  placeholder="192.168.1.20"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => setAddress(event.currentTarget.value)}
                  required
                />
                <button className="ui-button ui-button--secondary ui-button--normal" type="submit">
                  Request access
                </button>
              </form>
            </details>
          </>
        )}
        {error && (
          <p className="mobile-connect__error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  )
}
