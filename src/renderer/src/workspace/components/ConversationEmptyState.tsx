import { memo, useEffect, useState, type ReactElement } from 'react'
import { VegvisirArt } from '../../components/VegvisirArt'
import type { WorkspaceController } from '../../useWorkspaceController'

type ConversationEmptyStateProps = WorkspaceController['conversationEmptyState']

export const ConversationEmptyState = memo(function ConversationEmptyState({
  visible
}: ConversationEmptyStateProps): ReactElement | null {
  const [hasShown, setHasShown] = useState(visible)
  useEffect(() => {
    if (visible) setHasShown(true)
  }, [visible])
  if (!visible && !hasShown) return null

  // Retain the transferred canvas across navigation; the worker pauses while hidden.

  return (
    <div
      className="chat-panel__new-chat-empty"
      aria-hidden="true"
      style={visible ? undefined : { display: 'none' }}
    >
      <VegvisirArt active={visible} />
    </div>
  )
})
