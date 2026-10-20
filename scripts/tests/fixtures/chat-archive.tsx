import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatSidebar } from '../../../src/renderer/src/workspace/components/ChatSidebar'
import { ChatListGroup } from '../../../src/renderer/src/components/ChatListGroup'
import { ChatDetailItem } from '../../../src/renderer/src/components/ChatDetailItem'
import {
  groupChatsForSidebar,
  getChatFromUpdateSummary
} from '../../../src/renderer/src/workspace/chatControllerUtils'
import '../../../src/renderer/src/assets/main.css'
import '../../../src/renderer/src/App.css'

// biome-ignore lint/suspicious/noExplicitAny: isolated test bridge
const fixture = window as unknown as Record<string, any>
fixture.calls = []
fixture.largeImportReady = false
let sequence = 0
const initial = {
  id: 'original',
  providerId: 'codex',
  title: 'Portable conversation',
  preview: 'Final answer',
  cwd: '/fixture',
  cwdKind: 'directory',
  projectCwd: '/fixture',
  branchName: null,
  worktreeBaseBranchName: null,
  createdAt: 1000,
  updatedAt: 2000,
  status: null,
  pendingApproval: null,
  pinned: false,
  sidebarOrder: null,
  done: false,
  seenUpdatedAt: null,
  purpose: null,
  container: null
}
const transcript = [
  { type: 'message', id: 'prompt', role: 'user', content: 'Please inspect these files.' },
  {
    type: 'working',
    id: 'work',
    status: 'worked',
    items: [
      {
        type: 'tool',
        id: 'tool',
        toolId: 'call',
        status: 'finished',
        activity: 'command',
        icon: null,
        label: 'Read files',
        command: 'cat README.md',
        stdout: 'Full archived tool output',
        cwd: '/fixture',
        diffs: [],
        images: [],
        rawInput: { command: 'cat README.md' },
        rawOutput: { output: 'Full archived tool output' },
        backgroundSessionId: null,
        finishedBackgroundSessionId: null
      }
    ]
  },
  { type: 'message', id: 'response', role: 'assistant', content: 'The files have been inspected.' }
]
fixture.preferencesApi = {
  get: () => null,
  getSnapshot: () => ({}),
  set: () => {},
  remove: () => {}
}
fixture.appApi = {
  getContainerSuggestions: async () => [{ id: 'podman:dev', tool: 'podman', name: 'dev' }],
  getSshEnvironments: async () => [{ id: 'ssh-fixture', name: 'Build server' }],
  getSourceAvailability: async ({ container }) => ({
    providers: ['codex', 'claude', 'copilot', 'opencode'].map((providerId) => ({
      providerId,
      available: container.kind === 'host' || (container.tool !== 'ssh' && providerId === 'claude')
    }))
  }),
  onAppUpdateChanged: () => () => {},
  getAppUpdate: async () => null
}
fixture.providerApi = {
  exportChat: async (providerId, id) => {
    fixture.calls.push({ export: id, providerId })
    return '/fixture/Portable conversation.sele'
  },
  openChatImport: async () => {
    const id = `operation-${++sequence}`
    fixture.calls.push({ open: id })
    return { id, title: initial.title, turnCount: 1, providerId: 'codex' }
  },
  cancelChatImport: async (id) => {
    fixture.calls.push({ cancel: id })
  },
  importChat: (id, providerId, container) => {
    fixture.calls.push({ import: id, providerId, container })
    return new Promise((resolve, reject) => {
      fixture.completeImport = () =>
        resolve({
          ...initial,
          id: `imported-${sequence}`,
          imported: { providerId: 'codex', chatId: 'original' },
          revision: 1,
          cwd: '/fixture/imports',
          projectCwd: '/fixture/imports',
          container
        })
      fixture.failImport = () => reject(new Error('Fixture native import failure'))
    })
  }
}
function Fixture() {
  const [largeDetail, setLargeDetail] = useState(null)
  fixture.openLargeImport = async () => {
    const detail = await fixture.archiveFixtureApi.read()
    fixture.largeImportDetail = detail
    setLargeDetail(detail)
    fixture.largeImportReady = true
  }
  fixture.responsiveClicks ??= 0
  const [chats, setChats] = useState([initial])
  const [selected, setSelected] = useState(initial)
  const groups = groupChatsForSidebar(chats, new Map())
  const props = {
    chats,
    loadState: 'ready',
    chromeControlTheme: 'transparent',
    displayedActiveChatGroups: groups.filter((group) => group.kind === 'cwd'),
    pinnedChatGroup: groups.find((group) => group.kind === 'pinned'),
    importedChatGroup: groups.find((group) => group.kind === 'imported'),
    doneChatGroup: null,
    handleNewChat: () => {
      fixture.calls.push({ newChat: true })
    },
    handleImportedChat: (providerId, summary) => {
      const chat = getChatFromUpdateSummary(providerId, summary, null, false)
      setChats((current) => [...current, chat])
      setSelected(chat)
    },
    renderChatGroup: (group, contentId) => (
      <ChatListGroup
        group={group}
        contentId={contentId}
        open
        selectedChatKey={`${selected.providerId}:${selected.id}`}
        onToggle={() => {}}
        onSelectChat={setSelected}
        onToggleChatPinned={(chat) =>
          setChats((current) =>
            current.map((item) => (item.id === chat.id ? { ...item, pinned: !item.pinned } : item))
          )
        }
        onMarkChatDone={() => {}}
        onRenameChat={async () => {}}
        onResolveApproval={() => {}}
        onReorderChats={() => {}}
        onUnpinPinnedChats={() => {}}
        onMarkCwdChatsDone={() => {}}
        onNewChatInCwd={() => {}}
      />
    ),
    renderChatGroupingButton: () => null,
    renderSettingsButton: () => null,
    renderWindowControls: () => null,
    searchOpen: false,
    searchQuery: '',
    setSearchOpen: () => {},
    setSearchQuery: () => {},
    handleCloseSearch: () => {},
    sidebarSearch: { loading: false, hasMore: false, error: null },
    handleProjectStackDragOver: () => {},
    handleProjectDrop: () => {}
  }
  fixture.selected = selected
  fixture.groups = groups
  if (largeDetail)
    return (
      <main aria-label="Large import">
        <h1>Large imported chat</h1>
        {largeDetail.items.map((item) => (
          <ChatDetailItem
            key={item.id}
            item={item}
            onLoadWorkingStep={async (id) => {
              const page = await fixture.archiveFixtureApi.working(id)
              setLargeDetail((current) => {
                const next = {
                  ...current,
                  items: current.items.map((item) =>
                    item.id === id
                      ? {
                          ...item,
                          items: page.items,
                          itemsLoaded: true,
                          itemCount: page.totalCount
                        }
                      : item
                  )
                }
                fixture.largeImportDetail = next
                return next
              })
            }}
          />
        ))}
      </main>
    )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', height: '100vh' }}>
      {/* biome-ignore lint/suspicious/noExplicitAny: fixture exercises real components with focused props */}
      <ChatSidebar {...(props as any)} />
      <main style={{ padding: '2rem' }} aria-label="Opened chat">
        <button
          type="button"
          aria-label="Responsive control"
          onClick={() => fixture.responsiveClicks++}
        >
          Responsive control
        </button>
        <h1>{selected.title}</h1>
        <p>Provider: {selected.providerId}</p>
        {transcript.map((item) => (
          <ChatDetailItem
            key={item.id}
            item={item as never}
            progressSettings={{ expandProgressOnStart: true, collapseProgressOnFinish: false }}
          />
        ))}
      </main>
    </div>
  )
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>
)
fixture.ready = true
