import { useEffect, useId, useState } from 'react'
import { ChevronUp, Clock3, X } from 'lucide-react'
import type {
  ProviderId,
  ProviderLimitResetMessage,
  ProviderLimitResetTarget
} from '../../../shared/provider'
import { providerApi } from '../providerApi'
import { formatSemanticLexicalDateDifference, useSemanticDateNow } from '../semanticDateDifference'
import { Button } from './Button'
import './ChatPlan.css'
import './LimitResetQueueMessages.css'

export function LimitResetQueueMessages({
  providerId,
  target
}: {
  providerId: ProviderId
  target: ProviderLimitResetTarget
}) {
  const drawerId = useId()
  const now = useSemanticDateNow()
  const [open, setOpen] = useState(false)
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

  if (!messages.length) return null
  const reset = formatSemanticLexicalDateDifference(
    Math.min(...messages.map((entry) => entry.resetsAt)),
    { now, compact: true }
  )
  return (
    <section className="chat-plan limit-reset-queue" aria-label="On Limit Reset queue">
      <button
        type="button"
        className="chat-plan__toggle"
        aria-expanded={open}
        aria-controls={drawerId}
        aria-label={open ? 'Hide reset queue' : 'Show reset queue'}
        onClick={() => setOpen(!open)}
      >
        <span className="chat-plan__title">
          <Clock3 className="chat-plan__chevron" aria-hidden="true" /> On Limit Reset
        </span>
        <span className="chat-plan__current">{messages[0].content}</span>
        <span className="limit-reset-queue__metadata">
          {reset && (
            <time className="limit-reset-queue__date" dateTime={reset.dateTime} title={reset.title}>
              {reset.label}
            </time>
          )}
          <span className="chat-plan__progress">{messages.length}</span>
        </span>
        <ChevronUp className="chat-plan__chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="chat-plan__drawer" id={drawerId}>
          <ul className="chat-plan__list">
            {messages.map((entry) => (
              <li className="limit-reset-queue__message" key={entry.id}>
                <div>
                  <p>{entry.content}</p>
                  {entry.error && (
                    <p className="chat-approval__error" role="status">
                      Waiting to join the chat queue: {entry.error}
                    </p>
                  )}
                </div>
                <Button
                  theme="secondary"
                  size="small"
                  aria-label="Remove reset prompt"
                  title="Remove prompt"
                  disabled={Boolean(removing)}
                  icon={<X aria-hidden="true" />}
                  callback={() => remove(entry.id)}
                />
              </li>
            ))}
          </ul>
          {error && (
            <p className="chat-approval__error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
