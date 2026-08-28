import type { ReactElement } from 'react'
import type { WorkspaceController } from '../../useWorkspaceController'
import { ConversationHeaderContent } from './ConversationHeaderContent'

type ConversationHeaderProps = WorkspaceController['conversationHeader']

export function ConversationHeader(props: ConversationHeaderProps): ReactElement | null {
  if (!props.visible) return null
  return <ConversationHeaderContent {...props} />
}
