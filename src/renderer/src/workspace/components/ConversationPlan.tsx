import type { ReactElement } from 'react'
import { ChatPlan } from '../../components/ChatPlan'
import type { WorkspaceController } from '../../useWorkspaceController'

type ConversationPlanProps = WorkspaceController['conversationPlan']

export function ConversationPlan(props: ConversationPlanProps): ReactElement | null {
  const { messageBoxPlan, selectedChatKey, visible } = props

  if (!visible) return null

  return <ChatPlan key={selectedChatKey ?? 'no-chat'} plan={messageBoxPlan} />
}
