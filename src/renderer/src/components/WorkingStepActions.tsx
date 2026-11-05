import { Play, RefreshCw } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import { memo } from 'react'
import type {
  ProviderAccountRateLimitResetOutcome,
  ProviderWorkingStep
} from '../../../shared/provider'
import { getRateLimitResetMessage } from '../rateLimitReset'
import { Button } from './Button'
import { RateLimitResetButton } from './RateLimitResetButton'

type WorkingStepActionsProps = {
  authenticationFailed: boolean
  onReauthenticate: (() => void) | undefined
  onManageAccounts: (() => void) | undefined
  hasStoppedOrFailed: boolean
  onRetry: (() => Promise<void> | void) | undefined
  item: ProviderWorkingStep
  retryDisabled: boolean
  onContinue: (() => Promise<void> | void) | undefined
  continueDisabled: boolean
  setContinueClicked: Dispatch<SetStateAction<boolean>>
  rateLimitResetActions: {
    onContinue: () => Promise<void> | void
    onReset: () => Promise<ProviderAccountRateLimitResetOutcome>
  } | null
  availableRateLimitResets: number
  rateLimitResetDisabled: boolean
  setRateLimitResetMessage: Dispatch<SetStateAction<string | null>>
  onUsageRefresh: (() => Promise<void> | void) | undefined
  rateLimitResetMessage: string | null
}

export const WorkingStepActions = memo(function WorkingStepActions({
  authenticationFailed,
  onReauthenticate,
  onManageAccounts,
  hasStoppedOrFailed,
  onRetry,
  item,
  retryDisabled,
  onContinue,
  continueDisabled,
  setContinueClicked,
  rateLimitResetActions,
  availableRateLimitResets,
  rateLimitResetDisabled,
  setRateLimitResetMessage,
  onUsageRefresh,
  rateLimitResetMessage
}: WorkingStepActionsProps) {
  return (
    <div className="chat-detail__working-actions">
      {authenticationFailed && onReauthenticate && (
        <Button
          theme="primary"
          size="small"
          callback={onReauthenticate}
          label={<span>Sign in again</span>}
        />
      )}
      {authenticationFailed && onManageAccounts && (
        <Button
          theme="secondary"
          size="small"
          callback={onManageAccounts}
          label={<span>Manage accounts</span>}
        />
      )}
      {hasStoppedOrFailed && onRetry && (
        <Button
          theme="secondary"
          size="small"
          aria-label={`Retry ${item.status} turn`}
          title="Retry"
          disabled={retryDisabled}
          callback={onRetry}
          icon={<RefreshCw aria-hidden="true" />}
          label={<span>Retry</span>}
        />
      )}
      {hasStoppedOrFailed && onContinue && (
        <Button
          theme="secondary"
          size="small"
          aria-label={`Continue ${item.status} turn`}
          title="Continue"
          disabled={continueDisabled}
          callback={() => {
            setContinueClicked(true)
            return onContinue()
          }}
          icon={<Play aria-hidden="true" />}
          label={<span>Continue</span>}
        />
      )}
      {rateLimitResetActions && (
        <RateLimitResetButton
          availableCount={availableRateLimitResets}
          disabled={continueDisabled || rateLimitResetDisabled}
          onReset={rateLimitResetActions.onReset}
          onResetError={setRateLimitResetMessage}
          onResetResult={async (outcome) => {
            if (outcome !== 'reset') {
              setRateLimitResetMessage(getRateLimitResetMessage(outcome))
            }
            await onUsageRefresh?.()
            if (outcome === 'reset') {
              setContinueClicked(true)
              await rateLimitResetActions.onContinue()
            }
          }}
          onResetStart={() => setRateLimitResetMessage(null)}
          pendingLabel="Continuing.."
        />
      )}
      {rateLimitResetMessage && (
        <span className="chat-detail__working-action-status" role="status">
          {rateLimitResetMessage}
        </span>
      )}
    </div>
  )
})
