import { memo, useState, useTransition, type ReactElement } from 'react'
import {
  BotMessageSquare,
  Download,
  MessagesSquare,
  MessageSquare,
  MessageSquareDashed,
  MessageSquareText,
  Search,
  SquarePen,
  X
} from 'lucide-react'
import { chatSidebarFilters, type ChatSidebarFilter } from '../../chatSidebarFilter'
import { SegmentedControl } from '../../components/SegmentedControl'
import { WorkingChatsIcon } from '../../components/WorkingChatsIcon'
import { Spinner } from '../../components/Spinner'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import type { ChatSidebarProps } from './ChatSidebar'

const filterIcons = {
  all: MessagesSquare,
  active: MessageSquareText,
  sleeping: MessageSquareDashed,
  working: BotMessageSquare
}

type Props = Pick<
  ChatSidebarProps,
  | 'chatSidebarFilter'
  | 'chatSidebarTabs'
  | 'hasWorkingChats'
  | 'handleChatSidebarFilterChange'
  | 'chromeControlTheme'
  | 'handleCloseSearch'
  | 'handleNewChat'
  | 'handleNewChatNoProject'
  | 'renderSettingsButton'
  | 'renderWindowControls'
  | 'searchInputRef'
  | 'searchOpen'
  | 'searchQuery'
  | 'setSearchOpen'
  | 'setSearchQuery'
  | 'mobile'
> & {
  openingImport: boolean
  importDisabled: boolean
  onOpenImport: () => void
  searchLoading: boolean
}

export const ChatSidebarHeader = memo(function ChatSidebarHeader({
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
  mobile,
  openingImport,
  importDisabled,
  onOpenImport,
  searchLoading
}: Props): ReactElement {
  const [requestedFilter, setRequestedFilter] = useState(chatSidebarFilter)
  const [filterPending, startFilterTransition] = useTransition()
  const filterTabs = Object.values(chatSidebarTabs).some(Boolean) && (
    <SegmentedControl<ChatSidebarFilter>
      aria-label="Filter conversations"
      className="chat-home__filter-tabs"
      size="small"
      value={filterPending ? requestedFilter : chatSidebarFilter}
      onChange={(filter) => {
        // The pressed tab updates locally now; catalog reconciliation can yield
        // to typing, animation frames, and a newer filter request.
        setRequestedFilter(filter)
        startFilterTransition(() => handleChatSidebarFilterChange(filter))
      }}
      options={chatSidebarFilters
        .filter(({ value }) => chatSidebarTabs[value])
        .map(({ value, label, description }) => {
          const Icon = filterIcons[value]
          return {
            value,
            label: null,
            ariaLabel: label,
            title: description,
            icon:
              value === 'working' ? (
                <WorkingChatsIcon active={hasWorkingChats} />
              ) : (
                <Icon aria-hidden="true" />
              )
          }
        })}
    />
  )
  return (
    <header className={`chat-home__header${searchOpen ? ' chat-home__header--searching' : ''}`}>
      {renderWindowControls('darwin')}
      {mobile && !searchOpen ? (
        <div className="mobile-sidebar-heading">
          <div className="mobile-sidebar-heading__filters">
            {filterTabs}
            <Button
              theme={chromeControlTheme}
              aria-label="Close sidebar"
              icon={<X />}
              callback={mobile.onClose}
            />
          </div>
        </div>
      ) : searchOpen ? (
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
              aria-busy={searchLoading}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') handleCloseSearch()
              }}
            />
            {searchLoading && (
              <span
                className="chat-home__search-spinner"
                role="status"
                aria-label="Searching conversations"
              >
                <Spinner aria-hidden="true" />
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
            <Button
              theme={chromeControlTheme}
              aria-label="Import chat"
              title="Import chat"
              disabled={openingImport || importDisabled}
              callback={onOpenImport}
              icon={
                openingImport ? <Spinner aria-hidden="true" /> : <Download aria-hidden="true" />
              }
            />
          </div>
          {filterTabs}
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
              aria-label="New chat without a project"
              title="New chat without a project"
              callback={handleNewChatNoProject}
              icon={<MessageSquare aria-hidden="true" />}
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
  )
})
