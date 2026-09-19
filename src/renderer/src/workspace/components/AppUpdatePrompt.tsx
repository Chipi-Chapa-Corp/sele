import { appApi } from '../../appApi'
import { useEffect, useState, type ReactElement } from 'react'
import { BellOff, Download, X } from 'lucide-react'
import { Button } from '../../components/Button'
import type { AppUpdateDismissal, AppUpdateState } from '../../../../shared/appUpdate'

export function AppUpdatePrompt(): ReactElement | null {
  const [state, setState] = useState<AppUpdateState | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let receivedEvent = false
    const unsubscribe = appApi.onAppUpdateChanged((next) => {
      receivedEvent = true
      setState(next)
      setError(null)
    })
    void appApi
      .getAppUpdate()
      .then((next) => {
        if (active && !receivedEvent) setState(next)
      })
      .catch((error) => {
        console.error('[caught:AppUpdatePrompt:AppUpdatePrompt]', error)
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  if (!state?.version) return null
  const busy = state.status === 'updating'
  const dismiss = (mode: AppUpdateDismissal): void => {
    void appApi.dismissAppUpdate(mode).catch((reason) => {
      console.error('[caught:AppUpdatePrompt:dismiss]', reason)
      return setError(String(reason))
    })
  }
  const update = (): void => {
    if (!window.confirm('Update Sele and restart? Running chats and terminals will stop.')) return
    setError(null)
    void appApi.installAppUpdate().catch((reason) => {
      console.error('[caught:AppUpdatePrompt:update]', reason)
      return setError(String(reason))
    })
  }
  return (
    <section className="chat-approval app-update-prompt" aria-label="Sele update available">
      <div className="chat-approval__main" role="status" aria-live="polite">
        <span className="chat-approval__label">Sele update available</span>
        <span className="chat-approval__summary">Version {state.version} · Restarts Sele</span>
        {(error || state.error) && (
          <span className="chat-approval__error">{error || state.error}</span>
        )}
      </div>
      <div className="chat-approval__actions">
        <Button
          disabled={busy}
          callback={() => dismiss('session')}
          dropdownActions={[
            {
              id: 'ignore-version',
              label: 'Never suggest this version',
              disabled: busy,
              icon: <X aria-hidden="true" />,
              callback: () => dismiss('version')
            },
            {
              id: 'disable',
              label: 'Never suggest',
              disabled: busy,
              icon: <BellOff aria-hidden="true" />,
              callback: () => dismiss('forever')
            }
          ]}
          dropdownLabel="Skip update options"
          dropdownMenuAlign="end"
          dropdownPlacement="top"
          icon={<X aria-hidden="true" />}
          label={<span>Skip</span>}
          theme="secondary"
        />
        <Button
          disabled={busy}
          callback={update}
          icon={<Download aria-hidden="true" />}
          label={
            <span>
              {busy ? (state.progress === null ? 'Updating' : `${state.progress}%`) : 'Update'}
            </span>
          }
          theme="primary"
        />
      </div>
    </section>
  )
}
