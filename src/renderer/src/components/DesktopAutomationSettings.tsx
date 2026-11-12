import { useEffect, useState } from 'react'
import {
  pairedBrowserNames,
  type DesktopApi,
  type DesktopState,
  type PairedBrowserId
} from '../../../shared/desktop'
import { appApi } from '../appApi'
import { Button } from './Button'

const api = (): DesktopApi => (window as unknown as { desktopApi: DesktopApi }).desktopApi
export function DesktopAutomationSettings(): React.ReactElement {
  const [state, setState] = useState<DesktopState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [directory, setDirectory] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      void api()
        .getState()
        .then(
          (value) => {
            if (alive) setState(value)
          },
          (error) => {
            if (alive) setError(String(error))
          }
        )
    }
    refresh()
    const timer = setInterval(refresh, 1500)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  const run = async (operation: () => Promise<DesktopState>): Promise<void> => {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      setState(await operation())
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : String(error)
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="settings-dialog__section" aria-label="Desktop connections">
      <h2 className="settings-dialog__section-heading">Additional connections</h2>
      <p>Connect Sele's desktop control or shared-tab extension for local conversations.</p>
      <div className="settings-dialog__field settings-dialog__field--stack">
        <div className="settings-dialog__field-header">
          <strong>Native computer control</strong>
          <p>
            {state?.computer.connected
              ? `Connected (${state.computer.backend}). Disconnect to stop all native control.`
              : 'Share a Linux desktop for screenshots, clicks, typing, keys and scrolling. Wayland opens the system consent dialog.'}
          </p>
        </div>
        <Button
          disabled={busy && !state?.computer.connecting}
          callback={() =>
            run(() =>
              state?.computer.connected || state?.computer.connecting
                ? api().disconnectComputer()
                : api().connectComputer()
            )
          }
          label={
            state?.computer.connected || state?.computer.connecting
              ? 'Disconnect computer'
              : 'Connect computer'
          }
          theme="secondary"
        />
      </div>
      <details open={Boolean(state?.chrome.pairingUrl || state?.opera.pairingUrl)}>
        <summary>Sele browser extension (Chrome and Opera)</summary>
        <p>
          This is a separate shared-tab connection. Claude and Codex's official Chrome integrations
          use their own setup above. Chrome and Opera can stay connected at the same time. Each
          browser has its own pairing address and shared tabs.
        </p>
        {(['chrome', 'opera'] as const).map((id: PairedBrowserId) => {
          const name = pairedBrowserNames[id]
          const connection = state?.[id]
          const pair = id === 'chrome' ? () => api().pairChrome() : () => api().pairOpera()
          const disconnect =
            id === 'chrome' ? () => api().disconnectChrome() : () => api().disconnectOpera()
          return (
            <div key={id} role="group" aria-label={`${name} connection`}>
              <div className="settings-dialog__field settings-dialog__field--stack">
                <div className="settings-dialog__field-header">
                  <strong>{name} attachment</strong>
                  <p>
                    {connection?.connected
                      ? 'Connected. Use the extension to choose which tabs to share.'
                      : `Connect your existing ${name} profile through the Sele extension. Only tabs you share are exposed.`}
                  </p>
                </div>
                <Button
                  disabled={busy}
                  callback={() => run(connection?.connected ? disconnect : pair)}
                  label={
                    connection?.connected
                      ? `Disconnect ${name}`
                      : `Generate ${name} pairing address`
                  }
                  theme="secondary"
                />
              </div>
              {connection?.pairingUrl && (
                <div className="chat-approval__actions">
                  <Button
                    disabled={busy}
                    callback={async () => {
                      try {
                        await appApi.writeClipboardText(connection.pairingUrl!)
                        setStatus(`${name} pairing address copied.`)
                      } catch (error) {
                        setError(String(error))
                      }
                    }}
                    label={`Copy ${name} pairing address`}
                    theme="secondary"
                  />
                </div>
              )}
              {connection?.error && (
                <p role="alert">
                  {name}: {connection.error}
                </p>
              )}
            </div>
          )
        })}
        <div className="chat-approval__actions">
          <Button
            disabled={busy}
            callback={async () => {
              try {
                setDirectory(await api().openChromeExtension())
              } catch (error) {
                setError(String(error))
              }
            }}
            label="Open browser extension folder"
            theme="secondary"
          />
        </div>
        <p>
          In Chrome or Opera, open Extensions, enable Developer mode, and Load unpacked from the
          extension folder. Copy that browser's pairing address above, paste it in the extension,
          connect, then Share current tab. Generating an Opera address does not change Chrome's
          connection. Disconnect affects only the named browser.
        </p>
        <p role="status">{status}</p>
        {directory && <p>{directory}</p>}
      </details>
      {(error || state?.computer.error) && <p role="alert">{error || state?.computer.error}</p>}
    </section>
  )
}
