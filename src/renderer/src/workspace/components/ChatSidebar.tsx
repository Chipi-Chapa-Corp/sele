import type { ReactElement } from 'react'
import type { WorkspaceController } from '../../useWorkspaceController'
import { Search, SquarePen, X } from 'lucide-react'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { ChatSidebarLoadingState } from '../../components/AppStatusStates'

type ChatSidebarProps = WorkspaceController['chatSidebar']

export function ChatSidebar(props: ChatSidebarProps): ReactElement {
  const {
    chats,
    chromeControlTheme,
    displayedActiveChatGroups,
    doneChatGroup,
    filteredChats,
    handleCloseSearch,
    handleNewChat,
    handleProjectDrop,
    handleProjectStackDragOver,
    loadState,
    pinnedChatGroup,
    renderChatGroup,
    renderChatGroupingButton,
    renderSettingsButton,
    renderWindowControls,
    searchInputRef,
    searchOpen,
    searchQuery,
    setSearchOpen,
    setSearchQuery
  } = props

  return (
    <aside className="chat-sidebar" aria-label="Recent conversations">
      <header className={`chat-home__header${searchOpen ? ' chat-home__header--searching' : ''}`}>
        {renderWindowControls('darwin')}
        {searchOpen ? (
          <>
            <label className="sr-only" htmlFor="chat-search">
              Search conversations
            </label>
            <div className="chat-home__search-field">
              <Input
                ref={searchInputRef}
                id="chat-search"
                type="search"
                value={searchQuery}
                placeholder="Search conversations"
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') handleCloseSearch()
                }}
              />
            </div>
            <Button
              theme={chromeControlTheme}
              aria-label="Close search"
              aria-controls="chat-search"
              title="Close search"
              callback={handleCloseSearch}
              icon={<X aria-hidden="true" />}
            />
          </>
        ) : (
          <div className="chat-home__actions">
            <div className="chat-home__actions-left">
              <span className="chat-home__settings-action">{renderSettingsButton()}</span>
              {renderChatGroupingButton()}
            </div>
            <div className="chat-home__actions-right">
              <Button
                theme={chromeControlTheme}
                aria-label="New chat"
                title="New chat"
                callback={handleNewChat}
                icon={<SquarePen aria-hidden="true" />}
              />
              <Button
                theme={chromeControlTheme}
                aria-label="Search conversations"
                aria-expanded={false}
                title="Search conversations"
                callback={() => setSearchOpen(true)}
                icon={<Search aria-hidden="true" />}
              />
            </div>
          </div>
        )}
      </header>
      <div className="chat-sidebar__body">
        {loadState === 'loading' && chats.length === 0 && (
          <ChatSidebarLoadingState label="Loading conversations" />
        )}
        {loadState === 'error' && <p className="chat__status">Unable to load chats.</p>}
        {loadState === 'ready' && chats.length === 0 && (
          <p className="chat__status">No chats found.</p>
        )}
        {loadState === 'ready' && chats.length > 0 && filteredChats.length === 0 && (
          <p className="chat__status">No matching chats.</p>
        )}
        {filteredChats.length > 0 && (
          <div
            className="chat-list-stack"
            onDragOver={handleProjectStackDragOver}
            onDrop={handleProjectDrop}
          >
            {pinnedChatGroup && renderChatGroup(pinnedChatGroup, 'pinned-chats-list')}
            {displayedActiveChatGroups.map((group, groupIndex) =>
              renderChatGroup(group, `cwd-chats-list-${groupIndex}`)
            )}
            {doneChatGroup && renderChatGroup(doneChatGroup, 'cwd-chats-list-done')}
          </div>
        )}
      </div>
    </aside>
  )
}
