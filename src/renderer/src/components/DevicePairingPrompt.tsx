import { useEffect, useRef, useState } from 'react'
import { Smartphone } from 'lucide-react'
import type { LocalAccessApi, LocalAccessPairingRequest } from '../../../shared/localAccess'
import { isRemoteClient } from '../runtimeCapabilities'
import { Button } from './Button'
import './DevicePairingPrompt.css'

export function DevicePairingPrompt(): React.ReactElement | null {
  const [request, setRequest] = useState<LocalAccessPairingRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const requestId = request?.id
  const api = (window as unknown as { localAccessApi: LocalAccessApi }).localAccessApi
  useEffect(() => {
    if (isRemoteClient()) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const refresh = async (): Promise<void> => {
      try {
        const state = await api.getState()
        if (active) setRequest(state.pairingRequests?.[0] ?? null)
      } catch (error) {
        console.warn('Unable to check device pairing requests.', error)
      } finally {
        if (active) timer = setTimeout(() => void refresh(), 2000)
      }
    }
    void refresh()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [])
  useEffect(() => {
    if (requestId && dialog.current && !dialog.current.open) dialog.current.showModal()
    setError(null)
  }, [requestId])
  const decide = async (approve: boolean): Promise<void> => {
    if (!request || busy) return
    setBusy(true)
    try {
      const state = await api.decidePairing(request.id, approve)
      setRequest(state.pairingRequests?.[0] ?? null)
    } catch (error) {
      console.error('Unable to respond to device pairing.', error)
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  if (!request) return null
  return (
    <dialog
      className="device-pairing"
      ref={dialog}
      aria-labelledby="pairing-title"
      onCancel={(event) => {
        event.preventDefault()
        void decide(false)
      }}
    >
      <Smartphone size={28} aria-hidden="true" />
      <h2 id="pairing-title">Connect {request.name}?</h2>
      <p>
        This device is requesting access to Sele. Allow it to manage chats and files on this
        computer?
      </p>
      <p className="device-pairing__hint">Approve only a device you are pairing now.</p>
      {error && <p role="alert">{error}</p>}
      <div className="device-pairing__actions">
        <Button label="Decline" theme="secondary" disabled={busy} callback={() => decide(false)} />
        <Button label="Allow device" disabled={busy} callback={() => decide(true)} />
      </div>
    </dialog>
  )
}
