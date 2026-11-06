import type { ReactElement } from 'react'
import type { WorkspaceController } from '../../useWorkspaceController'
import { ConversationMessagesContent } from './ConversationMessagesContent'
import { RetainedChatViews } from '../../components/RetainedChatViews'

type ConversationMessagesProps = WorkspaceController['conversationMessages']

// A map keeps React's dev changed-props formatter from serializing both whole
// transcripts when switching chats. The current snapshot still changes by identity.
export function ConversationMessages({
  view
}: {
  view: ReadonlyMap<'current', ConversationMessagesProps>
}): ReactElement {
  const props = view.get('current')!
  const loading =
    !props.chatKnown &&
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
      retain={!loading && !props.activeSubagentChatView && props.renderedChatTurns.length > 0}
    >
      {props.visible ? <ConversationMessagesContent {...props} /> : null}
    </RetainedChatViews>
  )
}
