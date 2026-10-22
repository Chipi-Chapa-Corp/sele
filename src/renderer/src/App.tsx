import './App.css'
import { memo } from 'react'
import { useWorkspaceController } from './useWorkspaceController'
import { AppDialogs } from './workspace/components/AppDialogs'
import { ChangesContent } from './workspace/components/ChangesContent'
import { ChangesFooter } from './workspace/components/ChangesFooter'
import { ChangesHeader } from './workspace/components/ChangesHeader'
import { ChangesSidebar } from './workspace/components/ChangesSidebar'
import { ChatSidebar } from './workspace/components/ChatSidebar'
import { ConversationComposer } from './workspace/components/ConversationComposer'
import { ConversationEmptyState } from './workspace/components/ConversationEmptyState'
import { ConversationHeader } from './workspace/components/ConversationHeader'
import { ConversationMessages } from './workspace/components/ConversationMessages'
import { ConversationPanel } from './workspace/components/ConversationPanel'
import { ConversationPlan } from './workspace/components/ConversationPlan'
import { ConversationQuoteAction } from './workspace/components/ConversationQuoteAction'
import { ConversationSearch } from './workspace/components/ConversationSearch'
import { WorkspaceShell } from './workspace/components/WorkspaceShell'
import { useStableProps } from './workspace/stableProps'
import { LinkedChatOpenerContext } from './components/LinkedChatOpener'

// The controller renders for every workspace state change, including several times
// per chat switch. Each panel only rerenders when its own props change; see
// stableProps.ts for how handlers and render functions are treated.
const MemoChatSidebar = memo(ChatSidebar)
const MemoConversationHeader = memo(ConversationHeader)
const MemoConversationSearch = memo(ConversationSearch)
const MemoConversationMessages = memo(ConversationMessages)
const MemoConversationQuoteAction = memo(ConversationQuoteAction)
const MemoConversationPlan = memo(ConversationPlan)
const MemoConversationComposer = memo(ConversationComposer)
const MemoChangesHeader = memo(ChangesHeader)
const MemoChangesContent = memo(ChangesContent)
const MemoChangesFooter = memo(ChangesFooter)

const sidebarOptions = {
  nested: ['usageIndicator', 'providerAccount', 'openCode', 'sidebarSearch']
}
const messagesOptions = { nested: ['effectiveChatTurnWindow'] }

export const App: React.FC = () => {
  const workspace = useWorkspaceController()
  const chatSidebar = useStableProps(workspace.chatSidebar, sidebarOptions)
  const conversationHeader = useStableProps(workspace.conversationHeader)
  const conversationSearch = useStableProps(workspace.conversationSearch)
  const conversationMessages = useStableProps(workspace.conversationMessages, messagesOptions)
  const conversationQuote = useStableProps(workspace.conversationQuote)
  const conversationPlan = useStableProps(workspace.conversationPlan)
  const conversationComposer = useStableProps(workspace.conversationComposer)
  const changesHeader = useStableProps(workspace.changesHeader)
  const changesContent = useStableProps(workspace.changesContent)
  const changesFooter = useStableProps(workspace.changesFooter)

  return (
    <LinkedChatOpenerContext.Provider value={workspace.openLinkedChat}>
      <main className={workspace.className}>
        <AppDialogs {...workspace.dialogs} />
        <WorkspaceShell
          {...workspace.layout}
          chatSidebar={<MemoChatSidebar {...chatSidebar} />}
          conversation={
            <ConversationPanel
              {...workspace.conversationPanel}
              header={<MemoConversationHeader {...conversationHeader} />}
              search={<MemoConversationSearch {...conversationSearch} />}
              messages={<MemoConversationMessages {...conversationMessages} />}
              quoteAction={<MemoConversationQuoteAction {...conversationQuote} />}
              emptyState={<ConversationEmptyState {...workspace.conversationEmptyState} />}
              plan={<MemoConversationPlan {...conversationPlan} />}
              composer={<MemoConversationComposer {...conversationComposer} />}
            />
          }
          changesSidebar={
            <ChangesSidebar
              header={<MemoChangesHeader {...changesHeader} />}
              content={<MemoChangesContent {...changesContent} />}
              footer={<MemoChangesFooter {...changesFooter} />}
            />
          }
        />
      </main>
    </LinkedChatOpenerContext.Provider>
  )
}
