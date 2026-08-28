import type { ReactElement } from 'react'
import type { WorkspaceController } from '../../useWorkspaceController'
import { ConversationMessagesContent } from './ConversationMessagesContent'

type ConversationMessagesProps = WorkspaceController['conversationMessages']

export function ConversationMessages(props: ConversationMessagesProps): ReactElement | null {
  if (!props.visible) return null
  return <ConversationMessagesContent {...props} />
}
