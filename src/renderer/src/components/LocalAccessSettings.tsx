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
  const [firewallMessage, setFirewallMessage] = useState<string | null>(null)
  const platform = document.documentElement.dataset.platform
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

  const runAction = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (error) {
      console.error('Unable to configure local access.', error)
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const configure = (enabled: boolean): Promise<void> =>
    runAction(async () => {
      setFirewallMessage(null)
      const value = await api().configure({ enabled, port: Number(port) })
      setState(value)
      setPort(String(value.port))
      if (
        state?.enabled &&
        value.enabled &&
        value.canConfigureFirewall &&
        !value.error &&
        state.port !== value.port
      )
        setFirewallMessage(
          'The pairing port changed. Update Sele’s Windows Firewall rules for the new port.'
        )
    })

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
                {platform === 'darwin' && (
                  <div className="settings-dialog__field settings-dialog__field--stack">
                    <p>
                      Allow Sele if macOS asks for Local Network access or permission to accept
                      incoming connections. To change Local Network access, open Privacy &amp;
                      Security and select Local Network.
                    </p>
                    <div className="settings-dialog__field-footer">
                      <Button
                        label="Open Privacy & Security"
                        theme="secondary"
                        disabled={busy}
                        callback={() => runAction(() => api().openNetworkSettings())}
                      />
                    </div>
                  </div>
                )}
                {platform === 'windows' && (
                  <div className="settings-dialog__field settings-dialog__field--stack">
                    <p>
                      On a trusted Private network, allow Sele if Windows Firewall asks for access.
                      {state.canConfigureFirewall &&
                        ' You can also grant access here with administrator approval.'}
                    </p>
                    <div className="settings-dialog__field-footer settings-dialog__field-footer--actions">
                      {state.canConfigureFirewall && (
                        <Button
                          label="Allow through Windows Firewall"
                          theme="secondary"
                          disabled={busy || Boolean(state.error)}
                          callback={() =>
                            runAction(async () => {
                              setFirewallMessage(null)
                              const allowed = await api().allowWindowsFirewall()
                              setFirewallMessage(
                                allowed
                                  ? 'Sele’s private-network firewall rules are saved. Try connecting from your phone again.'
                                  : 'Windows Firewall approval canceled.'
                              )
                            })
                          }
                        />
                      )}
                      <Button
                        label="Open Windows Firewall"
                        theme="secondary"
                        disabled={busy}
                        callback={() => runAction(() => api().openNetworkSettings())}
                      />
                    </div>
                    {firewallMessage && <p role="status">{firewallMessage}</p>}
                  </div>
                )}
                {state.discoveryError && (
                  <div className="settings-dialog__field settings-dialog__field--stack">
                    <p role="status">{state.discoveryError}</p>
                    <div className="settings-dialog__field-footer">
                      <Button
                        label="Retry nearby discovery"
                        theme="secondary"
                        disabled={busy}
                        callback={() =>
                          runAction(async () => setState(await api().retryDiscovery()))
                        }
                      />
                    </div>
                  </div>
                )}
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
