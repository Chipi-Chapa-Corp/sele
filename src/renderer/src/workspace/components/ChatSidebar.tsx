import { ChatSidebarGroups } from './ChatSidebarGroups'
import { AppUpdatePrompt } from './AppUpdatePrompt'
import { SidebarProviderAccount } from './SidebarProviderAccount'
import { UsageIndicator } from '../../components/UsageIndicator'
import { getVisibleUsageBadges } from '../../usageBadges'
import { selectBadgeBalance } from '../../accountBalances'
import { memo, useState, type ReactElement } from 'react'
import { useStableProps } from '../stableProps'
import { ChatSidebarHeader } from './ChatSidebarHeader'
import type { ChatImportPreview } from '../../../../shared/chatArchive'
import { providerApi } from '../../providerApi'
import { ChatImportDialog } from '../../components/ChatImportDialog'
import type { WorkspaceController } from '../../useWorkspaceController'
import { MessageSquare, Search, SquarePen, Settings } from 'lucide-react'
import { ChatSleepActionsContext } from '../../chatSleep'
import { ChatReadStateContext } from '../../manualChatReadState'
import { Button } from '../../components/Button'
import { ChatSidebarLoadingState } from '../../components/AppStatusStates'

export type ChatSidebarProps = WorkspaceController['chatSidebar'] & {
  mobile?: { onClose(): void; onSettings(): void }
}

export function ChatSidebar(props: ChatSidebarProps): ReactElement {
  const {
    handleImportedChat,
    chatSidebarFilter,
    chatSidebarTabs,
    hasWorkingChats,
    chatReadState,
    handleChatSidebarFilterChange,
    chatCount,
    sidebarGroups,
    chromeControlTheme,
    handleCloseSearch,
    handleNewChat,
    handleNewChatNoProject,
    handleProjectDrop,
    handleProjectStackDragOver,
    loadState,
    providerAccount,
    usageIndicator,
    renderChatGroup,
    renderSettingsButton,
    renderWindowControls,
    searchInputRef,
    searchOpen,
    searchQuery,
    sidebarSearch,
    setSearchOpen,
    setSearchQuery
  } = props
  const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null)
  const [preview, setPreview] = useState<ChatImportPreview | null>(null)
  const [openingImport, setOpeningImport] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const openImport = async (): Promise<void> => {
    setOpeningImport(true)
    setImportError(null)
    try {
      setPreview(await providerApi.openChatImport())
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    } finally {
      setOpeningImport(false)
    }
  }
  const headerProps = useStableProps({
    chatSidebarFilter,
    chatSidebarTabs,
    hasWorkingChats,
    handleChatSidebarFilterChange,
    chromeControlTheme,
    handleCloseSearch,
    handleNewChat,
    handleNewChatNoProject,
    renderSettingsButton,
    renderWindowControls,
    searchInputRef,
    searchOpen,
    searchQuery,
    setSearchOpen,
    setSearchQuery,
    mobile: props.mobile,
    openingImport,
    importDisabled: preview !== null,
    onOpenImport: openImport,
    searchLoading: sidebarSearch.loading
  })

  const hasVisibleGroups = sidebarGroups.size > 0

  return (
    <aside className="chat-sidebar" aria-label="Recent conversations">
      <ChatSidebarHeader {...headerProps} />
      {preview && (
        <ChatImportDialog
          preview={preview}
          onClose={() => setPreview(null)}
          onImported={(providerId, summary) => {
            setPreview(null)
            handleImportedChat(providerId, summary)
          }}
        />
      )}
      <div ref={setScrollParent} className="chat-sidebar__body">
        {importError && (
          <p className="chat__status" role="alert">
            {importError}
          </p>
        )}
        {loadState === 'loading' && chatCount === 0 && (
          <ChatSidebarLoadingState label="Loading conversations" />
        )}
        {loadState === 'error' && <p className="chat__status">Unable to load chats.</p>}
        {loadState === 'ready' && !hasVisibleGroups && !sidebarSearch.loading && (
          <p className="chat__status">
            {searchQuery.trim()
              ? 'No matching chats.'
              : chatSidebarFilter === 'sleeping'
                ? 'No sleeping chats.'
                : chatSidebarFilter === 'active'
                  ? 'No active chats.'
                  : chatSidebarFilter === 'working'
                    ? 'No chats in progress.'
                    : 'No chats found.'}
          </p>
        )}
        {sidebarSearch.error && (
          <p className="chat__status" role="status">
            {sidebarSearch.error}
          </p>
        )}
        <ChatSleepActionsContext.Provider
          value={chatSidebarTabs.sleeping && (chatSidebarFilter === 'sleeping' ? 'wake' : 'sleep')}
        >
          <ChatReadStateContext.Provider value={chatReadState}>
            <ChatSidebarGroups
              scrollParent={scrollParent}
              filterKey={chatSidebarFilter}
              sidebarGroups={sidebarGroups}
              renderChatGroup={renderChatGroup}
              handleProjectDrop={handleProjectDrop}
              handleProjectStackDragOver={handleProjectStackDragOver}
            />
          </ChatReadStateContext.Provider>
        </ChatSleepActionsContext.Provider>
        {sidebarSearch.hasMore && (
          <Button
            theme="transparent"
            label="More search results"
            disabled={sidebarSearch.loading}
            callback={sidebarSearch.loadMore}
          />
        )}
      </div>
      {props.mobile ? (
        <div className="mobile-sidebar-footer">
          <ChatSidebarFooter
            providerAccount={providerAccount}
            usageIndicator={usageIndicator}
            mobile
          />
          <div className="mobile-sidebar-footer__actions">
            <Button
              theme={chromeControlTheme}
              aria-label="New chat"
              icon={<SquarePen />}
              callback={handleNewChat}
            />
            <Button
              theme={chromeControlTheme}
              aria-label="New chat without a project"
              icon={<MessageSquare />}
              callback={handleNewChatNoProject}
            />
            <Button
              theme={chromeControlTheme}
              aria-label="Search conversations"
              aria-expanded={searchOpen}
              icon={<Search />}
              callback={() => setSearchOpen(true)}
            />
            <Button
              theme={chromeControlTheme}
              aria-label="Open settings"
              icon={<Settings />}
              callback={props.mobile.onSettings}
            />
          </div>
        </div>
      ) : (
        <ChatSidebarFooter providerAccount={providerAccount} usageIndicator={usageIndicator} />
      )}
    </aside>
  )
}

const ChatSidebarFooter = memo(function ChatSidebarFooter({
  providerAccount,
  usageIndicator,
  mobile
}: { mobile?: boolean } & Pick<
  ChatSidebarProps,
  'providerAccount' | 'usageIndicator'
>): ReactElement {
  return (
    <footer className="chat-sidebar__footer">
      <AppUpdatePrompt />
      <div className="chat-sidebar__account-row">
        <SidebarProviderAccount
          openCode={providerAccount.openCode}
          refreshKey={providerAccount.key}
          providerId={providerAccount.providerId}
          chatId={providerAccount.chatId}
          container={providerAccount.container}
          available={providerAccount.available}
          updating={providerAccount.updating}
          hasVisibleLimits={
            getVisibleUsageBadges(
              usageIndicator.accountUsage?.rateLimits ?? [],
              usageIndicator.contextUsage,
              usageIndicator.displayUsage
            ).length > 0 ||
            selectBadgeBalance(
              usageIndicator.accountUsage?.balances ?? [],
              usageIndicator.modelProviderId
            ) != null
          }
          onSelect={providerAccount.onSelect}
          onCreate={providerAccount.onCreate}
          onDelete={providerAccount.onDelete}
        />
        {!mobile && <UsageIndicator scopeKey={providerAccount.key} {...usageIndicator} />}
      </div>
    </footer>
  )
})
