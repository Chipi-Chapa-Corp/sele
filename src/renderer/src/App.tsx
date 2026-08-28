import './App.css'
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

export const App: React.FC = () => {
  const workspace = useWorkspaceController()

  return (
    <main className={workspace.className}>
      <AppDialogs {...workspace.dialogs} />
      <WorkspaceShell
        {...workspace.layout}
        chatSidebar={<ChatSidebar {...workspace.chatSidebar} />}
        conversation={
          <ConversationPanel
            {...workspace.conversationPanel}
            header={<ConversationHeader {...workspace.conversationHeader} />}
            search={<ConversationSearch {...workspace.conversationSearch} />}
            messages={<ConversationMessages {...workspace.conversationMessages} />}
            quoteAction={<ConversationQuoteAction {...workspace.conversationQuote} />}
            emptyState={<ConversationEmptyState {...workspace.conversationEmptyState} />}
            plan={<ConversationPlan {...workspace.conversationPlan} />}
            composer={<ConversationComposer {...workspace.conversationComposer} />}
          />
        }
        changesSidebar={
          <ChangesSidebar
            header={<ChangesHeader {...workspace.changesHeader} />}
            content={<ChangesContent {...workspace.changesContent} />}
            footer={<ChangesFooter {...workspace.changesFooter} />}
          />
        }
      />
    </main>
  )
}
