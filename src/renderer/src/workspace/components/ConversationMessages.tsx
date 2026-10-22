import type { ReactElement } from 'react'
import type { WorkspaceController } from '../../useWorkspaceController'
import { ConversationMessagesContent } from './ConversationMessagesContent'
import { RetainedChatViews } from '../../components/RetainedChatViews'

type ConversationMessagesProps = WorkspaceController['conversationMessages']

export function ConversationMessages(props: ConversationMessagesProps): ReactElement {
  const loading =
    !props.activeSubagentChatView &&
    props.chatLoadState === 'loading' &&
    props.visibleChatItems.length === 0
  const activeKey = !props.visible
    ? null
    : loading
      ? `${props.selectedChatKey}:loading`
      : props.selectedChatKey
  return (
    <RetainedChatViews
      activeKey={activeKey}
      cachedChatKeys={props.cachedChatKeys}
      retain={
        !loading &&
        !props.activeSubagentChatView &&
        !props.chatHasActiveTurn &&
        props.renderedChatTurns.length > 0
      }
    >
      {props.visible ? <ConversationMessagesContent {...props} /> : null}
    </RetainedChatViews>
  )
}
