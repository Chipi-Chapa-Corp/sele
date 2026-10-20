import { ArrowUpRight, Bot } from 'lucide-react'
import type { ReactElement } from 'react'
import type { ProviderSubagent } from '../../../shared/provider'
import './ChatDetailItem.css'
import './SubagentCompletionBubble.css'

export function SubagentCompletionBubble({
  subagent,
  onOpen
}: {
  subagent: ProviderSubagent
  onOpen: (subagent: ProviderSubagent) => void
}): ReactElement {
  const outcome =
    subagent.status === 'failed' ? 'failed' : subagent.status === 'stopped' ? 'stopped' : 'finished'
  return (
    <div
      className="chat-detail__message-block chat-detail__message-block--assistant chat-subagent-completion"
      data-subagent-completion-id={subagent.id}
    >
      <button
        type="button"
        className="chat-detail__message chat-detail__message--user chat-subagent-completion__bubble"
        aria-label={`Open ${subagent.title} subagent chat`}
        onClick={() => onOpen(subagent)}
      >
        <Bot aria-hidden="true" />
        <span>
          {subagent.title} {outcome}
        </span>
        <ArrowUpRight aria-hidden="true" />
      </button>
    </div>
  )
}
