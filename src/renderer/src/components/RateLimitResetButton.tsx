import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type {
  ProviderAccountRateLimitResetOutcome,
  ProviderAccountRateLimitResetOption
} from '../../../shared/provider'
import { formatRateLimitResetExpirationDate } from '../rateLimitReset'
import { Button } from './Button'
import './RateLimitResetButton.css'

const numberFormatter = new Intl.NumberFormat()

type RateLimitResetButtonProps = {
  availableCount: number
  options?: ProviderAccountRateLimitResetOption[]
  disabled: boolean
  onReset: (creditId?: string) => Promise<ProviderAccountRateLimitResetOutcome>
  onResetError: (message: string) => void
  onResetResult: (outcome: ProviderAccountRateLimitResetOutcome) => Promise<void> | void
  onResetStart: () => void
  pendingLabel?: string
}

export const RateLimitResetButton: React.FC<RateLimitResetButtonProps> = ({
  availableCount,
  options,
  disabled,
  onReset,
  onResetError,
  onResetResult,
  onResetStart,
  pendingLabel = 'Resetting...'
}) => {
  const [pending, setPending] = useState(false)
  const [selectedId, setSelectedId] = useState<string>()
  const selected =
    options?.find((option) => option.id === selectedId) ??
    options?.find((option) => option.usable) ??
    options?.[0]
  const expired = selected?.expiresAt != null && selected.expiresAt <= Date.now()
  const unavailable = options !== undefined && (!selected?.usable || expired)

  const handleReset = async (): Promise<void> => {
    if (disabled || pending || unavailable || availableCount <= 0) return

    const resetCountLabel =
      availableCount === 1
        ? 'your last remaining reset'
        : `one of your ${numberFormatter.format(availableCount)} remaining resets`
    const confirmation = selected
      ? `Use one ${selected.label.toLowerCase()}? ${selected.description}\n\n${selected.availableCount} left. ${formatRateLimitResetExpirationDate(selected.expiresAt)}. This cannot be undone.`
      : `Use ${resetCountLabel} to reset your rate limits?`
    if (!window.confirm(confirmation)) return

    setPending(true)
    onResetStart()

    try {
      const outcome = await onReset(selected?.id)
      await onResetResult(outcome)
    } catch (error) {
      console.error('[caught:RateLimitResetButton:handleReset]', error)
      onResetError(error instanceof Error ? error.message : 'Unable to reset rate limits.')
    } finally {
      setPending(false)
    }
  }

  return (
    <span className="rate-limit-reset-controls">
      {options && selected && (
        <label>
          <span className="sr-only">Reset type</span>
          <select
            aria-label="Reset type"
            disabled={disabled || pending}
            value={selected.id}
            onChange={(event) => setSelectedId(event.target.value)}
            title={selected.description}
          >
            {options.map((option) => (
              <option key={option.id} value={option.id} disabled={!option.usable}>
                {option.label} ({option.availableCount} left)
              </option>
            ))}
          </select>
        </label>
      )}
      <Button
        callback={handleReset}
        disabled={disabled || pending || unavailable}
        icon={<RotateCcw aria-hidden="true" />}
        label={pending ? pendingLabel : 'Reset limits'}
        size="small"
        theme="secondary"
      />
    </span>
  )
}
