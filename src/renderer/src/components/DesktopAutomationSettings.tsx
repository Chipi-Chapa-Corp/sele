import { useEffect, useState } from 'react'
import type { DesktopApi, DesktopState } from '../../../shared/desktop'
import { appApi } from '../appApi'
import { Button } from './Button'

const api = (): DesktopApi => (window as unknown as { desktopApi: DesktopApi }).desktopApi
export function DesktopAutomationSettings(): React.ReactElement {
  const [state, setState] = useState<DesktopState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [directory, setDirectory] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (!api()) {
      setError('Restart Sele to enable desktop connections.')
      return
    }
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
      <h2 className="settings-dialog__section-heading">Native computer and Chrome</h2>
      <p>
        These connections are shared with local Codex and Claude conversations. Remote environments
        cannot use them.
      </p>
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
      <div className="settings-dialog__field settings-dialog__field--stack">
        <div className="settings-dialog__field-header">
          <strong>Chrome attachment</strong>
          <p>
            {state?.chrome.connected
              ? 'Connected. Use the extension to choose which tabs to share.'
              : 'Connect your existing Chrome profile through the Sele extension. Only tabs you share are exposed.'}
          </p>
        </div>
        <Button
          disabled={busy}
          callback={() =>
            run(() => (state?.chrome.connected ? api().disconnectChrome() : api().pairChrome()))
          }
          label={state?.chrome.connected ? 'Disconnect Chrome' : 'Generate pairing address'}
          theme="secondary"
        />
      </div>
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
          label="Open Chrome extension folder"
          theme="secondary"
        />
        {state?.chrome.pairingUrl && (
          <Button
            callback={() => appApi.writeClipboardText(state.chrome.pairingUrl!)}
            label="Copy pairing address"
            theme="secondary"
          />
        )}
      </div>
      <p>
        In Chrome, open chrome://extensions, enable Developer mode, and Load unpacked from the
        extension folder. Paste the pairing address in the extension, connect, then Share current
        tab.
      </p>
      {directory && <p>{directory}</p>}
      {(error || state?.computer.error) && <p role="alert">{error || state?.computer.error}</p>}
    </section>
  )
}
