import { useEffect, useState } from 'react'
import {
  localAccessDefaultPort,
  type LocalAccessApi,
  type LocalAccessState
} from '../../../shared/localAccess'
import { isAndroidClient, isRemoteClient } from '../runtimeCapabilities'
import {
  forgetMobileConnection,
  isLocalIpv4Address,
  readMobileConnection
} from '../mobileConnection'
import { Button } from './Button'
import { Input } from './Input'
import { Switch } from './Switch'

const api = (): LocalAccessApi =>
  (window as unknown as { localAccessApi: LocalAccessApi }).localAccessApi

export function LocalAccessSettings(): React.ReactElement {
  const [state, setState] = useState<LocalAccessState | null>(null)
  const [port, setPort] = useState(String(localAccessDefaultPort))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pairingAddresses = (state?.urls ?? [])
    .map((link) => new URL(link))
    .filter(({ hostname }) => isLocalIpv4Address(hostname))
    .map(({ host }) => host)
  useEffect(() => {
    if (isRemoteClient()) return
    let active = true
    const timer = setInterval(() => {
      void api()
        .getState()
        .then((value) => {
          if (active) setState(value)
        })
        .catch((error) => console.warn('Unable to refresh local-access devices.', error))
    }, 3000)
    void api()
      .getState()
      .then(
        (value) => {
          if (active) {
            setState(value)
            setPort(String(value.port))
          }
        },
        (error) => {
          console.error('Unable to read local-access settings.', error)
          if (active) setError(String(error))
        }
      )
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  const configure = async (enabled: boolean, resetToken = false): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const value = await api().configure({ enabled, port: Number(port), resetToken })
      setState(value)
      setPort(String(value.port))
    } catch (error) {
      console.error('Unable to configure local access.', error)
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="settings-dialog__panel"
      id="settings-panel-localNetwork"
      role="tabpanel"
      aria-label="Local network settings"
    >
      <section className="settings-dialog__section" aria-labelledby="settings-local-network">
        <h2 className="settings-dialog__section-heading" id="settings-local-network">
          Local network
        </h2>
        {isRemoteClient() ? (
          <>
            <p>Manage local network access from Sele on your computer.</p>
            {isAndroidClient() && (
              <>
                <p>Connected to {readMobileConnection()?.name ?? 'your computer'}</p>
                <Button
                  label="Connect to another computer"
                  theme="secondary"
                  callback={forgetMobileConnection}
                />
              </>
            )}
          </>
        ) : (
          <>
            <p>
              Use Sele in your phone’s browser or Android app on the same Wi-Fi. Keep Sele open and
              your computer awake.
            </p>
            <div className="settings-dialog__section-cards">
              <div className="settings-dialog__field settings-dialog__field--inline">
                <div className="settings-dialog__field-header">
                  <h3 id="settings-local-access-enabled">Allow local network access</h3>
                  <p>
                    Your computer appears in the Android app on the same Wi-Fi. Each new device asks
                    for your approval here before it can connect.
                  </p>
                </div>
                <Switch
                  aria-labelledby="settings-local-access-enabled"
                  checked={state?.enabled ?? false}
                  disabled={busy || !state}
                  onChange={(event) => {
                    void configure(event.currentTarget.checked)
                  }}
                />
              </div>
              <div className="settings-dialog__field settings-dialog__field--inline">
                <label
                  className="settings-dialog__field-header"
                  htmlFor="settings-local-access-port"
                >
                  <h3>Port</h3>
                </label>
                <Input
                  id="settings-local-access-port"
                  type="number"
                  min={1024}
                  max={65535}
                  value={port}
                  disabled={busy}
                  onChange={(event) => setPort(event.currentTarget.value)}
                />
                <div className="settings-dialog__field-footer">
                  <Button
                    label="Apply"
                    theme="secondary"
                    fill
                    disabled={busy || !state}
                    callback={() => configure(state!.enabled)}
                  />
                </div>
              </div>
            </div>
            {state?.enabled && (
              <div className="settings-dialog__section-cards">
                <p>
                  Open Sele on your phone and choose {state.computerName ?? 'this computer'}. Allow
                  its request only if the security codes match.
                </p>
                {document.documentElement.dataset.platform === 'darwin' && (
                  <p>
                    If the phone can’t find this Mac, allow Sele in System Settings → Privacy &
                    Security → Local Network, then reopen Sele.
                  </p>
                )}

                {state.discoveryError && <p role="status">{state.discoveryError}</p>}
                {pairingAddresses.length > 0 && (
                  <div>
                    <h3>Pair by address</h3>
                    <p>Enter your computer’s address in Sele on your phone.</p>
                    <ul>
                      {pairingAddresses.map((address) => (
                        <li key={address}>
                          <code>{address}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <h3>Paired devices</h3>
                {!state.devices?.length && <p>No paired devices yet.</p>}
                {state.devices?.map((device) => (
                  <div
                    className="settings-dialog__field settings-dialog__field--inline"
                    key={device.id}
                  >
                    <div className="settings-dialog__field-header">
                      <h3>{device.name}</h3>
                      <p>Paired {new Date(device.pairedAt).toLocaleDateString()}</p>
                    </div>
                    <Button
                      label="Remove device"
                      theme="secondary"
                      disabled={busy}
                      callback={async () => {
                        setBusy(true)
                        try {
                          setState(await api().revokeDevice(device.id))
                        } catch (error) {
                          console.error('Unable to remove paired device.', error)
                          setError(error instanceof Error ? error.message : String(error))
                        } finally {
                          setBusy(false)
                        }
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {(error || state?.error) && <p role="alert">{error || state?.error}</p>}
      </section>
    </section>
  )
}
