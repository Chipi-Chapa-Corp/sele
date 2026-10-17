import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ExternalLink, RefreshCw, Trash2 } from 'lucide-react'
import type { AppContainerTarget } from '../../../shared/app'
import {
  isConnectionPromptVisible,
  type ProviderConnection,
  type ProviderConnectionAttempt,
  type ProviderConnectInput
} from '../../../shared/providerConnections'
import { providerApi } from '../providerApi'
import { appApi } from '../appApi'
import { Button } from './Button'
import { Dropdown } from './Dropdown'
import { Input } from './Input'

type Props = {
  container: AppContainerTarget
  onChanged?: () => void
}

export function ProviderConnectionsPanel({ container, onChanged }: Props): ReactNode {
  const [providers, setProviders] = useState<ProviderConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [methodIndex, setMethodIndex] = useState('0')
  const [key, setKey] = useState('')
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [attempt, setAttempt] = useState<ProviderConnectionAttempt | null>(null)
  const [code, setCode] = useState('')
  const alive = useRef(false)
  const pendingAttempt = useRef<ProviderConnectionAttempt | null>(null)
  const changed = useRef(onChanged)
  changed.current = onChanged
  const sourceKey = JSON.stringify(container)
  const options = { container }
  const provider = providers.find((entry) => entry.id === selectedId)
  const method = provider?.methods[Number(methodIndex)]
  const prompts = (method?.prompts ?? []).filter((prompt) =>
    isConnectionPromptVisible(prompt, inputs)
  )

  const fail = useCallback((error: unknown): void => {
    console.error('[ProviderConnectionsPanel]', error)
    if (alive.current)
      setError(error instanceof Error ? error.message : 'Unable to update connections.')
  }, [])
  const reload = useCallback(async (): Promise<void> => {
    const result = await providerApi.getConnections('opencode', {
      container: JSON.parse(sourceKey)
    })
    if (alive.current) setProviders(result)
  }, [sourceKey])
  const refresh = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      await reload()
    } catch (error) {
      fail(error)
    } finally {
      if (alive.current) setLoading(false)
    }
  }

  useEffect(() => {
    alive.current = true
    let active = true
    const source = { container: JSON.parse(sourceKey) }
    void providerApi
      .getConnections('opencode', source)
      .then((result) => {
        if (active) setProviders(result)
      })
      .catch((error) => {
        console.error('[ProviderConnectionsPanel:load]', error)
        if (active) setError(error instanceof Error ? error.message : 'Unable to load connections.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      alive.current = false
      const pending = pendingAttempt.current
      pendingAttempt.current = null
      if (pending)
        void providerApi
          .cancelConnection('opencode', pending.attemptId, source)
          .catch((error) => console.error('[ProviderConnectionsPanel:cancel]', error))
    }
  }, [sourceKey])

  const finish = useCallback(async (): Promise<void> => {
    pendingAttempt.current = null
    setAttempt(null)
    setCode('')
    setKey('')
    setInputs({})
    setNotice('Connected successfully.')
    changed.current?.()
    await reload()
  }, [reload])

  useEffect(() => {
    if (!attempt) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      try {
        const result = await providerApi.getConnectionAttempt('opencode', attempt.attemptId, {
          container: JSON.parse(sourceKey)
        })
        if (!active) return
        if (result.status === 'complete') {
          await finish()
        } else if (result.status === 'pending') {
          timer = setTimeout(() => void poll(), 1500)
        } else {
          pendingAttempt.current = null
          setAttempt(null)
          setError(
            result.status === 'expired'
              ? 'Authorization expired. Connect again to retry.'
              : (result.message ?? 'Authorization failed. Try again.')
          )
        }
      } catch (error) {
        fail(error)
        if (!active) return
        // Keep checking a live attempt after a temporary server/network failure.
        timer = setTimeout(() => void poll(), 5000)
      }
    }
    timer = setTimeout(() => void poll(), 1000)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [attempt, sourceKey, finish, fail])

  const connect = async (): Promise<void> => {
    if (!provider || !method || busy) return
    setBusy(true)
    setError(null)
    setNotice('')
    const input: ProviderConnectInput =
      method.type === 'key'
        ? {
            integrationId: provider.id,
            method: 'key',
            key: key.trim(),
            inputs: Object.fromEntries(
              prompts.map((prompt) => [prompt.key, inputs[prompt.key] ?? ''])
            )
          }
        : {
            integrationId: provider.id,
            method: 'oauth',
            methodId: method.id,
            inputs: Object.fromEntries(
              prompts.map((prompt) => [prompt.key, inputs[prompt.key] ?? ''])
            )
          }
    try {
      const result = await providerApi.connectProvider('opencode', input, options)
      if (!alive.current) {
        if (result) await providerApi.cancelConnection('opencode', result.attemptId, options)
        return
      }
      setKey('')
      setInputs({})
      if (result) {
        pendingAttempt.current = result
        setAttempt(result)
      } else await finish()
    } catch (error) {
      fail(error)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const cancel = async (): Promise<void> => {
    if (!attempt) return
    setBusy(true)
    setError(null)
    try {
      await providerApi.cancelConnection('opencode', attempt.attemptId, options)
      if (alive.current) {
        pendingAttempt.current = null
        setAttempt(null)
        setCode('')
      }
    } catch (error) {
      fail(error)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const submitCode = async (): Promise<void> => {
    if (!attempt || !code.trim()) return
    setBusy(true)
    setError(null)
    try {
      await providerApi.completeConnection('opencode', attempt.attemptId, code.trim(), options)
      if (alive.current && pendingAttempt.current?.attemptId === attempt.attemptId) await finish()
    } catch (error) {
      fail(error)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const remove = async (credentialId: string): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice('')
    try {
      await providerApi.deleteConnection('opencode', credentialId, options)
      if (alive.current) {
        setNotice('Connection removed.')
        changed.current?.()
        await reload()
      }
    } catch (error) {
      fail(error)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const connected = providers.filter((entry) => entry.connections.length > 0)

  return (
    <section className="settings-dialog__section" aria-label="OpenCode connections">
      <div className="settings-dialog__config-toolbar">
        <h2 className="settings-dialog__section-heading">Connections</h2>
        <Button
          icon={<RefreshCw />}
          label="Refresh"
          size="small"
          disabled={loading || busy || Boolean(attempt)}
          callback={refresh}
        />
      </div>
      <p>Connect model providers with an API key or sign in to your account.</p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {loading ? (
        <p role="status">Loading connections…</p>
      ) : (
        <>
          <div className="settings-dialog__section-cards">
            {connected.length === 0 && <p>No connections yet.</p>}
            {connected.flatMap((entry) =>
              entry.connections.map((connection) => (
                <div
                  className="settings-dialog__field"
                  key={`${entry.id}:${connection.type === 'credential' ? connection.id : connection.name}`}
                >
                  <div className="settings-dialog__field-header">
                    <h3>{entry.name}</h3>
                    <p>
                      {connection.type === 'credential'
                        ? connection.label || 'Saved credential'
                        : `Environment variable · ${connection.name}`}
                    </p>
                    {connection.type === 'env' && <p>Managed in your environment.</p>}
                  </div>
                  {connection.type === 'credential' && (
                    <Button
                      icon={<Trash2 />}
                      label="Remove"
                      aria-label={`Remove ${entry.name} connection`}
                      size="small"
                      disabled={busy || Boolean(attempt)}
                      callback={() => remove(connection.id)}
                    />
                  )}
                </div>
              ))
            )}
          </div>
          <div className="settings-dialog__field settings-dialog__field--stack">
            <div className="settings-dialog__field-header">
              <h3>Add connection</h3>
            </div>
            <Dropdown
              aria-label="Model provider"
              searchable
              searchPlaceholder="Search providers…"
              valueLabel={provider ? undefined : 'Choose a provider'}
              options={providers
                .filter((entry) => entry.methods.length > 0)
                .map((entry) => ({ value: entry.id, label: entry.name }))}
              value={selectedId}
              disabled={busy || Boolean(attempt)}
              fill
              onChange={(value) => {
                setSelectedId(value)
                setMethodIndex('0')
                setKey('')
                setInputs({})
                setCode('')
                setError(null)
                setNotice('')
              }}
            />
            {provider && !attempt && (
              <>
                {provider.methods.length > 1 && (
                  <Dropdown
                    aria-label="Connection method"
                    value={methodIndex}
                    disabled={busy}
                    fill
                    options={provider.methods.map((entry, index) => ({
                      value: String(index),
                      label: entry.label || 'API key'
                    }))}
                    onChange={(value) => {
                      setMethodIndex(value)
                      setKey('')
                      setInputs({})
                      setError(null)
                    }}
                  />
                )}
                {prompts.map((prompt) => (
                  <label className="settings-dialog__connection-input" key={prompt.key}>
                    <span>{prompt.message}</span>
                    {prompt.type === 'select' ? (
                      <Dropdown
                        aria-label={prompt.message}
                        disabled={busy}
                        fill
                        options={prompt.options ?? []}
                        value={inputs[prompt.key] ?? ''}
                        valueLabel={inputs[prompt.key] ? undefined : 'Choose an option'}
                        onChange={(value) =>
                          setInputs((previous) => ({ ...previous, [prompt.key]: value }))
                        }
                      />
                    ) : (
                      <Input
                        value={inputs[prompt.key] ?? ''}
                        placeholder={prompt.placeholder}
                        disabled={busy}
                        autoComplete="off"
                        onChange={(event) =>
                          setInputs((previous) => ({
                            ...previous,
                            [prompt.key]: event.target.value
                          }))
                        }
                      />
                    )}
                  </label>
                ))}
                {method?.type === 'key' && (
                  <label className="settings-dialog__connection-input">
                    <span>API key</span>
                    <Input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={key}
                      disabled={busy}
                      placeholder="Enter API key"
                      onChange={(event) => setKey(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && key.trim()) {
                          event.preventDefault()
                          void connect()
                        }
                      }}
                    />
                  </label>
                )}
                <Button
                  label={busy ? 'Connecting…' : 'Connect'}
                  theme="primary"
                  disabled={busy || !method || (method.type === 'key' && !key.trim())}
                  callback={connect}
                />
              </>
            )}
            {attempt && (
              <>
                <p role="status">
                  {attempt.instructions || 'Complete authorization in your browser.'}
                </p>
                <Button
                  icon={<ExternalLink />}
                  label="Open authorization page"
                  callback={async () => {
                    try {
                      await appApi.handleExternalLink({ url: attempt.url, action: 'open' })
                    } catch (error) {
                      fail(error)
                    }
                  }}
                />
                {attempt.mode === 'code' ? (
                  <>
                    <label className="settings-dialog__connection-input">
                      <span>Authorization code</span>
                      <Input
                        autoComplete="off"
                        spellCheck={false}
                        value={code}
                        disabled={busy}
                        onChange={(event) => setCode(event.target.value)}
                      />
                    </label>
                    <Button
                      label={busy ? 'Completing…' : 'Complete connection'}
                      theme="primary"
                      disabled={busy || !code.trim()}
                      callback={submitCode}
                    />
                  </>
                ) : (
                  <p role="status">Waiting for authorization…</p>
                )}
                <Button label="Cancel" disabled={busy} callback={cancel} />
              </>
            )}
          </div>
        </>
      )}
    </section>
  )
}
