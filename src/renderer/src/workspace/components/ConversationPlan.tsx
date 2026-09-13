import type { ReactElement } from 'react'
import { ChatGoal } from '../../components/ChatGoal'
import { ChatPlan } from '../../components/ChatPlan'
import type { WorkspaceController } from '../../useWorkspaceController'

type ConversationPlanProps = WorkspaceController['conversationPlan']

export function ConversationPlan(props: ConversationPlanProps): ReactElement | null {
  const { messageBoxPlan, selectedChatKey, visible, goal, onSaveGoalObjective } = props

  if (!visible) return null

  return (
    <>
      {goal?.status === 'active' && (
        <ChatGoal
          key={`goal:${selectedChatKey}:${goal.createdAt}`}
          goal={goal}
          onSaveObjective={onSaveGoalObjective}
        />
      )}
      <ChatPlan key={selectedChatKey ?? 'no-chat'} plan={messageBoxPlan} />
    </>
  )
}
