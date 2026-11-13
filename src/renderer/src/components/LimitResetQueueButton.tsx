import { Clock3 } from 'lucide-react'
import { formatSemanticLexicalDateDifference, useSemanticDateNow } from '../semanticDateDifference'
import { PromptDialogButton } from './ChatGoalButton'
import './LimitResetQueueButton.css'

type LimitResetQueueButtonProps = {
  triggerLabel: string | undefined
  resetsAt: number | null
  onOpen: () => void
  onQueue: (prompt: string) => Promise<void>
}

export const LimitResetQueueButton: React.FC<LimitResetQueueButtonProps> = ({
  triggerLabel,
  resetsAt,
  onOpen,
  onQueue
}) => {
  const now = useSemanticDateNow()
  const reset = formatSemanticLexicalDateDifference(resetsAt, { now, compact: true })

  return (
    <PromptDialogButton
      title="On Limit Reset"
      icon={<Clock3 aria-hidden="true" />}
      triggerLabel={triggerLabel}
      disabled={false}
      initialDraft=""
      headingDetail={
        reset ? (
          <time className="limit-reset-dialog__time" dateTime={reset.dateTime} title={reset.title}>
            {reset.label}
          </time>
        ) : (
          <span className="limit-reset-dialog__time">Reset time unavailable</span>
        )
      }
      closeLabel="Close reset queue window"
      inputLabel="Prompt"
      placeholder="What should happen when the limit resets?"
      submitLabel="Add to queue"
      errorTag="[caught:LimitResetQueueButton:save]"
      errorMessage="Unable to queue prompt."
      onOpen={onOpen}
      onSubmit={onQueue}
    />
  )
}
