import { useEffect, useState } from 'react'
import {
  localAccessDefaultPort,
  type LocalAccessApi,
  type LocalAccessState
} from '../../../shared/localAccess'
import { appApi } from '../appApi'
import { isAndroidClient, isRemoteClient } from '../runtimeCapabilities'
import { forgetMobileConnection, readMobileConnection } from '../mobileConnection'
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
                <p>Connected to {readMobileConnection()?.origin}</p>
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
                <Button
                  label="Apply"
                  theme="secondary"
                  disabled={busy || !state}
                  callback={() => configure(state!.enabled)}
                />
              </div>
            </div>
            {state?.enabled && (
              <div className="settings-dialog__section-cards">
                <p>
                  Open Sele on your phone and choose {state.computerName ?? 'this computer'}. Allow
                  its request when prompted.
                </p>
                {state.discoveryError && <p role="status">{state.discoveryError}</p>}
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
                <details>
                  <summary>Browser access links</summary>
                  <p>
                    These links grant access without device approval. Use them only on your trusted
                    local network.
                  </p>
                  {state.urls.map((url) => (
                    <div
                      className="settings-dialog__field settings-dialog__field--inline"
                      key={url}
                    >
                      <code>{url.split('/#')[0]}</code>
                      <Button
                        label="Copy connection link"
                        theme="secondary"
                        callback={() => appApi.writeClipboardText(url)}
                      />
                    </div>
                  ))}
                  {!state.urls.length && !state.error && (
                    <p>No LAN address found. Connect your computer to Wi-Fi or Ethernet.</p>
                  )}
                  <Button
                    label="Reset connection links"
                    theme="secondary"
                    disabled={busy}
                    callback={() => configure(true, true)}
                  />
                  <p>
                    Resetting links revokes browser links. Paired Android devices keep their access
                    until you remove them above.
                  </p>
                </details>
              </div>
            )}
          </>
        )}
        {(error || state?.error) && <p role="alert">{error || state?.error}</p>}
      </section>
    </section>
  )
}
