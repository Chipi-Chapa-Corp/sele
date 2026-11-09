import { useEffect, useState } from 'react'
import { FileText, RefreshCw, Square } from 'lucide-react'
import type { ProviderProcessGroup } from '../../../shared/terminal'
import { terminalApi } from '../terminalApi'
import { Button } from './Button'

export const ProviderProcesses: React.FC<{
  chatKey: string | null
  active: boolean
  onOpenLog: (group: ProviderProcessGroup, path: string) => void
}> = ({ chatKey, active, onOpenLog }) => {
  const [groups, setGroups] = useState<ProviderProcessGroup[]>([])
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [stopping, setStopping] = useState<string | null>(null)
  useEffect(() => {
    setGroups([])
    setError(null)
    if (!active) return
    let disposed = false
    let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const result = await terminalApi.listProcessGroups(chatKey)
        if (!disposed) {
          setGroups(result)
          setError(null)
        }
      } catch (failure) {
        if (!disposed) setError(failure instanceof Error ? failure.message : String(failure))
      } finally {
        polling = false
      }
    }
    void poll()
    const timer = setInterval(() => {
      void poll()
    }, 5000)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [chatKey, active, refresh])

  const stop = async (group: ProviderProcessGroup) => {
    setStopping(group.id)
    try {
      await terminalApi.stopProcessGroup(group.id)
      setRefresh((value) => value + 1)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setStopping(null)
    }
  }
  const visibleGroups = groups.filter(
    (group) => !chatKey || `${group.providerId}:${group.chatId}` === chatKey
  )
  return (
    <div className="terminal-processes" aria-label="Chat processes">
      <div className="terminal-processes__heading">
        <span>Chat processes</span>
        <Button
          theme="transparent"
          size="small"
          aria-label="Refresh processes"
          title="Refresh processes"
          icon={<RefreshCw aria-hidden="true" />}
          callback={() => setRefresh((value) => value + 1)}
        />
      </div>
      {error && <p role="alert">{error}</p>}
      {chatKey && !visibleGroups.length && !error && <p>No tracked processes for this chat.</p>}
      {visibleGroups.map((group) => (
        <div key={group.id} className="terminal-processes__group">
          {!chatKey && (
            <small>
              {group.providerId} · {group.chatId ?? 'Unassigned launch'}
            </small>
          )}
          <div className="terminal-processes__heading">
            <span>
              {group.status === 'tracked'
                ? `${group.processes.length} processes tracked`
                : 'Tracking unavailable'}
            </span>
            {(group.canStop || group.processes.length > 0) && (
              <Button
                theme="transparent"
                size="small"
                label={stopping === group.id ? 'Stopping…' : 'Stop all'}
                disabled={stopping !== null}
                icon={<Square aria-hidden="true" />}
                callback={() => stop(group)}
              />
            )}
          </div>
          {group.reason && <p>{group.reason}</p>}
          {group.processes.length > 0 && <p>Stop all also stops this chat’s agent runtime.</p>}
          {group.processes.map((process) => (
            <div className="terminal-processes__process" key={process.pid}>
              <code title={process.command}>
                {process.pid} {process.command || '(exiting)'}
              </code>
              {process.cwd && <small title={process.cwd}>{process.cwd}</small>}
              {process.logs.map((path) => (
                <Button
                  key={path}
                  theme="transparent"
                  size="small"
                  label="Open log"
                  title={path}
                  icon={<FileText aria-hidden="true" />}
                  callback={() => onOpenLog(group, path)}
                />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
