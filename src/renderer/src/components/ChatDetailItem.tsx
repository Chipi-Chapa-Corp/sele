import {
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type {
  AnchorHTMLAttributes,
  ForwardRefExoticComponent,
  HTMLAttributes,
  ReactNode,
  RefAttributes,
  TableHTMLAttributes
} from 'react'
import {
  ActivityIcon as AnimatedActivityIcon,
  BoxIcon as AnimatedBoxIcon,
  BrainIcon as AnimatedBrainIcon,
  DeleteIcon as AnimatedDeleteIcon,
  FilePenLineIcon as AnimatedFilePenLineIcon,
  FileStackIcon as AnimatedFileStackIcon,
  FileTextIcon as AnimatedFileTextIcon,
  GitBranchIcon as AnimatedGitBranchIcon,
  HourglassIcon as AnimatedHourglassIcon,
  LoaderPinwheelIcon as AnimatedLoaderPinwheelIcon,
  PenToolIcon as AnimatedPenToolIcon,
  SearchIcon as AnimatedSearchIcon,
  TerminalIcon as AnimatedTerminalIcon,
  WrenchIcon as AnimatedWrenchIcon
} from 'lucide-animated'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import {
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  FilePlus2,
  FileCode2,
  FileText,
  GitBranch,
  LoaderCircle,
  Package,
  Pencil,
  Search,
  Square,
  Terminal,
  Trash2,
  Wrench
} from 'lucide-react'
import Markdown from 'markdown-to-jsx'
import type {
  ProviderChatItem,
  ProviderMessage,
  ProviderModelId,
  ProviderPendingMessage,
  ProviderToolActivity,
  ProviderWorkingItem,
  ProviderWorkingStep,
  ProviderWorkingTool
} from '../../../shared/provider'
import { Button } from './Button'
import { HighlightedCode } from './HighlightedCode'
import { ToolDiff } from './ToolDiff'
import './ChatDetailItem.css'

type ChatDetailItemProps = {
  canEditOwnMessages?: boolean
  item: ProviderChatItem
  modelLabelsById?: ReadonlyMap<ProviderModelId, string>
  onDeletePendingMessage?: (message: ProviderPendingMessage) => void
  onEditPendingMessage?: (message: ProviderPendingMessage) => void
  onInterruptPendingMessage?: (message: ProviderPendingMessage) => void
  onEditMessage?: (message: ProviderMessage) => void
  onOpenFileLink?: (path: string, displayPath: string, line?: number) => void
  projectCwd?: string | null
  selectedModelId?: ProviderModelId
  streaming?: boolean
}

const areUnknownValuesEqual = (
  first: unknown,
  second: unknown,
  seen = new Map<object, object>()
): boolean => {
  if (Object.is(first, second)) return true
  if (first == null || second == null || typeof first !== 'object' || typeof second !== 'object') {
    return false
  }

  const seenSecond = seen.get(first)
  if (seenSecond) return seenSecond === second
  seen.set(first, second)

  if (Array.isArray(first) || Array.isArray(second)) {
    if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) {
      return false
    }

    return first.every((value, index) => areUnknownValuesEqual(value, second[index], seen))
  }

  const firstRecord = first as Record<string, unknown>
  const secondRecord = second as Record<string, unknown>
  const firstKeys = Object.keys(firstRecord)
  const secondKeys = Object.keys(secondRecord)
  if (firstKeys.length !== secondKeys.length) return false

  return firstKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(secondRecord, key) &&
      areUnknownValuesEqual(firstRecord[key], secondRecord[key], seen)
  )
}

const areFileDiffsEqual = (
  first: ProviderWorkingTool['diffs'],
  second: ProviderWorkingTool['diffs']
): boolean =>
  first.length === second.length &&
  first.every((diff, index) => {
    const nextDiff = second[index]
    return diff.path === nextDiff.path && diff.kind === nextDiff.kind && diff.diff === nextDiff.diff
  })

const areWorkingToolsEqual = (first: ProviderWorkingTool, second: ProviderWorkingTool): boolean =>
  first.id === second.id &&
  first.toolId === second.toolId &&
  first.status === second.status &&
  first.activity === second.activity &&
  first.label === second.label &&
  first.command === second.command &&
  first.stdout === second.stdout &&
  first.backgroundSessionId === second.backgroundSessionId &&
  first.finishedBackgroundSessionId === second.finishedBackgroundSessionId &&
  areFileDiffsEqual(first.diffs, second.diffs) &&
  areUnknownValuesEqual(first.rawInput, second.rawInput) &&
  areUnknownValuesEqual(first.rawOutput, second.rawOutput)

const areWorkingItemsEqual = (first: ProviderWorkingItem, second: ProviderWorkingItem): boolean => {
  if (first === second) return true
  if (first.type !== second.type || first.id !== second.id) return false
  if (first.type === 'message') {
    return second.type === 'message' && first.content === second.content
  }
  if (first.type === 'toolGroup') {
    return (
      second.type === 'toolGroup' &&
      first.label === second.label &&
      first.tools.length === second.tools.length &&
      first.tools.every((tool, index) => areWorkingToolsEqual(tool, second.tools[index]))
    )
  }

  return second.type === 'tool' && areWorkingToolsEqual(first, second)
}

const areChatItemsEqual = (first: ProviderChatItem, second: ProviderChatItem): boolean => {
  if (first === second) return true
  if (first.type !== second.type || first.id !== second.id) return false

  if (first.type === 'contextCompaction') return second.type === 'contextCompaction'
  if (first.type === 'message') {
    return (
      second.type === 'message' &&
      first.role === second.role &&
      first.content === second.content &&
      first.createdAt === second.createdAt &&
      first.label === second.label &&
      first.model === second.model
    )
  }
  if (first.type === 'pendingMessage') {
    return (
      second.type === 'pendingMessage' &&
      first.kind === second.kind &&
      first.content === second.content &&
      first.createdAt === second.createdAt
    )
  }

  if (second.type === 'working' && first.status === second.status && first.status === 'worked') {
    return true
  }

  return (
    second.type === 'working' &&
    first.status === second.status &&
    first.items.length === second.items.length &&
    first.items.every((item, index) => areWorkingItemsEqual(item, second.items[index]))
  )
}

const areChatDetailItemPropsEqual = (
  first: ChatDetailItemProps,
  second: ChatDetailItemProps
): boolean =>
  first.canEditOwnMessages === second.canEditOwnMessages &&
  first.modelLabelsById === second.modelLabelsById &&
  first.onDeletePendingMessage === second.onDeletePendingMessage &&
  first.onEditPendingMessage === second.onEditPendingMessage &&
  first.onInterruptPendingMessage === second.onInterruptPendingMessage &&
  first.onEditMessage === second.onEditMessage &&
  first.onOpenFileLink === second.onOpenFileLink &&
  first.projectCwd === second.projectCwd &&
  first.selectedModelId === second.selectedModelId &&
  first.streaming === second.streaming &&
  areChatItemsEqual(first.item, second.item)

type ProviderToolItem = Exclude<ProviderWorkingItem, { type: 'message' }>
type ProviderWorkingMessageItem = Extract<ProviderWorkingItem, { type: 'message' }>
type WorkingBlock =
  | { type: 'message'; item: ProviderWorkingMessageItem }
  | { type: 'tools'; items: ProviderToolItem[] }

type AnimatedIconHandle = {
  startAnimation: () => void
  stopAnimation: () => void
}

type AnimatedIconComponent = ForwardRefExoticComponent<
  HTMLAttributes<HTMLDivElement> & {
    size?: number
    animateOnHover?: boolean
  } & RefAttributes<AnimatedIconHandle>
>

const activityLabels: Record<ProviderToolActivity, string> = {
  read: 'read files',
  search: 'searched',
  git: 'used Git',
  edit: 'changed files',
  create: 'created files',
  delete: 'deleted files',
  npm: 'ran npm scripts',
  npx: 'ran npx tools',
  script: 'ran scripts',
  command: 'ran commands',
  other: 'used tools'
}

const activeActivityLabels: Record<ProviderToolActivity, string> = {
  read: 'Reading files',
  search: 'Searching',
  git: 'Using Git',
  edit: 'Changing files',
  create: 'Creating files',
  delete: 'Deleting files',
  npm: 'Running npm scripts',
  npx: 'Running npx tools',
  script: 'Running scripts',
  command: 'Running commands',
  other: 'Using tools'
}

const animatedActivityIcons: Record<ProviderToolActivity, AnimatedIconComponent> = {
  read: AnimatedFileTextIcon,
  search: AnimatedSearchIcon,
  git: AnimatedGitBranchIcon,
  edit: AnimatedFilePenLineIcon,
  create: AnimatedFileStackIcon,
  delete: AnimatedDeleteIcon,
  npm: AnimatedBoxIcon,
  npx: AnimatedBoxIcon,
  script: AnimatedPenToolIcon,
  command: AnimatedTerminalIcon,
  other: AnimatedWrenchIcon
}

const placeholderOptions = [
  { label: 'Thinking', Icon: AnimatedBrainIcon },
  { label: 'Analyzing', Icon: AnimatedActivityIcon },
  { label: 'Processing', Icon: AnimatedLoaderPinwheelIcon },
  { label: 'Working', Icon: AnimatedHourglassIcon }
] satisfies Array<{ label: string; Icon: AnimatedIconComponent }>
const longRunningActivities = new Set<ProviderToolActivity>(['npm', 'npx', 'script', 'command'])
const silencePlaceholderDelayMs = 600

type MarkdownFileTarget = {
  path: string
  displayPath: string
  line?: number
}

type MarkdownLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  onOpenFileLink?: (path: string, displayPath: string, line?: number) => void
}

const externalLinkPattern = /^(?:https?|mailto|tel):/i
const windowsAbsolutePathPattern = /^[a-z]:[\\/]/i
const sourceLocationPattern = /^(.*?):(\d+)(?::\d+)?$/
const fragmentLocationPattern = /#L(\d+)(?:C\d+)?$/i

const decodeLinkTarget = (target: string): string => {
  try {
    return decodeURIComponent(target)
  } catch {
    return target
  }
}

const getMarkdownFileTarget = (href: string | undefined): MarkdownFileTarget | null => {
  const rawHref = href?.trim()
  if (!rawHref || rawHref.startsWith('#') || externalLinkPattern.test(rawHref)) return null

  const fragmentLocationMatch = rawHref.match(fragmentLocationPattern)
  const withoutFragment = fragmentLocationMatch
    ? rawHref.slice(0, fragmentLocationMatch.index)
    : rawHref
  const locationMatch = withoutFragment.match(sourceLocationPattern)
  let path = decodeLinkTarget(locationMatch?.[1] ?? withoutFragment)
  const lineValue = fragmentLocationMatch?.[1] ?? locationMatch?.[2]
  const parsedLine = lineValue ? Number.parseInt(lineValue, 10) : undefined
  const line =
    parsedLine && Number.isSafeInteger(parsedLine) && parsedLine > 0 ? parsedLine : undefined

  if (/^file:\/\//i.test(path)) {
    try {
      path = decodeLinkTarget(new URL(path).pathname)
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1)
    } catch {
      return null
    }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !windowsAbsolutePathPattern.test(path)) {
    return null
  }

  const displayPath = path.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!displayPath) return null

  return { path, displayPath, line }
}

const withoutSourceLocation = (children: ReactNode, line: number | undefined): ReactNode => {
  if (!line) return children

  const locationPattern = new RegExp(`(?::${line}(?::\\d+)?|#L${line}(?:C\\d+)?)$`, 'i')

  return Children.map(children, (child) => {
    if (typeof child === 'string') return child.replace(locationPattern, '')
    if (!isValidElement<{ children?: ReactNode }>(child) || child.props.children == null)
      return child

    return cloneElement(child, undefined, withoutSourceLocation(child.props.children, line))
  })
}

const MarkdownLink: React.FC<MarkdownLinkProps> = ({
  children,
  href,
  onOpenFileLink,
  ...props
}) => {
  const fileTarget = getMarkdownFileTarget(href)

  if (!fileTarget || !onOpenFileLink) {
    return (
      <a {...props} href={href} rel="noreferrer" target="_blank">
        {children}
      </a>
    )
  }

  const fileName = fileTarget.displayPath.split('/').at(-1) ?? fileTarget.displayPath
  const displayLine = fileTarget.line
  const title = displayLine
    ? `Open ${fileTarget.displayPath} at line ${displayLine}`
    : `Open ${fileTarget.displayPath}`

  return (
    <button
      className="chat-detail__file-link"
      type="button"
      title={title}
      onClick={() => onOpenFileLink(fileTarget.path, fileTarget.displayPath, fileTarget.line)}
    >
      <span className="chat-detail__file-link-icon" aria-hidden="true">
        <SymbolsFileIcon fileName={fileName} autoAssign />
      </span>
      <span className="chat-detail__file-link-label">
        {withoutSourceLocation(children, fileTarget.line)}
      </span>
      {displayLine && (
        <>
          <span className="chat-detail__file-link-separator" aria-hidden="true">
            ·
          </span>
          <span className="chat-detail__file-link-line" aria-label={`Line ${displayLine}`}>
            {displayLine}
          </span>
        </>
      )}
    </button>
  )
}

const MarkdownTable: React.FC<TableHTMLAttributes<HTMLTableElement>> = ({ children, ...props }) => (
  <div className="chat-detail__table-scroll">
    <table {...props} className="chat-detail__table">
      {children}
    </table>
  </div>
)

const getMarkdownOptions = (
  onOpenFileLink?: (path: string, displayPath: string, line?: number) => void
) =>
  ({
    disableParsingRawHTML: true,
    forceBlock: true,
    wrapper: Fragment,
    overrides: {
      a: {
        component: MarkdownLink,
        props: { onOpenFileLink }
      },
      table: MarkdownTable
    }
  }) as const

const getStableIndex = (id: string, length: number): number => {
  let hash = 0

  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0
  }

  return Math.abs(hash) % length
}

const getPlaceholderOption = (id: string): (typeof placeholderOptions)[number] =>
  placeholderOptions[getStableIndex(id, placeholderOptions.length)]

const activeLabelReplacements: Array<[RegExp, string]> = [
  [/^Read\b/, 'Reading'],
  [/^Searched\b/, 'Searching'],
  [/^Checked\b/, 'Checking'],
  [/^Viewed\b/, 'Viewing'],
  [/^Ran\b/, 'Running'],
  [/^Used\b/, 'Using'],
  [/^Changed\b/, 'Changing'],
  [/^Created\b/, 'Creating'],
  [/^Deleted\b/, 'Deleting'],
  [/^Applied\b/, 'Applying'],
  [/^Updated\b/, 'Updating'],
  [/^Generated\b/, 'Generating']
]

const finishedLabelPrefixes =
  /^(Read|Searched|Checked|Viewed|Ran|Used|Changed|Created|Deleted|Applied|Updated|Generated)\b/

const getActiveToolLabel = (label: string, activity: ProviderToolActivity): string => {
  for (const [pattern, replacement] of activeLabelReplacements) {
    if (pattern.test(label)) return label.replace(pattern, replacement)
  }

  return activeActivityLabels[activity]
}

const getFinishedToolLabel = (label: string, activity: ProviderToolActivity): string => {
  if (finishedLabelPrefixes.test(label)) return label
  if (label && label !== 'Tool use') return activity === 'other' ? `Used ${label}` : label

  const fallback = activityLabels[activity] || activityLabels.other
  return fallback.charAt(0).toLocaleUpperCase() + fallback.slice(1)
}

const getToolDisplayLabel = (
  label: string,
  activity: ProviderToolActivity,
  active: boolean
): string => (active ? getActiveToolLabel(label, activity) : getFinishedToolLabel(label, activity))

const DiffContent: React.FC<{
  tools: ProviderWorkingTool[]
  projectCwd?: string | null
}> = ({ tools, projectCwd }) => (
  <div className="chat-detail__activity-content">
    {tools.flatMap((tool) =>
      tool.diffs.map((diff, index) => (
        <ToolDiff
          fileDiff={diff}
          key={`${tool.id}:${diff.path}:${index}`}
          projectCwd={projectCwd}
        />
      ))
    )}
  </div>
)

const CommandContent: React.FC<{ tools: ProviderWorkingTool[] }> = ({ tools }) => (
  <div className="chat-detail__activity-content chat-detail__activity-content--command">
    {tools.map((tool) => (
      <section key={tool.id}>
        {tool.command && (
          <HighlightedCode language={getInputLanguage(tool.command)}>
            {tool.command}
          </HighlightedCode>
        )}
        {tool.command && tool.stdout && (
          <span className="chat-detail__command-divider" aria-hidden="true" />
        )}
        {tool.stdout && (
          <HighlightedCode language={getOutputLanguage(tool.stdout)}>{tool.stdout}</HighlightedCode>
        )}
      </section>
    ))}
  </div>
)

const formatToolValue = (value: unknown): string => {
  if (value == null) return 'null'
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

const isJson = (value: string): boolean => {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false

  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

const getOutputLanguage = (value: string): string | null => {
  if (isJson(value)) return 'json'

  const trimmed = value.trimStart()
  if (trimmed.startsWith('diff --git ') || trimmed.startsWith('@@ ')) return 'diff'
  if (/^<(?!!--)[A-Za-z][^>]*>/.test(trimmed)) return 'markup'

  return null
}

const getInputLanguage = (value: string): string => {
  if (isJson(value)) return 'json'
  if (/^(?:tools|functions)\.[A-Za-z0-9_]+\s*\(/.test(value.trimStart())) return 'javascript'
  return 'bash'
}

const getToolValueLanguage = (value: unknown, input = false): string | null => {
  if (typeof value !== 'string') return 'json'
  return input ? getInputLanguage(value) : getOutputLanguage(value)
}

const RawContent: React.FC<{ tools: ProviderWorkingTool[] }> = ({ tools }) => (
  <div className="chat-detail__activity-content chat-detail__activity-content--command">
    {tools.map((tool) => (
      <section key={tool.id}>
        {tool.rawInput != null && (
          <HighlightedCode language={getToolValueLanguage(tool.rawInput, true)}>
            {formatToolValue(tool.rawInput)}
          </HighlightedCode>
        )}
        {tool.rawInput != null && (
          <span className="chat-detail__command-divider" aria-hidden="true" />
        )}
        <HighlightedCode language={getToolValueLanguage(tool.rawOutput)}>
          {formatToolValue(tool.rawOutput)}
        </HighlightedCode>
      </section>
    ))}
  </div>
)

const ToolTypeIcon: React.FC<{ activity: ProviderToolActivity }> = ({ activity }) => {
  if (activity === 'read') return <FileText aria-hidden="true" />
  if (activity === 'search') return <Search aria-hidden="true" />
  if (activity === 'git') return <GitBranch aria-hidden="true" />
  if (activity === 'edit') return <Pencil aria-hidden="true" />
  if (activity === 'create') return <FilePlus2 aria-hidden="true" />
  if (activity === 'delete') return <Trash2 aria-hidden="true" />
  if (activity === 'npm' || activity === 'npx') return <Package aria-hidden="true" />
  if (activity === 'script') return <FileCode2 aria-hidden="true" />
  if (activity === 'command') return <Terminal aria-hidden="true" />

  return <Wrench aria-hidden="true" />
}

const LoopingAnimatedIcon: React.FC<{
  Icon: AnimatedIconComponent
  active: boolean
}> = ({ Icon, active }) => {
  const iconRef = useRef<AnimatedIconHandle | null>(null)

  useEffect(() => {
    const icon = iconRef.current

    if (!active) {
      icon?.stopAnimation()
      return undefined
    }

    icon?.startAnimation()

    return () => {
      icon?.stopAnimation()
    }
  }, [active])

  return (
    <Icon
      ref={iconRef}
      className={`chat-detail__animated-icon${active ? ' chat-detail__animated-icon--active' : ''}`}
      size={18}
      animateOnHover={false}
      aria-hidden="true"
    />
  )
}

const ToolStatusIcon: React.FC<{ activity: ProviderToolActivity; active: boolean }> = ({
  activity,
  active
}) => {
  if (active) {
    return <LoopingAnimatedIcon Icon={animatedActivityIcons[activity]} active={active} />
  }

  return <ToolTypeIcon activity={activity} />
}

const Activity: React.FC<{
  label: string
  tools: ProviderWorkingTool[]
  active: boolean
  expanded: boolean
  projectCwd?: string | null
}> = ({ label, tools, active, expanded, projectCwd }) => {
  const [openState, setOpenState] = useState({ expanded, open: expanded })
  const open = openState.expanded === expanded ? openState.open : expanded
  const activity = tools[0]?.activity ?? 'other'

  const detailLabel = getToolDisplayLabel(label || tools[0]?.toolId || 'Tool use', activity, active)

  return (
    <details
      className={`chat-detail__tool-group${active ? ' chat-detail__tool-group--active' : ''}`}
      open={open}
      onToggle={(event) => setOpenState({ expanded, open: event.currentTarget.open })}
    >
      <summary>
        <span className="chat-detail__tool-icon">
          <ToolStatusIcon activity={activity} active={active} />
        </span>
        <span className="chat-detail__tool-label">{detailLabel}</span>
        <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
      </summary>
      {open &&
        (activity === 'edit' || activity === 'create' || activity === 'delete' ? (
          <DiffContent tools={tools} projectCwd={projectCwd} />
        ) : activity === 'command' ||
          activity === 'search' ||
          activity === 'git' ||
          activity === 'npm' ||
          activity === 'npx' ||
          activity === 'script' ? (
          <CommandContent tools={tools} />
        ) : (
          <RawContent tools={tools} />
        ))}
    </details>
  )
}

const getToolsFromToolItem = (item: ProviderToolItem): ProviderWorkingTool[] =>
  item.type === 'toolGroup' ? item.tools : [item]

type MarkdownFence = {
  marker: '`' | '~'
  length: number
}

const getMarkdownFence = (line: string): MarkdownFence | null => {
  const match = line.match(/^(?: {0,3})(`{3,}|~{3,})/)
  if (!match) return null

  const marker = match[1]
  return { marker: marker[0] as MarkdownFence['marker'], length: marker.length }
}

const isMarkdownFenceClose = (line: string, fence: MarkdownFence): boolean => {
  const match = line.match(/^(?: {0,3})(`{3,}|~{3,})(.*)$/)
  if (!match) return false

  const marker = match[1]
  return marker[0] === fence.marker && marker.length >= fence.length && !match[2].trim()
}

const withPromptMarkdownLineBreaks = (content: string): string => {
  const parts = content.split(/(\r?\n)/)
  let fence: MarkdownFence | null = null

  return parts
    .map((part, index) => {
      if (index % 2 === 1 || !parts[index + 1]) return part

      if (fence) {
        if (isMarkdownFenceClose(part, fence)) fence = null
        return part
      }

      const nextFence = getMarkdownFence(part)
      if (nextFence) {
        fence = nextFence
        return part
      }

      if (!part.trim() || part.endsWith('  ')) return part
      return `${part}  `
    })
    .join('')
}

const withClickableAngleFileLinks = (content: string): string => {
  let fence: MarkdownFence | null = null

  return content
    .split('\n')
    .map((line) => {
      if (fence) {
        if (isMarkdownFenceClose(line, fence)) fence = null
        return line
      }

      const nextFence = getMarkdownFence(line)
      if (nextFence) {
        fence = nextFence
        return line
      }

      return line.replace(/\]\(<([^>\r\n]+)>\)/g, (match, target: string) => {
        if (!getMarkdownFileTarget(target)) return match

        const encodedTarget = encodeURI(target).replace(/\(/g, '%28').replace(/\)/g, '%29')
        return `](${encodedTarget})`
      })
    })
    .join('\n')
}

const ToolItem: React.FC<{
  item: ProviderToolItem
  activeToolIds: Set<string>
  expanded?: boolean
  projectCwd?: string | null
}> = ({ item, activeToolIds, expanded = false, projectCwd }) => {
  const tools = getToolsFromToolItem(item)
  const activity = tools[0]?.activity ?? 'other'
  const active = tools.some((tool) => activeToolIds.has(tool.id))
  const rawLabel = item.label || tools[0]?.toolId || 'Tool use'
  const label = getToolDisplayLabel(rawLabel, activity, active)

  if (activity === 'read') {
    return (
      <div className={`chat-detail__tool-read${active ? ' chat-detail__tool-read--active' : ''}`}>
        <span className="chat-detail__tool-icon">
          <ToolStatusIcon activity="read" active={active} />
        </span>
        <span className="chat-detail__tool-label">{label}</span>
      </div>
    )
  }

  return (
    <Activity
      label={rawLabel}
      tools={tools}
      active={active}
      expanded={expanded}
      projectCwd={projectCwd}
    />
  )
}

const MarkdownMessageComponent: React.FC<{
  className: string
  content: string
  onOpenFileLink?: (path: string, displayPath: string, line?: number) => void
  streaming?: boolean
}> = ({ className, content, onOpenFileLink, streaming = false }) => {
  const markdownOptions = useMemo(() => getMarkdownOptions(onOpenFileLink), [onOpenFileLink])

  return (
    <div className={className} data-streaming={streaming || undefined}>
      {streaming ? (
        <span className="chat-detail__streaming-text">{content}</span>
      ) : (
        <Markdown options={markdownOptions}>{withClickableAngleFileLinks(content)}</Markdown>
      )}
    </div>
  )
}

const MarkdownMessage = memo(MarkdownMessageComponent)

const copyTextToClipboard = async (content: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content)
    return
  }

  const textArea = document.createElement('textarea')
  textArea.value = content
  textArea.style.position = 'fixed'
  textArea.style.inset = '0 auto auto 0'
  textArea.style.opacity = '0'
  document.body.append(textArea)
  textArea.focus()
  textArea.select()

  try {
    if (!document.execCommand('copy')) throw new Error('Unable to copy message')
  } finally {
    textArea.remove()
  }
}

const formatMessageTimestamp = (
  timestamp: number | null | undefined
): { dateTime: string; label: string } | null => {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null

  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const sameYear = date.getFullYear() === now.getFullYear()
  const timeLabel = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  })
  const dayMonthLabel = date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short'
  })
  const dayMonthYearLabel = date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
  const dateLabel = sameDay ? '' : sameYear ? dayMonthLabel : dayMonthYearLabel

  return {
    dateTime: date.toISOString(),
    label: dateLabel ? `${dateLabel}, ${timeLabel}` : timeLabel
  }
}

const formatModelLabel = (label: string): string => label.replace(/-/g, ' ')

const getMessageModelLabel = (
  message: ProviderMessage,
  selectedModelId: ProviderModelId | undefined,
  modelLabelsById: ReadonlyMap<ProviderModelId, string> | undefined
): string | null => {
  const messageModel = message.model?.trim()
  const selectedModel = selectedModelId?.trim()
  if (!messageModel || !selectedModel || messageModel === selectedModel) return null

  return modelLabelsById?.get(messageModel) ?? formatModelLabel(messageModel)
}

const MessageDate: React.FC<{
  timestamp: ReturnType<typeof formatMessageTimestamp>
  markerSide: 'left' | 'right'
  modelLabel?: string | null
}> = ({ timestamp, markerSide, modelLabel }) => {
  if (!timestamp) {
    return <span className="chat-detail__message-date chat-detail__message-date--empty" />
  }

  const title = modelLabel ? `${timestamp.label} · ${modelLabel}` : timestamp.label

  return (
    <time className="chat-detail__message-date" dateTime={timestamp.dateTime} title={title}>
      {markerSide === 'left' && (
        <span className="chat-detail__message-date-marker" aria-hidden="true">
          ·
        </span>
      )}
      <span>{timestamp.label}</span>
      {modelLabel && (
        <>
          <span className="chat-detail__message-date-marker" aria-hidden="true">
            ·
          </span>
          <span>{modelLabel}</span>
        </>
      )}
      {markerSide === 'right' && (
        <span className="chat-detail__message-date-marker" aria-hidden="true">
          ·
        </span>
      )}
    </time>
  )
}

const getSequenceLabel = (tools: ProviderWorkingTool[]): string => {
  const labels = [...new Set(tools.map((tool) => activityLabels[tool.activity]))]
  const label = labels.join(', ') || activityLabels.other

  return label.charAt(0).toLocaleUpperCase() + label.slice(1)
}

const getDominantActivity = (tools: ProviderWorkingTool[]): ProviderToolActivity => {
  if (tools.length === 0) return 'other'

  const activityCounts = tools.reduce<Map<ProviderToolActivity, number>>((counts, tool) => {
    counts.set(tool.activity, (counts.get(tool.activity) ?? 0) + 1)
    return counts
  }, new Map())
  const highestCount = Math.max(...activityCounts.values())

  return (
    tools.find((tool) => activityCounts.get(tool.activity) === highestCount)?.activity ?? 'other'
  )
}

const ToolSequence: React.FC<{
  items: ProviderToolItem[]
  activeToolIds: Set<string>
  projectCwd?: string | null
}> = ({ items, activeToolIds, projectCwd }) => {
  const [open, setOpen] = useState(false)
  const tools = items.flatMap(getToolsFromToolItem)
  const activeTools = tools.filter((tool) => activeToolIds.has(tool.id))
  const active = activeTools.length > 0
  const dominantActivity = getDominantActivity(active ? activeTools : tools)
  const label = active ? activeActivityLabels[dominantActivity] : getSequenceLabel(tools)

  return (
    <details
      className={`chat-detail__tool-sequence${active ? ' chat-detail__tool-sequence--active' : ''}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="chat-detail__tool-icon">
          <ToolStatusIcon activity={dominantActivity} active={active} />
        </span>
        <span className="chat-detail__tool-label">{label}</span>
        <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
      </summary>
      {open && (
        <div className="chat-detail__tool-sequence-content">
          {items.map((item) => (
            <ToolItem
              item={item}
              activeToolIds={activeToolIds}
              key={item.id}
              projectCwd={projectCwd}
            />
          ))}
        </div>
      )}
    </details>
  )
}

const WorkingPlaceholder: React.FC<{ id: string }> = ({ id }) => {
  const placeholder = getPlaceholderOption(id)

  return (
    <div className="chat-detail__tool-read chat-detail__tool-read--active chat-detail__tool-placeholder">
      <span className="chat-detail__tool-icon">
        <LoopingAnimatedIcon Icon={placeholder.Icon} active />
      </span>
      <span className="chat-detail__tool-label">{placeholder.label}</span>
    </div>
  )
}

type PlaceholderState = {
  signature: string
  visible: boolean
}

const getToolSignature = (tool: ProviderWorkingTool): string =>
  [
    tool.id,
    tool.label,
    tool.status,
    tool.command?.length ?? 0,
    tool.stdout?.length ?? 0,
    tool.diffs.map((diff) => `${diff.path}:${diff.diff.length}`).join(','),
    tool.backgroundSessionId,
    tool.finishedBackgroundSessionId
  ].join(':')

const getWorkingItemSignature = (item: ProviderWorkingItem): string => {
  if (item.type === 'message') return `message:${item.id}:${item.content.length}`
  if (item.type === 'toolGroup') {
    return `toolGroup:${item.id}:${item.tools.map(getToolSignature).join('|')}`
  }

  return `tool:${getToolSignature(item)}`
}

const getActiveToolIds = (item: ProviderWorkingStep): Set<string> => {
  const activeToolIds = new Set<string>()
  if (item.status !== 'working') return activeToolIds

  const closedBackgroundSessionIds = new Set<string>()

  for (let itemIndex = item.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const workingItem = item.items[itemIndex]
    if (workingItem.type === 'message') continue

    const tools = getToolsFromToolItem(workingItem)
    for (let toolIndex = tools.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const tool = tools[toolIndex]
      if (tool.finishedBackgroundSessionId) {
        closedBackgroundSessionIds.add(tool.finishedBackgroundSessionId)
      }
      if (tool.backgroundSessionId && !closedBackgroundSessionIds.has(tool.backgroundSessionId)) {
        activeToolIds.add(tool.id)
      }
      if (tool.status === 'running' && longRunningActivities.has(tool.activity)) {
        activeToolIds.add(tool.id)
      }
    }
  }

  const lastItem = item.items.at(-1)
  if (lastItem && lastItem.type !== 'message') {
    for (const tool of getToolsFromToolItem(lastItem)) {
      activeToolIds.add(tool.id)
    }
  }

  return activeToolIds
}

const useSilencePlaceholder = (signature: string, active: boolean, immediate: boolean): boolean => {
  const [placeholderState, setPlaceholderState] = useState<PlaceholderState>(() => ({
    signature,
    visible: active && immediate
  }))

  useEffect(() => {
    if (!active) return undefined

    const timeout = window.setTimeout(
      () => setPlaceholderState({ signature, visible: true }),
      immediate ? 0 : silencePlaceholderDelayMs
    )

    return () => window.clearTimeout(timeout)
  }, [active, immediate, signature])

  return active && placeholderState.signature === signature && placeholderState.visible
}

const groupWorkingItems = (items: ProviderWorkingItem[]): WorkingBlock[] => {
  const blocks: WorkingBlock[] = []

  for (const item of items) {
    if (item.type === 'message') {
      blocks.push({ type: 'message', item })
      continue
    }

    const lastBlock = blocks[blocks.length - 1]
    if (lastBlock?.type === 'tools') {
      lastBlock.items.push(item)
    } else {
      blocks.push({ type: 'tools', items: [item] })
    }
  }

  return blocks
}

const WorkingStep: React.FC<{
  item: ProviderWorkingStep
  onOpenFileLink?: (path: string, displayPath: string, line?: number) => void
  projectCwd?: string | null
}> = ({ item, onOpenFileLink, projectCwd }) => {
  const blocks = groupWorkingItems(item.items)
  const lastWorkingItem = item.items.at(-1)
  const signature = useMemo(
    () => `${item.status}:${item.items.map(getWorkingItemSignature).join('|')}`,
    [item.items, item.status]
  )
  const activeToolIds = useMemo(() => getActiveToolIds(item), [item])
  const active = item.status === 'working'
  const [open, setOpen] = useState(active)
  const showPlaceholder = useSilencePlaceholder(
    signature,
    active && (!lastWorkingItem || lastWorkingItem.type === 'message'),
    !lastWorkingItem
  )
  const label =
    item.status === 'queued'
      ? 'Queued'
      : item.status === 'stopped'
        ? 'Stopped'
        : item.status === 'worked'
          ? 'Worked'
          : 'Working'
  const heading = (
    <span className="chat-detail__working-label">
      {active && <LoaderCircle className="chat-detail__working-spinner" aria-hidden="true" />}
      <span>{label}</span>
    </span>
  )

  if (blocks.length === 0) {
    if (showPlaceholder) {
      return <WorkingPlaceholder id={item.id} />
    }

    return (
      <div
        className={`chat-detail__step chat-detail__working chat-detail__working--${item.status}`}
      >
        <div className="chat-detail__working-heading">{heading}</div>
      </div>
    )
  }

  return (
    <details
      className={`chat-detail__step chat-detail__working chat-detail__working--${item.status}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {heading}
        <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
      </summary>
      {open && (
        <div className="chat-detail__step-content">
          {blocks.map((block, blockIndex) =>
            block.type === 'tools' ? (
              block.items.length > 1 &&
              (blockIndex < blocks.length - 1 || item.status !== 'working' || showPlaceholder) ? (
                <ToolSequence
                  items={block.items}
                  activeToolIds={activeToolIds}
                  key={block.items[0]?.id}
                  projectCwd={projectCwd}
                />
              ) : (
                block.items.map((toolItem) => (
                  <ToolItem
                    item={toolItem}
                    activeToolIds={activeToolIds}
                    expanded={active && toolItem === lastWorkingItem}
                    key={toolItem.id}
                    projectCwd={projectCwd}
                  />
                ))
              )
            ) : (
              <MarkdownMessage
                className="chat-detail__working-message"
                content={block.item.content}
                key={block.item.id}
                onOpenFileLink={onOpenFileLink}
                streaming={active && block.item === lastWorkingItem}
              />
            )
          )}
          {showPlaceholder && <WorkingPlaceholder id={`${item.id}:${item.items.length}`} />}
        </div>
      )}
    </details>
  )
}

const getPendingMessageLabel = (message: ProviderPendingMessage): string =>
  message.kind === 'steering' ? 'Steering with' : 'Queue'

const getPendingMessageActionLabel = (message: ProviderPendingMessage): string =>
  message.kind === 'steering' ? 'steering' : 'queued'

const ChatDetailItemComponent: React.FC<ChatDetailItemProps> = ({
  canEditOwnMessages = false,
  item,
  modelLabelsById,
  onDeletePendingMessage,
  onEditPendingMessage,
  onInterruptPendingMessage,
  onEditMessage,
  onOpenFileLink,
  projectCwd,
  selectedModelId,
  streaming = false
}) => {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return undefined

    const timeout = window.setTimeout(() => setCopied(false), 1_200)
    return () => window.clearTimeout(timeout)
  }, [copied])

  if (item.type === 'contextCompaction') {
    return (
      <div className="chat-detail__context-compaction">
        <span>Context Compacted Automatically</span>
      </div>
    )
  }

  if (item.type === 'message' || item.type === 'pendingMessage') {
    const pending = item.type === 'pendingMessage'
    const role = pending ? 'user' : item.role
    const messageLabel = pending ? getPendingMessageLabel(item) : (item.label ?? null)
    const pendingActionLabel = pending ? getPendingMessageActionLabel(item) : 'pending'
    const canEdit = !pending && role === 'user' && canEditOwnMessages && Boolean(onEditMessage)
    const canEditPending = pending && Boolean(onEditPendingMessage)
    const canDelete = pending && Boolean(onDeletePendingMessage)
    const canInterrupt = pending && Boolean(onInterruptPendingMessage)
    const timestamp = formatMessageTimestamp(item.createdAt)
    const modelLabel = pending ? null : getMessageModelLabel(item, selectedModelId, modelLabelsById)
    const handleCopyMessage = async (): Promise<void> => {
      await copyTextToClipboard(item.content)
      setCopied(true)
    }
    const messageActions = (
      <span className="chat-detail__message-actions">
        {canEdit && (
          <Button
            theme="secondary"
            size="small"
            aria-label="Edit message"
            title="Edit message"
            callback={() => {
              if (item.type === 'message') onEditMessage?.(item)
            }}
            icon={<Pencil aria-hidden="true" />}
          />
        )}
        {canEditPending && pending && (
          <Button
            theme="secondary"
            size="small"
            aria-label={`Edit ${pendingActionLabel} message`}
            title={`Edit ${pendingActionLabel} message`}
            callback={() => onEditPendingMessage?.(item)}
            icon={<Pencil aria-hidden="true" />}
          />
        )}
        {canInterrupt && pending && (
          <Button
            theme="secondary"
            size="small"
            aria-label={`Interrupt with ${pendingActionLabel} message`}
            title={`Interrupt with ${pendingActionLabel} message`}
            callback={() => onInterruptPendingMessage?.(item)}
            icon={
              item.kind === 'queued' ? (
                <ArrowUp aria-hidden="true" />
              ) : (
                <Square aria-hidden="true" />
              )
            }
          />
        )}
        {canDelete && pending && (
          <Button
            theme="secondary"
            size="small"
            aria-label={`Delete ${pendingActionLabel} message`}
            title={`Delete ${pendingActionLabel} message`}
            callback={() => onDeletePendingMessage?.(item)}
            icon={<Trash2 aria-hidden="true" />}
          />
        )}
        {!canEdit && !canEditPending && !canInterrupt && !canDelete && role === 'user' ? (
          <span className="chat-detail__message-action-placeholder" aria-hidden="true" />
        ) : null}
        <Button
          theme="secondary"
          size="small"
          aria-label={copied ? 'Copied message' : 'Copy message'}
          title={copied ? 'Copied' : 'Copy message'}
          callback={handleCopyMessage}
          icon={copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        />
      </span>
    )
    const messageDate = (
      <MessageDate
        markerSide={role === 'user' ? 'right' : 'left'}
        modelLabel={modelLabel}
        timestamp={timestamp}
      />
    )
    const messageBlockClassName = [
      'chat-detail__message-block',
      `chat-detail__message-block--${role}`,
      pending ? 'chat-detail__message-block--pending' : null,
      pending ? `chat-detail__message-block--pending-${item.kind}` : null
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <div className={messageBlockClassName}>
        {messageLabel && <span className="chat-detail__pending-message-label">{messageLabel}</span>}
        <MarkdownMessage
          className={`chat-detail__message chat-detail__message--${role}`}
          content={role === 'user' ? withPromptMarkdownLineBreaks(item.content) : item.content}
          onOpenFileLink={onOpenFileLink}
          streaming={!pending && role === 'assistant' && streaming}
        />
        <div className="chat-detail__message-footer">
          {role === 'user' && messageDate}
          {messageActions}
          {role === 'assistant' && messageDate}
        </div>
      </div>
    )
  }

  return <WorkingStep item={item} onOpenFileLink={onOpenFileLink} projectCwd={projectCwd} />
}

export const ChatDetailItem = memo(ChatDetailItemComponent, areChatDetailItemPropsEqual)
