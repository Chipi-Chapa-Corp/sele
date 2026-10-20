import { providerLabels } from '../providerSettings'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LoaderCircle, Monitor, Server } from 'lucide-react'
import type { AppContainerTarget } from '../../../shared/app'
import { getContainerTargetFromSuggestion, getContainerToolIcon } from '../containerSelection'
import type { ChatImportPreview } from '../../../shared/chatArchive'
import { type ProviderId, type ProviderChatUpdateSummary } from '../../../shared/provider'
import { appApi } from '../appApi'
import { providerApi } from '../providerApi'
import { Dropdown, type DropdownOption } from './Dropdown'
import { ProviderIcon } from './ProviderIcon'
import { Button } from './Button'
import './ChatImportDialog.css'

type Props = {
  preview: ChatImportPreview
  onClose: () => void
  onImported: (providerId: ProviderId, summary: ProviderChatUpdateSummary) => void
}

export function ChatImportDialog({ preview, onClose, onImported }: Props): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelledRef = useRef(false)
  const sendingRef = useRef(false)
  const lifecycleRef = useRef(0)
  const [environment, setEnvironment] = useState('host')
  const [environments, setEnvironments] = useState<
    Array<DropdownOption<string> & { target: AppContainerTarget }>
  >([{ value: 'host', label: 'Host', icon: <Monitor />, target: { kind: 'host' } }])
  const container = environments.find((entry) => entry.value === environment)!.target
  const [providers, setProviders] = useState<ProviderId[]>([])
  const [selectedProvider, setSelectedProvider] = useState<ProviderId | null>(null)
  const [checking, setChecking] = useState(true)
  const [loading, setLoading] = useState<ProviderId | null>(null)
  const [error, setError] = useState<string | null>(null)
  useLayoutEffect(() => {
    const previous = document.activeElement
    const dialog = dialogRef.current!
    dialog.showModal()
    return () => {
      dialog.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])
  useEffect(() => {
    const lifecycle = ++lifecycleRef.current
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
      queueMicrotask(() => {
        // StrictMode immediately mounts effects again; only a lasting unmount cancels the import.
        if (lifecycleRef.current === lifecycle)
          void providerApi.cancelChatImport(preview.id).catch(console.error)
      })
    }
  }, [preview.id])
  useEffect(() => {
    let active = true
    void Promise.all([appApi.getContainerSuggestions(), appApi.getSshEnvironments()])
      .then(([containers, ssh]) => {
        if (!active) return
        setEnvironments((current) => [
          current[0]!,
          ...ssh.map((entry) => ({
            value: `ssh:${entry.id}`,
            label: entry.name,
            icon: <Server />,
            target: {
              kind: 'container',
              tool: 'ssh',
              name: entry.id,
              runtime: { kind: 'host' }
            } as AppContainerTarget
          })),
          ...containers.map((entry) => ({
            value: entry.id,
            label: entry.name,
            icon: getContainerToolIcon(entry.tool),
            target: getContainerTargetFromSuggestion(entry)
          }))
        ])
      })
      .catch((error: unknown) => {
        if (active) setError(String(error))
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    let active = true
    setChecking(true)
    setProviders([])
    void appApi
      .getSourceAvailability({ container })
      .then((availability) => {
        if (!active) return
        const available = availability.providers.flatMap((entry) =>
          entry.available ? [entry.providerId] : []
        )
        available.sort(
          (a, b) => Number(b === preview.providerId) - Number(a === preview.providerId)
        )
        setProviders(available)
        setSelectedProvider((current) =>
          current && available.includes(current) ? current : (available[0] ?? null)
        )
        setChecking(false)
      })
      .catch((error: unknown) => {
        if (active) {
          setError(String(error))
          setChecking(false)
        }
      })
    return () => {
      active = false
    }
  }, [container, preview.providerId])
  const cancel = (): void => {
    cancelledRef.current = true
    void providerApi.cancelChatImport(preview.id).catch(console.error)
    onClose()
  }
  const startImport = async (): Promise<void> => {
    const providerId = selectedProvider
    if (!providerId) return
    if (sendingRef.current || checking || !providers.includes(providerId)) return
    sendingRef.current = true
    setLoading(providerId)
    setError(null)
    try {
      const summary = await providerApi.importChat(preview.id, providerId, container)
      if (!cancelledRef.current && summary) onImported(providerId, summary)
    } catch (error) {
      if (!cancelledRef.current) setError(error instanceof Error ? error.message : String(error))
    } finally {
      if (!cancelledRef.current) setLoading(null)
      sendingRef.current = false
    }
  }
  return (
    <dialog
      ref={dialogRef}
      className="chat-import-dialog"
      aria-label="Import chat"
      onCancel={(event) => {
        event.preventDefault()
        cancel()
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <h2>Import chat</h2>
      <h3>{preview.title || 'Untitled chat'}</h3>
      <p className="chat-import-dialog__provider">
        <span>
          {preview.turnCount.toLocaleString()} {preview.turnCount === 1 ? 'turn' : 'turns'}
        </span>
        <ProviderIcon providerId={preview.providerId} /> {providerLabels[preview.providerId]}
      </p>
      <label className="chat-import-dialog__field">
        <span>Environment</span>
        <Dropdown
          fill
          aria-label="Import environment"
          value={environment}
          options={environments}
          disabled={loading !== null}
          onChange={(value) => {
            setEnvironment(value)
            setChecking(true)
            setProviders([])
            setSelectedProvider(null)
            setError(null)
          }}
        />
      </label>
      {loading ? (
        <p className="chat-import-dialog__progress" role="status">
          <LoaderCircle className="app-loading-spinner" aria-hidden="true" /> Importing into{' '}
          <ProviderIcon providerId={loading} /> {providerLabels[loading]}…
        </p>
      ) : (
        <Dropdown
          fill
          aria-label="Import provider"
          value={selectedProvider ?? ''}
          valueLabel={
            checking
              ? 'Checking providers…'
              : providers.length === 0
                ? 'No providers available'
                : undefined
          }
          disabled={checking || providers.length === 0}
          options={providers.map((providerId) => ({
            value: providerId,
            label: providerLabels[providerId],
            icon: <ProviderIcon providerId={providerId} />
          }))}
          onChange={(value) => setSelectedProvider(value as ProviderId)}
        />
      )}
      {error && <p role="alert">{error}</p>}
      <div className="chat-import-dialog__actions">
        <Button label="Cancel" callback={cancel} />
        <Button
          label="Import"
          theme="primary"
          disabled={checking || !selectedProvider || loading !== null}
          callback={startImport}
        />
      </div>
    </dialog>
  )
}
