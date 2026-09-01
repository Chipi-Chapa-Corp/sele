import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { ProviderAccountRateLimitResetOutcome } from '../../../shared/provider'
import { Button } from './Button'

const numberFormatter = new Intl.NumberFormat()

type RateLimitResetButtonProps = {
  availableCount: number
  disabled?: boolean
  onReset: () => Promise<ProviderAccountRateLimitResetOutcome>
  onResetError?: (message: string) => void
  onResetResult?: (outcome: ProviderAccountRateLimitResetOutcome) => Promise<void> | void
  onResetStart?: () => void
}

export const RateLimitResetButton: React.FC<RateLimitResetButtonProps> = ({
  availableCount,
  disabled = false,
  onReset,
  onResetError,
  onResetResult,
  onResetStart
}) => {
  const [pending, setPending] = useState(false)

  const handleReset = async (): Promise<void> => {
    if (disabled || pending || availableCount <= 0) return

    const resetCountLabel =
      availableCount === 1
        ? 'your last remaining reset'
        : `one of your ${numberFormatter.format(availableCount)} remaining resets`
    if (!window.confirm(`Use ${resetCountLabel} to reset your Codex rate limits?`)) return

    setPending(true)
    onResetStart?.()

    try {
      const outcome = await onReset()
      await onResetResult?.(outcome)
    } catch (error) {
      onResetError?.(error instanceof Error ? error.message : 'Unable to reset rate limits.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      callback={handleReset}
      disabled={disabled || pending}
      icon={<RotateCcw aria-hidden="true" />}
      label={pending ? 'Resetting...' : 'Reset limits'}
      size="small"
      theme="secondary"
    />
  )
}
