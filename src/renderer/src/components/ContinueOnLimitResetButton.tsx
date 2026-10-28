import { useEffect, useRef, useState } from 'react'
import { Clock3 } from 'lucide-react'
import { formatSemanticLexicalDateDifference, useSemanticDateNow } from '../semanticDateDifference'
import { Button } from './Button'

export function ContinueOnLimitResetButton({
  disabled = false,
  resetsAt,
  onQueue
}: {
  disabled?: boolean
  resetsAt: number
  onQueue: () => Promise<void>
}) {
  const semanticNow = useSemanticDateNow()
  const [expiryNow, setExpiryNow] = useState(0)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const savingRef = useRef(false)
  const now = Math.max(semanticNow, expiryNow, Date.now())
  const reset = formatSemanticLexicalDateDifference(resetsAt, { now, compact: true })

  useEffect(() => {
    const remaining = resetsAt - Math.max(expiryNow, Date.now())
    if (!Number.isFinite(remaining) || remaining <= 0) return
    // Hide at the deadline, even between the shared relative-date clock's ticks.
    const timeout = window.setTimeout(
      () => setExpiryNow(Date.now()),
      Math.min(remaining, 2_147_483_647)
    )
    return () => window.clearTimeout(timeout)
  }, [resetsAt, expiryNow])

  if (!reset || resetsAt <= now) return null

  const queue = async (): Promise<void> => {
    if (disabled || savingRef.current || resetsAt <= Date.now()) return
    savingRef.current = true
    setSaving(true)
    setMessage(null)
    try {
      await onQueue()
      setMessage('Continuation added to the On Limit Reset queue.')
    } catch (error) {
      console.error('Unable to queue continuation after limit reset.', error)
      setMessage(error instanceof Error ? error.message : 'Unable to queue continuation.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        theme="secondary"
        size="small"
        aria-label={`Continue ${reset.label}`}
        title={`Continue automatically after the limit resets: ${reset.title}`}
        disabled={disabled || saving}
        callback={queue}
        icon={<Clock3 aria-hidden="true" />}
        label={<span>{saving ? 'Queuing…' : `Continue ${reset.label}`}</span>}
      />
      {message && (
        <span className="chat-detail__working-action-status" role="status">
          {message}
        </span>
      )}
    </>
  )
}
