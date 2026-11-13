import { useEffect, useState } from 'react'
import { Copy, FolderOpen, MoreHorizontal, Unplug } from 'lucide-react'
import {
  pairedBrowserNames,
  type DesktopApi,
  type DesktopState,
  type PairedBrowserId
} from '../../../shared/desktop'
import { appApi } from '../appApi'
import { Button } from './Button'

const api = (): DesktopApi => (window as unknown as { desktopApi: DesktopApi }).desktopApi

type ConnectionAction = PairedBrowserId | 'computer' | 'folder'

export function DesktopAutomationSettings(): React.ReactElement {
  const [state, setState] = useState<DesktopState | null>(null)
  const [busy, setBusy] = useState<ConnectionAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [directory, setDirectory] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const desktopAvailable = document.documentElement.dataset.platform === 'linux'

  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      void api()
        .getState()
        .then(
          (value) => {
            if (alive) {
              setState(value)
              setLoadError(null)
            }
          },
          (failure) => {
            if (alive) setLoadError(String(failure))
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

  const run = async (action: ConnectionAction, operation: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(action)
    setError(null)
    setStatus(null)
    try {
      await operation()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : String(failure)
      )
    } finally {
      setBusy(null)
    }
  }

  const copyAddress = (id: PairedBrowserId): Promise<void> =>
    run(id, async () => {
      let connection = state?.[id]
      if (!connection?.pairingUrl) {
        const next = await (id === 'chrome' ? api().pairChrome() : api().pairOpera())
        setState(next)
        connection = next[id]
      }
      if (!connection.pairingUrl)
        throw new Error(`${pairedBrowserNames[id]} has no connection address.`)
      await appApi.writeClipboardText(connection.pairingUrl)
      setStatus(
        `${pairedBrowserNames[id]} address copied. Paste it in the extension and choose Connect.`
      )
    })

  return (
    <section
      className="settings-dialog__section browser-connections"
      aria-label="Browser connections"
    >
      <div className="browser-connections__heading">
        <h2 className="settings-dialog__section-heading">Your browsers</h2>
        <p>Connect once. Website tabs are available automatically.</p>
      </div>
      <div className="settings-dialog__section-cards">
        {(['chrome', 'opera'] as const).map((id) => {
          const name = pairedBrowserNames[id]
          const connection = state?.[id]
          const connected = connection?.connected === true
          const paired = Boolean(connection?.pairingUrl)
          return (
            <div
              className="settings-dialog__field browser-connections__row"
              key={id}
              role="group"
              aria-label={`${name} connection`}
            >
              <div className="settings-dialog__field-header">
                <h3>{name}</h3>
                <p
                  role="status"
                  className={connected && !loadError ? 'browser-connections__connected' : undefined}
                >
                  {loadError
                    ? 'Status unavailable'
                    : !connection
                      ? 'Checking…'
                      : connected
                        ? 'Connected'
                        : paired
                          ? 'Waiting for extension'
                          : 'Not connected'}
                </p>
              </div>
              <div className="browser-connections__actions">
                {!connected && (
                  <Button
                    disabled={Boolean(busy) || Boolean(loadError) || !connection}
                    callback={() => copyAddress(id)}
                    label={busy === id ? 'Preparing…' : paired ? 'Copy address' : 'Connect'}
                    size="small"
                    theme="secondary"
                  />
                )}
                {paired && (
                  <Button
                    aria-label={`${name} connection options`}
                    callback={() => {}}
                    disabled={Boolean(busy) || Boolean(loadError)}
                    icon={<MoreHorizontal aria-hidden="true" />}
                    menuOnly
                    dropdownLabel={`${name} connection`}
                    dropdownActions={[
                      ...(connected
                        ? [
                            {
                              id: 'copy',
                              label: 'Copy connection address',
                              icon: <Copy aria-hidden="true" />,
                              callback: () => copyAddress(id)
                            }
                          ]
                        : []),
                      {
                        id: 'disconnect',
                        label: 'Disconnect',
                        icon: <Unplug aria-hidden="true" />,
                        callback: () =>
                          run(id, async () => {
                            setState(
                              await (id === 'chrome'
                                ? api().disconnectChrome()
                                : api().disconnectOpera())
                            )
                          })
                      }
                    ]}
                    size="small"
                    theme="transparent"
                  />
                )}
              </div>
              {connection?.error && (
                <p className="browser-settings__error" role="alert">
                  {connection.error}
                </p>
              )}
            </div>
          )
        })}
      </div>
      {status && (
        <p className="browser-settings__feedback" role="status">
          {status}
        </p>
      )}
      {(error || loadError) && (
        <p className="browser-settings__error" role="alert">
          {error || loadError}
        </p>
      )}
      <details className="browser-settings__disclosure">
        <summary>Install the extension</summary>
        <div className="browser-settings__disclosure-body">
          <ol className="browser-settings__steps">
            <li>Open the extension folder below.</li>
            <li>
              In your browser’s Extensions page, enable Developer mode and choose Load unpacked.
            </li>
            <li>Copy the address for that browser above and connect in the extension.</li>
          </ol>
          <Button
            disabled={Boolean(busy)}
            callback={() =>
              run('folder', async () => {
                setDirectory(await api().openChromeExtension())
              })
            }
            icon={<FolderOpen aria-hidden="true" />}
            label="Open extension folder"
            size="small"
            theme="secondary"
          />
          {directory && <code className="browser-settings__path">{directory}</code>}
        </div>
      </details>
      {(desktopAvailable || state?.computer.connected || state?.computer.error) && (
        <details className="browser-settings__disclosure">
          <summary>Desktop control</summary>
          <div className="browser-settings__disclosure-body">
            <div className="browser-settings__desktop-row">
              <p>
                {state?.computer.connected
                  ? `Connected · ${state.computer.backend}`
                  : !desktopAvailable
                    ? 'Available on Linux.'
                    : 'Control a shared Linux desktop.'}
              </p>
              {(desktopAvailable || state?.computer.connected || state?.computer.connecting) && (
                <Button
                  disabled={Boolean(busy) && !state?.computer.connecting}
                  callback={() =>
                    run('computer', async () => {
                      setState(
                        await (state?.computer.connected || state?.computer.connecting
                          ? api().disconnectComputer()
                          : api().connectComputer())
                      )
                    })
                  }
                  label={
                    state?.computer.connected || state?.computer.connecting
                      ? 'Disconnect computer'
                      : 'Connect computer'
                  }
                  size="small"
                  theme="secondary"
                />
              )}
            </div>
            {state?.computer.error && (
              <p className="browser-settings__error" role="alert">
                {state.computer.error}
              </p>
            )}
          </div>
        </details>
      )}
    </section>
  )
}
