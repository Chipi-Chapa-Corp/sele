import { AnimatePresence } from 'motion/react'
import { MotionListItem } from '../../motion/MotionListItem'
import { AppUpdatePrompt } from './AppUpdatePrompt'
import { useState, type ReactElement } from 'react'
import type { ChatImportPreview } from '../../../../shared/chatArchive'
import { providerApi } from '../../providerApi'
import { ChatImportDialog } from '../../components/ChatImportDialog'
import type { WorkspaceController } from '../../useWorkspaceController'
import { Download, LoaderCircle, Search, SquarePen, X } from 'lucide-react'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { ChatSidebarLoadingState } from '../../components/AppStatusStates'

type ChatSidebarProps = WorkspaceController['chatSidebar']

export function ChatSidebar(props: ChatSidebarProps): ReactElement {
  const {
    handleImportedChat,
    importedChatGroup,
    chats,
    chromeControlTheme,
    displayedActiveChatGroups,
    doneChatGroup,
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
    sidebarSearch,
    setSearchOpen,
    setSearchQuery
  } = props
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
  const hasVisibleGroups = Boolean(
    pinnedChatGroup || importedChatGroup || displayedActiveChatGroups.length > 0 || doneChatGroup
  )

  const groups = [
    pinnedChatGroup,
    importedChatGroup,
    ...displayedActiveChatGroups,
    doneChatGroup
  ].filter((group) => group !== null && group !== undefined)
  const groupOrder = groups
    .map(
      (group) =>
        `${group.key}:${group.chats.map((chat) => `${chat.providerId}:${chat.id}`).join(',')}`
    )
    .join('\n')

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
                aria-busy={sidebarSearch.loading}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') handleCloseSearch()
                }}
              />
              {sidebarSearch.loading && (
                <span
                  className="chat-home__search-spinner"
                  role="status"
                  aria-label="Searching conversations"
                >
                  <LoaderCircle className="app-loading-spinner" aria-hidden="true" />
                </span>
              )}
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
                aria-label="Import chat"
                title="Import chat"
                disabled={openingImport || preview !== null}
                callback={openImport}
                icon={
                  openingImport ? (
                    <LoaderCircle className="app-loading-spinner" aria-hidden="true" />
                  ) : (
                    <Download aria-hidden="true" />
                  )
                }
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
      <div className="chat-sidebar__body">
        {importError && (
          <p className="chat__status" role="alert">
            {importError}
          </p>
        )}
        {loadState === 'loading' && chats.length === 0 && (
          <ChatSidebarLoadingState label="Loading conversations" />
        )}
        {loadState === 'error' && <p className="chat__status">Unable to load chats.</p>}
        {loadState === 'ready' && !hasVisibleGroups && !sidebarSearch.loading && (
          <p className="chat__status">
            {searchQuery.trim() ? 'No matching chats.' : 'No chats found.'}
          </p>
        )}
        {sidebarSearch.error && (
          <p className="chat__status" role="status">
            {sidebarSearch.error}
          </p>
        )}
        <div
          className="chat-list-stack"
          onDragOver={handleProjectStackDragOver}
          onDrop={handleProjectDrop}
        >
          {/* groupOrder drives layout changes without broadcasting each workspace render to all rows. */}
          <AnimatePresence initial={false} mode="popLayout" presenceAffectsLayout={false}>
            {groups.map((group) => (
              <MotionListItem key={group.key} order={groupOrder}>
                {renderChatGroup(group, `chat-group-${encodeURIComponent(group.key)}`)}
              </MotionListItem>
            ))}
          </AnimatePresence>
        </div>
        {sidebarSearch.hasMore && (
          <Button
            theme="transparent"
            label="More search results"
            disabled={sidebarSearch.loading}
            callback={sidebarSearch.loadMore}
          />
        )}
      </div>
      <AppUpdatePrompt />
    </aside>
  )
}
