import { useEffect, useLayoutEffect, useState } from 'react'
import type {
  ProviderId,
  ProviderLimitResetMessage,
  ProviderLimitResetTarget
} from '../../../shared/provider'
import { providerApi } from '../providerApi'
import { formatSemanticLexicalDateDifference, useSemanticDateNow } from '../semanticDateDifference'
import { ChatDetailItem } from './ChatDetailItem'
import './LimitResetQueueMessages.css'

export function LimitResetQueueMessages({
  providerId,
  target,
  onMessagesChange
}: {
  providerId: ProviderId
  target: ProviderLimitResetTarget
  onMessagesChange?: (count: number) => void
}) {
  const now = useSemanticDateNow()
  const [messages, setMessages] = useState<ProviderLimitResetMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let sequence = 0
    const refresh = async (): Promise<void> => {
      if (!providerApi.getLimitResetMessages) return
      const request = ++sequence
      try {
        const entries = await providerApi.getLimitResetMessages(providerId, target)
        if (active && request === sequence) {
          setMessages(entries)
          setError(null)
        }
      } catch (error) {
        console.error('Unable to load the limit reset queue.', error)
        if (active && request === sequence) setError('Unable to load the On Limit Reset queue.')
      }
    }
    void refresh()
    const changed = (): void => {
      void refresh()
    }
    const interval = setInterval(changed, 5_000)
    window.addEventListener('sele-limit-reset-queue-changed', changed)
    return () => {
      active = false
      clearInterval(interval)
      window.removeEventListener('sele-limit-reset-queue-changed', changed)
    }
  }, [providerId, target])

  const remove = async (id: string): Promise<void> => {
    if (removing) return
    setRemoving(id)
    try {
      await providerApi.deleteLimitResetMessage(providerId, target, id)
      setMessages((current) => current.filter((entry) => entry.id !== id))
      window.dispatchEvent(new Event('sele-limit-reset-queue-changed'))
    } catch (error) {
      console.error('Unable to remove a limit reset prompt.', error)
      setError('Unable to remove the prompt. Try again.')
    } finally {
      setRemoving(null)
    }
  }

  useLayoutEffect(() => {
    onMessagesChange?.(messages.length)
  }, [messages.length, onMessagesChange])

  if (!messages.length) return null
  return (
    <section className="limit-reset-queue" aria-label="On Limit Reset queue">
      {messages.map((entry, index) => {
        const reset = formatSemanticLexicalDateDifference(entry.resetsAt, { now, compact: true })
        const showLabel = index === 0 || messages[index - 1].resetsAt !== entry.resetsAt
        return (
          <div className="limit-reset-queue__message" key={entry.id}>
            <ChatDetailItem
              item={{ type: 'pendingMessage', kind: 'queued', ...entry }}
              pendingMessageLabel={
                showLabel ? (
                  <>
                    On reset
                    {reset && (
                      <>
                        {' '}
                        <time dateTime={reset.dateTime} title={reset.title}>
                          {reset.label}
                        </time>
                      </>
                    )}
                  </>
                ) : null
              }
              pendingMessageDeleteDisabled={Boolean(removing)}
              onDeletePendingMessage={() => void remove(entry.id)}
            />
            {entry.error && (
              <p className="chat-approval__error" role="status">
                Waiting to join the chat queue: {entry.error}
              </p>
            )}
          </div>
        )
      })}
      {error && (
        <p className="chat-approval__error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
