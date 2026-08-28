import type { ReactElement } from 'react'
import { VegvisirArt } from '../../components/VegvisirArt'
import type { WorkspaceController } from '../../useWorkspaceController'

type ConversationEmptyStateProps = WorkspaceController['conversationEmptyState']

export function ConversationEmptyState({
  visible
}: ConversationEmptyStateProps): ReactElement | null {
  if (!visible) return null

  return (
    <div className="chat-panel__new-chat-empty" aria-hidden="true">
      <VegvisirArt />
    </div>
  )
}
