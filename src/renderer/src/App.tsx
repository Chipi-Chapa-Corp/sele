import { readStoredBrowserWorkspaces } from './browserTabs'
import { browserApi } from './browserApi'
import { localNetwork } from './nativeLocalNetwork'
import { dismissMobileOverlay } from './mobileBack'
import './App.css'
import { DevicePairingPrompt } from './components/DevicePairingPrompt'
import { ProviderLabelsContext } from './providerLabels'
import { memo, useCallback, useLayoutEffect, useEffect, useMemo, useRef, useState } from 'react'
import { useCompactLayout } from './useCompactLayout'
import { useMobileKeyboard } from './useMobileKeyboard'
import { isAndroidClient, isRemoteClient } from './runtimeCapabilities'
import {
  MobileWorkspaceNavigation,
  type MobileWorkspacePane
} from './workspace/components/MobileWorkspaceChrome'
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
import { useWorkspaceSwipe } from './useWorkspaceSwipe'

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
  const compact = useCompactLayout()
  const keyboardOpen = useMobileKeyboard(compact)
  const keyboardVisible = useRef(keyboardOpen)
  keyboardVisible.current = keyboardOpen
  const [mobilePage, setMobilePage] = useState<'conversation' | 'workspace'>('conversation')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const mobilePane: MobileWorkspacePane = sidebarOpen ? 'chats' : mobilePage
  const openConversation = useCallback(() => {
    setMobilePage('conversation')
    setSidebarOpen(false)
  }, [])
  const workspace = useWorkspaceController({
    onConversationRequested: compact ? openConversation : undefined
  })
  useLayoutEffect(() => {
    if (isRemoteClient()) return
    for (const [key, session] of Object.entries(
      readStoredBrowserWorkspaces(workspace.changesContent.browserWorkspaceKey)
    ))
      browserApi.publishTabs?.({ workspaceKey: key, active: false, ...session })
  }, [])
  const selectedId = workspace.conversationPanel.selectedChat?.id
  const newChatOpen = workspace.conversationPanel.newChatOpen
  const sidebarAtRoot = useRef(false)
  const backAction = useRef<() => void>(() => {})
  const backFromWorkspace = (): void => {
    const header = workspace.changesHeader
    if (
      header.changesPaneView === 'git' &&
      header.gitPaneView === 'pull-requests' &&
      header.gitHubPullRequests.detail.selected
    ) {
      header.gitHubPullRequests.detail.close()
      return
    }
    openConversation()
  }

  backAction.current = () => {
    if (dismissMobileOverlay()) return
    if (workspace.dialogs.settingsOpen) {
      workspace.dialogs.setSettingsOpen(false)
      return
    }
    const rename = document.querySelector<HTMLElement>(
      '.chat[data-mobile-pane="chats"] .chat-list-item form input'
    )
    const touchActions = document.querySelector<HTMLElement>(
      '.chat[data-mobile-pane="chats"] [data-touch-actions="open"]'
    )
    if (rename || touchActions) {
      ;(rename ?? touchActions)?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      )
      return
    }
    if (sidebarOpen && workspace.chatSidebar.searchOpen) {
      workspace.chatSidebar.setSearchOpen(false)
      workspace.chatSidebar.setSearchQuery('')
      return
    }
    if (sidebarOpen && !sidebarAtRoot.current) {
      setSidebarOpen(false)
      return
    }
    if (mobilePage === 'workspace' && !sidebarOpen) {
      backFromWorkspace()
      return
    }
    if (workspace.conversationSearch.visible && !sidebarOpen) {
      workspace.conversationSearch.closeChatSearch()
      return
    }
    if (!sidebarOpen) {
      if (workspace.conversationPanel.activeSubagentChatView) {
        workspace.conversationHeader.handleBack()
        return
      }
      sidebarAtRoot.current = true
      setSidebarOpen(true)
      return
    }
    void import('@capacitor/app')
      .then(({ App }) => App.minimizeApp())
      .catch((error) => console.warn('Unable to minimize Android Sele.', error))
  }
  useEffect(() => {
    if (!isAndroidClient()) return
    let cleanup: (() => void) | undefined
    let active = true
    void import('@capacitor/app')
      .then(async ({ App }) => {
        const listener = await App.addListener('backButton', () => {
          if (dismissMobileOverlay()) {
            void localNetwork.consumeKeyboardBack()
            return
          }
          const typing = keyboardVisible.current
          void localNetwork
            .consumeKeyboardBack()
            .then(({ consumed }) => {
              if (!consumed && !typing) backAction.current()
            })
            .catch((error) => console.warn('Unable to handle Android Back.', error))
        })
        if (!active) await listener.remove()
        else
          cleanup = () => {
            void listener
              .remove()
              .catch((error) => console.warn('Unable to remove Android back listener.', error))
          }
      })
      .catch((error) => console.warn('Unable to initialize Android navigation.', error))
    return () => {
      active = false
      cleanup?.()
    }
  }, [])
  useEffect(() => {
    if (selectedId) openConversation()
  }, [selectedId, openConversation])
  useEffect(() => {
    if (!compact || !sidebarOpen) return
    const sidebar = document.getElementById('sidebar')
    const previous = document.activeElement
    sidebar?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
    const keyboard = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if (
        document.querySelector(
          'dialog[open], [role="dialog"]:not([data-mobile-sidebar]), [role="menu"], [role="listbox"]'
        )
      )
        return
      if (event.key === 'Escape') {
        if (
          sidebar?.querySelector(
            '.chat-list-item form input, [data-touch-actions="open"], .chat-home__search-field'
          )
        )
          return
        event.preventDefault()
        setSidebarOpen(false)
      } else if (event.key === 'Tab') {
        const controls = [
          ...(sidebar?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input, select, textarea, a[href], [tabindex="0"]'
          ) ?? [])
        ].filter((element) => element.getClientRects().length && !element.closest('[inert]'))
        const first = controls[0]
        const last = controls.at(-1)
        if (
          event.shiftKey &&
          (document.activeElement === first || !sidebar?.contains(document.activeElement))
        ) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('keydown', keyboard)
      // Selecting a chat may focus its composer. Preserve that explicit focus.
      if (document.activeElement === document.body || sidebar?.contains(document.activeElement))
        if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected)
          previous.focus({ preventScroll: true })
        else
          document
            .querySelector<HTMLElement>('.mobile-conversation-header button')
            ?.focus({ preventScroll: true })
    }
  }, [compact, sidebarOpen])
  const openMobilePane = (pane: MobileWorkspacePane): void => {
    if (pane === 'chats') {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      sidebarAtRoot.current = false
      setSidebarOpen(true)
      return
    }
    if (pane === 'conversation' && !selectedId && !newChatOpen)
      workspace.chatSidebar.handleNewChat()
    setMobilePage(pane)
    setSidebarOpen(false)
  }
  const mobileChrome = {
    pane: mobilePage,
    sidebarOpen,
    title: workspace.conversationPanel.selectedChat?.title ?? 'New chat',
    onPane: openMobilePane,
    onNewChat: workspace.chatSidebar.handleNewChat,
    onBack: () => {
      if (!dismissMobileOverlay()) backFromWorkspace()
    }
  }
  useWorkspaceSwipe(
    workspace.layout.panelsRef,
    compact,
    (direction) => {
      if (sidebarOpen) setSidebarOpen(false)
      else if (direction === 'previous') openMobilePane('chats')
    },
    (direction) => (sidebarOpen ? direction === 'next' : direction === 'previous')
  )
  const chatSidebar = useStableProps(workspace.chatSidebar, sidebarOptions)
  const setSettingsOpen = workspace.dialogs.setSettingsOpen
  const mobileSidebar = useMemo(
    () =>
      compact
        ? {
            onClose: () => setSidebarOpen(false),
            onSettings: () => setSettingsOpen(true)
          }
        : undefined,
    [compact, setSettingsOpen]
  )
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
    <ProviderLabelsContext.Provider value={workspace.providerRuntimeLabels}>
      <LinkedChatOpenerContext.Provider value={workspace.openLinkedChat}>
        <main
          className={workspace.className}
          data-mobile-pane={compact ? mobilePane : undefined}
          data-mobile-view={compact ? mobilePage : undefined}
          data-mobile-keyboard={compact && keyboardOpen ? 'open' : undefined}
        >
          <AppDialogs {...workspace.dialogs} />
          <DevicePairingPrompt />
          {compact && <MobileWorkspaceNavigation {...mobileChrome} />}
          <WorkspaceShell
            {...workspace.layout}
            mobileSidebarOpen={compact ? sidebarOpen : undefined}
            mobileBackdrop={
              compact ? (
                <button
                  className="mobile-sidebar-backdrop"
                  data-open={sidebarOpen}
                  aria-hidden={!sidebarOpen}
                  disabled={!sidebarOpen}
                  type="button"
                  tabIndex={-1}
                  aria-label="Close sidebar"
                  onClick={() => setSidebarOpen(false)}
                />
              ) : null
            }
            chatSidebar={<MemoChatSidebar {...chatSidebar} mobile={mobileSidebar} />}
            conversation={
              <ConversationPanel
                {...workspace.conversationPanel}
                inert={compact && sidebarOpen}
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
                inert={compact && sidebarOpen}
                header={<MemoChangesHeader {...changesHeader} />}
                content={<MemoChangesContent {...changesContent} />}
                footer={<MemoChangesFooter {...changesFooter} />}
              />
            }
          />
        </main>
      </LinkedChatOpenerContext.Provider>
    </ProviderLabelsContext.Provider>
  )
}
