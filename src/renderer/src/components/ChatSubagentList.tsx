import { CornerDownRight, LoaderCircle, X } from 'lucide-react'
import { memo, type CSSProperties, type ReactElement } from 'react'
import type { ProviderSubagent } from '../../../shared/provider'
import { orderSubagentTree } from '../subagentUi'
import { Button } from './Button'
import './ChatListItem.css'
import './ChatSubagentList.css'

type ChatSubagentListProps = {
  activeSubagentId: string | null
  cancelingSubagentIds: ReadonlySet<string>
  parentTitle: string
  subagents: readonly ProviderSubagent[]
  onCancel: (subagent: ProviderSubagent) => void
  onOpen: (subagent: ProviderSubagent) => void
}

const isSubagentActive = (subagent: ProviderSubagent): boolean =>
  subagent.status === 'pending' || subagent.status === 'running'

// Same status vocabulary as chat rows: a spinner while working, a dot on failure, nothing otherwise.
function SubagentStatus({ subagent }: { subagent: ProviderSubagent }): ReactElement | null {
  if (isSubagentActive(subagent)) {
    const label = subagent.status === 'pending' ? 'Starting' : 'Working'
    return (
      <span
        className="chat-list-item__status-container chat-list-item__status-container--leading"
        title={label}
      >
        <LoaderCircle className="app-loading-spinner chat-list-item__loading" aria-label={label} />
      </span>
    )
  }
  if (subagent.status !== 'failed') return null
  return (
    <span
      className="chat-list-item__status-container chat-list-item__status-container--leading"
      title="Failed"
    >
      <span
        className="chat-list-item__status chat-list-item__status--error"
        role="img"
        aria-label="Failed"
      />
    </span>
  )
}

/** Subagent chats of the selected chat, listed under its sidebar row with chat row styling. */
export const ChatSubagentList = memo(function ChatSubagentList({
  activeSubagentId,
  cancelingSubagentIds,
  parentTitle,
  subagents,
  onCancel,
  onOpen
}: ChatSubagentListProps): ReactElement | null {
  if (subagents.length === 0) return null

  return (
    <ul className="chat-subagent-list" aria-label={`Subagent chats of ${parentTitle}`}>
      {orderSubagentTree(subagents).map(({ subagent, depth }) => {
        const active = subagent.id === activeSubagentId
        const working = isSubagentActive(subagent)
        const cancelLabel = `Cancel ${subagent.title}`
        return (
          <li
            key={subagent.id}
            className="chat-subagent-list__item"
            style={{ '--chat-subagent-depth': depth } as CSSProperties}
          >
            <CornerDownRight className="chat-subagent-list__arrow" aria-hidden="true" />
            <article
              className={`chat-list-item${working ? ' chat-list-item--working' : ''}${active ? ' chat-list-item--selected' : ''}${working ? ' chat-subagent-list__row--cancelable' : ''}`}
            >
              <button
                type="button"
                className="chat-list-item__main"
                aria-current={active ? 'true' : undefined}
                title={subagent.title}
                onClick={() => onOpen(subagent)}
              >
                <span className="chat-list-item__header">
                  <SubagentStatus subagent={subagent} />
                  <span className="chat-list-item__title">{subagent.title}</span>
                </span>
              </button>
              {working && (
                <span className="chat-list-item__actions">
                  <Button
                    theme="transparent"
                    size="small"
                    aria-label={cancelLabel}
                    title={cancelLabel}
                    disabled={cancelingSubagentIds.has(subagent.id)}
                    callback={() => onCancel(subagent)}
                    icon={<X aria-hidden="true" />}
                  />
                </span>
              )}
            </article>
          </li>
        )
      })}
    </ul>
  )
})
