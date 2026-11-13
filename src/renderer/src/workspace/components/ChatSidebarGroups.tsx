import { InitialSidebarRow, type InitialSidebarMount } from '../../components/InitialSidebarRow'
import {
  createContext,
  useContext,
  forwardRef,
  memo,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactElement
} from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { WorkspaceController } from '../../useWorkspaceController'
import {
  ChatListGroup,
  type ChatListGroupData,
  type ChatListGroupProps
} from '../../components/ChatListGroup'
import { ChatList } from '../../components/ChatList'
import { ChatListGroupPagination } from '../../components/ChatListGroupPagination'
import { ChatListDragContext } from '../../components/ChatListDragContext'
import { useStableProps } from '../stableProps'
import { appMaxChatsRenderedDefault } from '../../performanceSettings'

type Props = Pick<
  WorkspaceController['chatSidebar'],
  'sidebarGroups' | 'renderChatGroup' | 'handleProjectDrop' | 'handleProjectStackDragOver'
> & { scrollParent: HTMLDivElement | null; filterKey: string }

type Entry = {
  mountPolicy: InitialSidebarMount
  key: string
  kind: 'header' | 'row' | 'footer' | 'empty'
  group: ChatListGroupData
  props: ChatListGroupProps
  chats: ChatListGroupData['chats']
  index: number
}
type Entries = ReadonlyMap<string, Entry>
// Read current metadata from context. A retiring ID can outlive that map, so
// each structural data item also keeps its matching fallback snapshot.
type SidebarItem = { id: string; snapshot: Entries }
// Virtuoso republishes its external-store props in a layout effect on every
// render. Memoize that boundary as well as keeping unchanged data stable.
const VirtualSidebar = memo(Virtuoso<SidebarItem>)
const CurrentEntries = createContext<Entries | null>(null)
const prefixes = new WeakMap<Entry['chats'], { count: number; chats: Entry['chats'] }>()
function visiblePrefix(chats: Entry['chats'], count = chats.length): Entry['chats'] {
  if (count >= chats.length) return chats
  const cached = prefixes.get(chats)
  if (cached?.count === count) return cached.chats
  const prefix = chats.slice(0, count)
  prefixes.set(chats, { count, chats: prefix })
  return prefix
}
const Item = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { context?: Entries }>(
  function Item({ context: _context, ...props }, ref) {
    return <div {...props} ref={ref} />
  }
)
const components = { Item }
const entryKey = (_index: number, item: SidebarItem): string => item.id
const VirtualRow = memo(function VirtualRow({ item }: { item: SidebarItem }) {
  const current = useContext(CurrentEntries)
  const entry = current?.get(item.id) ?? item.snapshot.get(item.id)!
  const p = entry.props
  const chat = entry.chats[entry.index]
  const selected = `${chat.providerId}:${chat.id}` === p.selectedChatKey
  const chats = useMemo(() => [chat], [chat])
  const getReorderChats = useCallback(() => entry.chats, [entry.chats])
  const row = useStableProps({
    chats,
    getReorderChats,
    reorderOffset: entry.index,
    selectedChatKey: selected ? p.selectedChatKey : null,
    workingSubagentChatKeys: p.workingSubagentChatKeys,
    committingChatKeys: p.committingChatKeys,
    latestCommitFinishedAtByChatKey: p.latestCommitFinishedAtByChatKey,
    canMarkDone: p.group.kind !== 'done',
    canMarkUndone: p.group.kind === 'done' || p.group.kind === 'imported',
    reorderable: p.canReorderChats,
    projectNamesByCwd: p.projectNamesByCwd,
    projectIconsByCwd: p.projectIconsByCwd,
    onMarkDone: p.onMarkChatDone,
    onRename: p.onRenameChat,
    onResolveApproval: p.onResolveApproval,
    onReorder: (chats: ChatListGroupData['chats']) =>
      p.onReorderChats(p.group, [...chats, ...p.group.chats.slice(entry.chats.length)]),
    onSelect: p.onSelectChat,
    onTogglePinned: p.onToggleChatPinned,
    resolvingApprovalId: p.resolvingApprovalId,
    selectedChatChildren: selected ? p.selectedChatChildren : null,
    selectedChatChildOpen: selected && p.selectedChatChildOpen
  })
  return <ChatList {...row} />
})
const SidebarEntry = memo(function SidebarEntry({
  index,
  item
}: {
  index: number
  item: SidebarItem
}): ReactElement {
  const current = useContext(CurrentEntries)
  const entry = current?.get(item.id) ?? item.snapshot.get(item.id)!
  const { props: p, kind } = entry
  return (
    <div
      className={`chat-list-group--${p.group.kind}`}
      data-sidebar-group-key={p.group.key}
      data-sidebar-entry-index={index}
      style={kind === 'header' ? { paddingBottom: '0.5rem' } : undefined}
    >
      {kind === 'header' ? (
        <ChatListGroup {...p} />
      ) : (
        <div
          className="chat-list-group__items"
          style={{ paddingBottom: kind === 'footer' ? '0.7rem' : '0.5rem' }}
        >
          {kind === 'row' ? (
            <InitialSidebarRow policy={entry.mountPolicy} priority={-index}>
              <VirtualRow item={item} />
            </InitialSidebarRow>
          ) : kind === 'footer' ? (
            <ChatListGroupPagination {...p} />
          ) : (
            p.emptyContent
          )}
        </div>
      )}
    </div>
  )
})

const renderSidebarEntry = (index: number, item: SidebarItem): ReactElement => (
  <SidebarEntry index={index} item={item} />
)

/** One viewport window for headers and rows; filtering never mounts the whole catalog. */
export const ChatSidebarGroups = memo(function ChatSidebarGroups({
  sidebarGroups,
  renderChatGroup,
  handleProjectDrop,
  handleProjectStackDragOver,
  scrollParent,
  filterKey
}: Props): ReactElement {
  const list = useRef<VirtuosoHandle>(null)
  const mountPolicy = useMemo<InitialSidebarMount>(
    () => ({ deferred: true, pending: 0, completed: false }),
    [filterKey]
  )
  const hasMountedList = useRef(false)
  const previousFilter = useRef(filterKey)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const drag = useMemo(
    () => ({ key: dragKey, setKey: setDragKey, index: dragIndex, setIndex: setDragIndex }),
    [dragKey, dragIndex]
  )
  const groups = useMemo(() => [...sidebarGroups.values()], [sidebarGroups])
  const entries = useMemo(() => {
    const result: Entry[] = []
    for (const group of groups) {
      const element = renderChatGroup(group) as ReactElement<ChatListGroupProps>
      const p = element.props
      const chats = visiblePrefix(group.chats, p.visibleChatCount)
      const base = { group, props: p, chats, index: 0, mountPolicy }
      result.push({ ...base, key: 'header:' + group.key, kind: 'header' })
      if (!p.open) continue
      for (let index = 0; index < chats.length; index++)
        result.push({
          ...base,
          index,
          key: `chat:${chats[index].providerId}:${chats[index].id}`,
          kind: 'row'
        })
      if (!chats.length && p.emptyContent)
        result.push({ ...base, key: 'empty:' + group.key, kind: 'empty' })
      if (
        (chats.length < group.chats.length && p.onLoadMoreChats) ||
        ((p.visibleChatCount ?? 0) > (p.chatPageSize ?? appMaxChatsRenderedDefault) &&
          p.onShowLessChats)
      )
        result.push({ ...base, key: 'footer:' + group.key, kind: 'footer' })
    }
    return result
  }, [groups, renderChatGroup, mountPolicy])
  // Keep large group/row objects out of the virtualizer's array props. In dev,
  // React's changed-props diagnostics otherwise recursively walk every group's
  // chats for every entry, even though only a handful of rows are mounted.
  const entryLookup = useMemo(() => new Map(entries.map((entry) => [entry.key, entry])), [entries])
  const committedData = useRef<SidebarItem[]>([])
  const data = useMemo(() => {
    const previous = committedData.current
    // Selection/status changes update row context, not the virtualizer's external
    // store. Publishing an equivalent ID window forces synchronous root work.
    if (
      previous.length === entries.length &&
      entries.every((entry, index) => entry.key === previous[index].id)
    )
      return previous
    return entries.map((entry) => ({ id: entry.key, snapshot: entryLookup }))
  }, [entries, entryLookup])
  useLayoutEffect(() => {
    committedData.current = data
  }, [data])
  useLayoutEffect(() => {
    if (data.length) hasMountedList.current = true
  }, [data.length])
  const moveTabFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab' || !(event.target instanceof HTMLElement)) return
    const item = event.target.closest<HTMLElement>('[data-sidebar-entry-index]')
    if (!item) return
    const selector = 'button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'
    const controls = [...item.querySelectorAll<HTMLElement>(selector)].filter(
      (node) => !node.closest('[inert], [aria-hidden="true"]') && node.getClientRects().length > 0
    )
    if (event.target !== (event.shiftKey ? controls[0] : controls.at(-1))) return
    const direction = event.shiftKey ? -1 : 1
    let next = Number(item.dataset.sidebarEntryIndex) + direction
    while (entries[next]?.kind === 'empty') next += direction
    if (!entries[next]) return
    event.preventDefault()
    list.current?.scrollIntoView({
      index: next,
      done: () => {
        requestAnimationFrame(() => {
          const target = scrollParent?.querySelector(`[data-sidebar-entry-index="${next}"]`)
          const buttons = target
            ? [...target.querySelectorAll<HTMLElement>(selector)].filter(
                (node) =>
                  !node.closest('[inert], [aria-hidden="true"]') && node.getClientRects().length > 0
              )
            : []
          ;(direction < 0 ? buttons.at(-1) : buttons[0])?.focus({ preventScroll: true })
        })
      }
    })
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing tabs starts at the top of the new result set
  useLayoutEffect(() => {
    if (previousFilter.current === filterKey) return
    previousFilter.current = filterKey
    if (scrollParent) scrollParent.scrollTop = 0
  }, [scrollParent, filterKey])
  return (
    <div
      className="chat-list-stack"
      onDragOver={handleProjectStackDragOver}
      onDrop={handleProjectDrop}
      onKeyDown={moveTabFocus}
    >
      <ChatListDragContext.Provider value={drag}>
        <CurrentEntries.Provider value={entryLookup}>
          {scrollParent && (data.length > 0 || hasMountedList.current) && (
            <VirtualSidebar
              ref={list}
              data={data}
              computeItemKey={entryKey}
              customScrollParent={scrollParent}
              components={components}
              defaultItemHeight={58}
              increaseViewportBy={120}
              itemContent={renderSidebarEntry}
            />
          )}
        </CurrentEntries.Provider>
      </ChatListDragContext.Provider>
    </div>
  )
})
