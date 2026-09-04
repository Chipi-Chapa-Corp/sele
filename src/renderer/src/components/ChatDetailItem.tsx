import {
  Fragment,
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ForwardRefExoticComponent, HTMLAttributes, ReactNode, RefAttributes } from 'react'
import {
  AudioLinesIcon as AnimatedAudioLinesIcon,
  BotIcon as AnimatedBotIcon,
  BoxIcon as AnimatedBoxIcon,
  BookTextIcon as AnimatedBookTextIcon,
  CircleHelpIcon as AnimatedCircleHelpIcon,
  DeleteIcon as AnimatedDeleteIcon,
  EyeIcon as AnimatedEyeIcon,
  FilePenLineIcon as AnimatedFilePenLineIcon,
  FileStackIcon as AnimatedFileStackIcon,
  FileTextIcon as AnimatedFileTextIcon,
  GitBranchIcon as AnimatedGitBranchIcon,
  ListIcon as AnimatedListIcon,
  PenToolIcon as AnimatedPenToolIcon,
  SearchIcon as AnimatedSearchIcon,
  SparklesIcon as AnimatedSparklesIcon,
  TerminalIcon as AnimatedTerminalIcon,
  WrenchIcon as AnimatedWrenchIcon
} from 'lucide-animated'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ArrowUp,
  Blocks,
  BookOpenText,
  Bot,
  Check,
  ChevronRight,
  CircleQuestionMark,
  Copy,
  CornerDownRight,
  Eye,
  FilePlus2,
  FileCode2,
  FileText,
  GitBranch,
  GitFork,
  Globe2,
  Image as ImageIcon,
  ImageOff,
  ListChecks,
  LoaderCircle,
  Maximize2,
  Package,
  Pencil,
  Pin,
  PinOff,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Wrench
} from 'lucide-react'
import DOMPurify from 'dompurify'
import { marked, Renderer, type Tokens } from 'marked'
import type { AppContainerTarget, AppLocalImageOptions } from '../../../shared/app'
import type {
  ProviderChatItem,
  ProviderAccountRateLimitResetOutcome,
  ProviderMessage,
  ProviderMessageAttachment,
  ProviderModelId,
  ProviderPendingMessage,
  ProviderToolActivity,
  ProviderToolIcon,
  ProviderWorkingItem,
  ProviderWorkingStep,
  ProviderWorkingTool
} from '../../../shared/provider'
import { appApi } from '../appApi'
import { getChatMessagePresentation, type ChatMessageResource } from '../chatMessageResources'
import { getWorkingStepItemSegments } from '../chatDetailWindow'
import { renderMarkdownCodeBlock } from '../codeHighlighting'
import { createLocalImageUrl } from '../localImage'
import { getMarkdownFileLinkLabel, getMarkdownFileTarget } from '../markdownFileLink'
import { hydrateMermaidDiagrams } from '../mermaidRendering'
import { getBrowserFaviconUrl } from '../../../shared/browser'
import { getRateLimitResetMessage } from '../rateLimitReset'
import { formatSemanticLexicalDateDifference, useSemanticDateNow } from '../semanticDateDifference'
import { defaultAppChatProgressSettings, type AppChatProgressSettings } from '../settings'
import {
  getWorkingStepDefaultOpen,
  getWorkingStepDisclosureKey,
  resolveWorkingStepOpen,
  type WorkingStepProgressPolicy
} from '../workingStepDisclosure'
import { Button } from './Button'
import { BoundedHighlightedCode } from './BoundedHighlightedCode'
import { HighlightedCode } from './HighlightedCode'
import { ImageLightbox } from './ImageLightbox'
import { ReviewCommentsButton } from './ReviewCommentsButton'
import { RateLimitResetButton } from './RateLimitResetButton'
import { TableLightbox } from './TableLightbox'
import { ToolDiff } from './ToolDiff'
import './ChatDetailItem.css'

const workingItemPageSize = 50
const workingToolPageSize = 50

type ChatDetailItemProps = {
  availableRateLimitResets?: number
  canEditOwnMessages?: boolean
  container?: AppContainerTarget | null
  continuePrompt?: string
  continueStoppedTurnDisabled?: boolean
  continuedStoppedTurn?: boolean
  followingWorkingStepHasNext?: boolean
  followingWorkingStepStatus?: ProviderWorkingStep['status']
  hasNextWorkingStep?: boolean
  item: ProviderChatItem
  messagePinned?: boolean
  modelLabelsById?: ReadonlyMap<ProviderModelId, string>
  onDeletePendingMessage?: (message: ProviderPendingMessage) => void
  onEditPendingMessage?: (message: ProviderPendingMessage) => void
  onSteerPendingMessage?: (message: ProviderPendingMessage) => void
  onInterruptPendingMessage?: (message: ProviderPendingMessage) => void
  onEditMessage?: (message: ProviderMessage) => void
  onForkMessage?: (message: ProviderMessage) => Promise<void> | void
  onLoadWorkingStep?: (workingStepId: string, startIndex?: number) => Promise<void> | void
  onLoadWorkingItem?: (workingStepId: string, workingItemId: string) => Promise<void> | void
  onLoadWorkingToolPage?: (
    workingStepId: string,
    workingItemId: string,
    startIndex: number
  ) => Promise<void> | void
  onDisclosureToggle?: () => void
  onOpenFileLink?: (path: string, displayPath: string, line?: number, endLine?: number) => void
  onToggleMessagePinned?: (message: ProviderMessage, turnIndex: number, pinned: boolean) => void
  onContinueStoppedTurn?: (workingStepId: string, prompt: string) => Promise<void> | void
  onRetryStoppedTurn?: (message: ProviderMessage) => Promise<void> | void
  onUsageRefresh?: () => Promise<void> | void
  onUsageReset?: () => Promise<ProviderAccountRateLimitResetOutcome>
  previousItem?: ProviderChatItem | null
  cwd?: string | null
  projectCwd?: string | null
  progressPolicy?: WorkingStepProgressPolicy
  progressSettings?: AppChatProgressSettings
  rateLimitResetDisabled?: boolean
  retryMessage?: ProviderMessage | null
  retryStoppedTurnDisabled?: boolean
  selectedModelId?: ProviderModelId
  streaming?: boolean
  turnIndex?: number
  workingStepContent?: ReactNode
}

const getProgressSettings = (settings?: AppChatProgressSettings): AppChatProgressSettings =>
  settings ?? defaultAppChatProgressSettings

const areProgressSettingsEqual = (
  first?: AppChatProgressSettings,
  second?: AppChatProgressSettings
): boolean => {
  const normalizedFirst = getProgressSettings(first)
  const normalizedSecond = getProgressSettings(second)

  return (
    normalizedFirst.expandProgressOnStart === normalizedSecond.expandProgressOnStart &&
    normalizedFirst.collapseProgressOnFinish === normalizedSecond.collapseProgressOnFinish &&
    normalizedFirst.collapseProgressOnNextTurn === normalizedSecond.collapseProgressOnNextTurn &&
    normalizedFirst.collapseStoppedSteeredFailedProgressOnFinish ===
      normalizedSecond.collapseStoppedSteeredFailedProgressOnFinish &&
    normalizedFirst.collapseStoppedSteeredFailedProgressOnNextTurn ===
      normalizedSecond.collapseStoppedSteeredFailedProgressOnNextTurn
  )
}

const isQueuedPendingMessage = (item: ProviderChatItem | null | undefined): boolean =>
  item?.type === 'pendingMessage' && item.kind === 'queued'

const areChatDetailItemPropsEqual = (
  first: ChatDetailItemProps,
  second: ChatDetailItemProps
): boolean =>
  first.canEditOwnMessages === second.canEditOwnMessages &&
  first.availableRateLimitResets === second.availableRateLimitResets &&
  first.container === second.container &&
  first.continuePrompt === second.continuePrompt &&
  first.continueStoppedTurnDisabled === second.continueStoppedTurnDisabled &&
  first.continuedStoppedTurn === second.continuedStoppedTurn &&
  first.followingWorkingStepHasNext === second.followingWorkingStepHasNext &&
  first.followingWorkingStepStatus === second.followingWorkingStepStatus &&
  first.hasNextWorkingStep === second.hasNextWorkingStep &&
  first.messagePinned === second.messagePinned &&
  first.modelLabelsById === second.modelLabelsById &&
  first.onDeletePendingMessage === second.onDeletePendingMessage &&
  first.onEditPendingMessage === second.onEditPendingMessage &&
  first.onSteerPendingMessage === second.onSteerPendingMessage &&
  first.onInterruptPendingMessage === second.onInterruptPendingMessage &&
  first.onEditMessage === second.onEditMessage &&
  first.onForkMessage === second.onForkMessage &&
  first.onLoadWorkingStep === second.onLoadWorkingStep &&
  first.onLoadWorkingItem === second.onLoadWorkingItem &&
  first.onLoadWorkingToolPage === second.onLoadWorkingToolPage &&
  first.onDisclosureToggle === second.onDisclosureToggle &&
  first.onOpenFileLink === second.onOpenFileLink &&
  first.onToggleMessagePinned === second.onToggleMessagePinned &&
  first.onContinueStoppedTurn === second.onContinueStoppedTurn &&
  first.onRetryStoppedTurn === second.onRetryStoppedTurn &&
  first.onUsageRefresh === second.onUsageRefresh &&
  first.onUsageReset === second.onUsageReset &&
  isQueuedPendingMessage(first.previousItem) === isQueuedPendingMessage(second.previousItem) &&
  first.cwd === second.cwd &&
  first.projectCwd === second.projectCwd &&
  first.progressPolicy === second.progressPolicy &&
  first.rateLimitResetDisabled === second.rateLimitResetDisabled &&
  first.retryMessage === second.retryMessage &&
  first.retryStoppedTurnDisabled === second.retryStoppedTurnDisabled &&
  first.selectedModelId === second.selectedModelId &&
  first.streaming === second.streaming &&
  first.turnIndex === second.turnIndex &&
  first.workingStepContent === second.workingStepContent &&
  areProgressSettingsEqual(first.progressSettings, second.progressSettings) &&
  first.item === second.item

type ProviderToolItem = Exclude<ProviderWorkingItem, { type: 'message' }>
type ProviderWorkingMessageItem = Extract<ProviderWorkingItem, { type: 'message' }>
type WorkingBlock =
  | { type: 'message'; item: ProviderWorkingMessageItem }
  | { type: 'tools'; items: ProviderToolItem[] }

const isWorkingItemPayloadLoaded = (item: ProviderWorkingItem): boolean => {
  if (item.type === 'message') return item.contentLoaded !== false
  if (item.type === 'toolGroup') return item.tools.every((tool) => tool.payloadLoaded !== false)
  return item.payloadLoaded !== false
}

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

const animatedToolIcons: Record<ProviderToolIcon, AnimatedIconComponent> = {
  'image-view': AnimatedEyeIcon,
  'image-generation': AnimatedSparklesIcon,
  'openai-docs': AnimatedBookTextIcon,
  plan: AnimatedListIcon,
  question: AnimatedCircleHelpIcon,
  subagent: AnimatedBotIcon
}

const placeholderOptions = [
  'Thinking',
  'Analyzing',
  'Processing',
  'Working',
  'Vibing',
  'Bribing beavers',
  'Bribing monkeys',
  'Bribing ducks',
  'Drinking water',
  'Drinking whisky',
  'Scrolling Instagram',
  'Scrolling YouTube',
  'Scrolling TikTok',
  'Bouncing logic trampolines',
  'Knitting cozy nonsense',
  'Brain buffering',
  'Consulting rubber duck',
  'Overclocking whimsy',
  'Brewing ideas',
  'Consulting the stars',
  'Hallucinating',
  'Overthinking',
  'Judging',
  'Consulting my cat',
  'Polishing pixels',
  'Negotiating with semicolons',
  'Asking the void nicely',
  'Herding stray thoughts',
  'Warming up neurons',
  'Untangling spaghetti logic',
  'Consulting ancient Stack Overflow',
  'Counting invisible chickens',
  'Shuffling imaginary paperwork',
  'Summoning the right answer',
  'Dusting off algorithms',
  'Feeding the hamsters',
  'Aligning cosmic brackets',
  'Interviewing suspicious variables',
  'Recalculating the vibes',
  'Chasing a runaway comma',
  'Teaching bytes to cooperate',
  'Decoding alien handwriting',
  'Inflating a fresh hypothesis',
  'Checking under the keyboard',
  'Arguing with probability',
  'Folding space-time',
  'Reticulating splines',
  'Spinning up tiny detectives',
  'Making electrons nervous',
  'Putting chaos in alphabetical order',
  'Convincing bugs to confess',
  'Reading tea leaves in binary',
  "Sharpening Occam's razor",
  'Loading common sense',
  'Borrowing a second brain',
  'Organizing the sock drawer',
  'Reversing the polarity',
  'Calibrating the nonsense detector',
  'Assembling a clue sandwich',
  'Poking the edge cases',
  'Translating from robot',
  'Sacrificing a semicolon',
  'Updating the prophecy',
  'Waiting for inspiration to compile',
  'Cross-examining the data',
  'Applying duct tape to logic',
  'Looking busy',
  'Running on pure audacity',
  'Dividing by not quite zero',
  'Making a long story longer',
  'Turning coffee into tokens',
  'Rehearsing the final answer',
  'Checking the manual upside down',
  'Pretending this is deterministic'
]
const longRunningActivities = new Set<ProviderToolActivity>(['npm', 'npx', 'script', 'command'])
const silencePlaceholderDelayMs = 600
const streamRenderMaxDelayMs = 180

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })

const renderHtmlAttributes = (attributes: Record<string, string | number | undefined>): string =>
  Object.entries(attributes)
    .flatMap(([name, value]) =>
      value === undefined || value === '' ? [] : [` ${name}="${escapeHtml(String(value))}"`]
    )
    .join('')

const defaultChatMarkdownRenderer = new Renderer()
const loadingImageIconMarkup = renderToStaticMarkup(<ImageIcon aria-hidden="true" />)
const brokenImageIconMarkup = renderToStaticMarkup(<ImageOff aria-hidden="true" />)
const expandTableIconMarkup = renderToStaticMarkup(<Maximize2 aria-hidden="true" />)

const createChatMarkdownRenderer = (interactiveFileLinks: boolean): Renderer => {
  const renderer = new Renderer()

  renderer.html = ({ text }) => escapeHtml(text)
  renderer.code = ({ lang, text }) => renderMarkdownCodeBlock(text, lang)
  renderer.link = function (token: Tokens.Link): string {
    const fileTarget = getMarkdownFileTarget(token.href)
    if (fileTarget && interactiveFileLinks) {
      const label = getMarkdownFileLinkLabel(token, fileTarget.line)
      const fileName = fileTarget.displayPath.split('/').at(-1) ?? fileTarget.displayPath
      const iconMarkup = renderToStaticMarkup(
        <SymbolsFileIcon fileName={fileName} autoAssign aria-hidden="true" />
      )
      const title = fileTarget.line
        ? `Open ${fileTarget.displayPath} at line ${fileTarget.line}`
        : `Open ${fileTarget.displayPath}`
      const lineMarkup = fileTarget.line
        ? `<span class="chat-detail__file-link-separator" aria-hidden="true">·</span><span class="chat-detail__file-link-line" aria-label="Line ${fileTarget.line}">${fileTarget.line}</span>`
        : ''

      return `<button${renderHtmlAttributes({
        class: 'chat-detail__file-link',
        type: 'button',
        title,
        'data-file-link-path': fileTarget.path,
        'data-file-link-display-path': fileTarget.displayPath,
        'data-file-link-line': fileTarget.line
      })}><span class="chat-detail__file-link-icon" aria-hidden="true">${iconMarkup}</span><span class="chat-detail__file-link-label">${escapeHtml(label)}</span>${lineMarkup}</button>`
    }

    const href = token.href
    const title = token.title ?? undefined
    const children = this.parser.parseInline(token.tokens)
    const faviconUrl = getBrowserFaviconUrl(href)
    const faviconMarkup = faviconUrl
      ? `<img${renderHtmlAttributes({
          class: 'chat-detail__link-favicon',
          src: faviconUrl,
          alt: ' ',
          loading: 'lazy',
          referrerpolicy: 'no-referrer',
          'aria-hidden': 'true'
        })}>`
      : ''
    return `<a${renderHtmlAttributes({
      href,
      title,
      rel: 'noreferrer',
      target: '_blank'
    })}>${faviconMarkup}${children}</a>`
  }
  renderer.image = function (token: Tokens.Image): string {
    const fileTarget = getMarkdownFileTarget(token.href)
    if (!fileTarget) return defaultChatMarkdownRenderer.image.call(this, token)

    const fileName = fileTarget.displayPath.split('/').at(-1) ?? fileTarget.displayPath
    const name = token.text.trim() || fileName

    return `<button${renderHtmlAttributes({
      class: 'chat-detail__markdown-image',
      type: 'button',
      title: `Open ${fileTarget.displayPath}`,
      'aria-label': `Open ${name}`,
      'data-local-image-path': fileTarget.path,
      'data-local-image-name': name
    })}><span class="chat-detail__markdown-image-loading" aria-label="Loading ${escapeHtml(name)}">${loadingImageIconMarkup}</span></button>`
  }
  renderer.table = function (token: Tokens.Table): string {
    const tableMarkup = defaultChatMarkdownRenderer.table.call(this, token)
    const renderedTable = tableMarkup.replace('<table>', '<table class="chat-detail__table">')
    return `<div class="chat-detail__table-frame"><div class="chat-detail__table-scroll">${renderedTable}</div><button class="chat-detail__table-expand" type="button" aria-label="Expand table" aria-haspopup="dialog" title="Expand table">${expandTableIconMarkup}</button></div>`
  }

  return renderer
}

const getRandomPlaceholderOption = (): (typeof placeholderOptions)[number] =>
  placeholderOptions[Math.floor(Math.random() * placeholderOptions.length)]

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
  [/^Generated\b/, 'Generating'],
  [/^Waited\b/, 'Waiting']
]

const finishedLabelPrefixes =
  /^(Read|Searched|Checked|Viewed|Ran|Used|Changed|Created|Deleted|Applied|Updated|Generated|Waited)\b/

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
): string => {
  if (label === 'Asking question' || label === 'Asked a question') return label
  return active ? getActiveToolLabel(label, activity) : getFinishedToolLabel(label, activity)
}

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
          <BoundedHighlightedCode language={getOutputLanguage(tool.stdout)}>
            {tool.stdout}
          </BoundedHighlightedCode>
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
        <BoundedHighlightedCode language={getToolValueLanguage(tool.rawOutput)}>
          {formatToolValue(tool.rawOutput)}
        </BoundedHighlightedCode>
      </section>
    ))}
  </div>
)

const ToolTypeIcon: React.FC<{
  activity: ProviderToolActivity
  icon?: ProviderToolIcon | null
}> = ({ activity, icon }) => {
  if (icon === 'image-view') return <Eye aria-hidden="true" />
  if (icon === 'image-generation') return <Sparkles aria-hidden="true" />
  if (icon === 'openai-docs') return <BookOpenText aria-hidden="true" />
  if (icon === 'plan') return <ListChecks aria-hidden="true" />
  if (icon === 'question') return <CircleQuestionMark aria-hidden="true" />
  if (icon === 'subagent') return <Bot aria-hidden="true" />

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

const ActiveAnimatedIcon: React.FC<{
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
    return () => icon?.stopAnimation()
  }, [active])

  return (
    <Icon
      ref={iconRef}
      className="chat-detail__animated-icon"
      size={18}
      animateOnHover={false}
      aria-hidden="true"
    />
  )
}

const ToolStatusIcon: React.FC<{
  activity: ProviderToolActivity
  active: boolean
  icon?: ProviderToolIcon | null
}> = ({ activity, active, icon }) => {
  if (active) {
    const Icon = icon ? animatedToolIcons[icon] : animatedActivityIcons[activity]
    return <ActiveAnimatedIcon Icon={Icon} active={active} />
  }

  return <ToolTypeIcon activity={activity} icon={icon} />
}

const Activity: React.FC<{
  label: string
  tools: ProviderWorkingTool[]
  active: boolean
  expanded: boolean
  onDisclosureToggle?: () => void
  projectCwd?: string | null
}> = ({ label, tools, active, expanded, onDisclosureToggle, projectCwd }) => {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const open = manualOpen ?? expanded
  const activity = tools[0]?.activity ?? 'other'

  const detailLabel = getToolDisplayLabel(label || tools[0]?.toolId || 'Tool use', activity, active)

  return (
    <details
      className={`chat-detail__tool-group${active ? ' chat-detail__tool-group--active' : ''}`}
      open={open}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open
        if (nextOpen !== open) setManualOpen(nextOpen)
      }}
    >
      <summary onClick={onDisclosureToggle}>
        <span className="chat-detail__tool-icon">
          <ToolStatusIcon activity={activity} active={active} icon={tools[0]?.icon} />
        </span>
        <span className="chat-detail__tool-label">{detailLabel}</span>
        <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
      </summary>
      {open && (
        <>
          {activity === 'edit' || activity === 'create' || activity === 'delete' ? (
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
          )}
          {tools.some((tool) => tool.payloadTruncated) && (
            <span className="chat-detail__working-load-error">
              Showing a bounded preview of this large payload.
            </span>
          )}
        </>
      )}
    </details>
  )
}

const getToolsFromToolItem = (item: ProviderToolItem): ProviderWorkingTool[] =>
  item.type === 'toolGroup' ? item.tools : [item]

const hasToolDetails = (tool: ProviderWorkingTool): boolean =>
  Boolean(
    tool.command ||
    tool.stdout ||
    tool.diffs.length > 0 ||
    tool.rawInput != null ||
    tool.rawOutput != null
  )

const GeneratedImageThumbnail: React.FC<{
  path?: string | null
  initialDataUrl?: string | null
  name?: string
}> = ({ path, initialDataUrl, name = 'Generated image' }) => {
  const [loadedImage, setLoadedImage] = useState<{ path: string; url: string } | null>(null)
  const [failedPath, setFailedPath] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const imageUrl = path
    ? loadedImage?.path === path
      ? loadedImage.url
      : null
    : (initialDataUrl ?? null)
  const failed = path ? failedPath === path : !initialDataUrl

  useEffect(() => {
    if (!path) return undefined

    let current = true
    let objectUrl: string | null = null

    void appApi
      .getLocalImage({ path })
      .then((image) => {
        if (!current) return
        objectUrl = createLocalImageUrl(image)
        setLoadedImage({ path, url: objectUrl })
      })
      .catch(() => {
        if (current) setFailedPath(path)
      })

    return () => {
      current = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [initialDataUrl, path])

  if (failed) {
    return (
      <span
        className="chat-detail__generated-image-error"
        title={`${path ?? name} unavailable`}
        aria-label={`${name} unavailable`}
      >
        <ImageOff aria-hidden="true" />
      </span>
    )
  }

  if (!imageUrl) {
    return (
      <span className="chat-detail__generated-image-loading" aria-label="Loading image">
        <ImageIcon aria-hidden="true" />
      </span>
    )
  }

  return (
    <>
      <button
        className="chat-detail__generated-image-thumbnail"
        type="button"
        title={`Open ${name}`}
        aria-label={`Open ${name}`}
        onClick={() => setOpen(true)}
      >
        <img src={imageUrl} alt={name} />
      </button>
      {open && (
        <ImageLightbox imageUrl={imageUrl} name={name} path={path} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

const MessageAttachments: React.FC<{
  attachments: ProviderMessageAttachment[]
  onOpenFileLink?: (path: string, displayPath: string, line?: number, endLine?: number) => void
  projectCwd?: string | null
  resources?: ChatMessageResource[]
}> = ({ attachments, onOpenFileLink, projectCwd, resources = [] }) => {
  const imageAttachments = attachments.filter((attachment) => attachment.kind === 'image')
  const otherAttachments = attachments.filter((attachment) => attachment.kind !== 'image')

  return (
    <div className="chat-detail__message-attachments">
      {imageAttachments.length > 0 && (
        <div
          className="chat-detail__message-attachment-group chat-detail__message-attachment-group--images"
          role="list"
          aria-label="Message images"
        >
          {imageAttachments.map((attachment, index) => (
            <div
              className="chat-detail__message-attachment"
              key={`${attachment.kind}:${attachment.path ?? attachment.name}:${index}`}
              role="listitem"
            >
              <GeneratedImageThumbnail
                path={attachment.path}
                initialDataUrl={attachment.dataUrl}
                name={attachment.name}
              />
            </div>
          ))}
        </div>
      )}
      {(resources.length > 0 || otherAttachments.length > 0) && (
        <div
          className="chat-detail__message-attachment-group chat-detail__message-attachment-group--other"
          role="list"
          aria-label="Other message attachments"
        >
          {resources.map((resource, index) => (
            <div
              className="chat-detail__message-attachment"
              key={`${resource.kind}:${
                resource.kind === 'app'
                  ? resource.id
                  : resource.kind === 'browserContext'
                    ? 'browser-context'
                    : resource.name
              }:${index}`}
              role="listitem"
            >
              <span
                className="chat-detail__message-attachment-link chat-detail__message-attachment-resource"
                title={
                  resource.kind === 'browserContext'
                    ? 'Browser context'
                    : `${resource.kind === 'skill' ? 'Skill' : 'App'}: ${resource.name}`
                }
              >
                <span className="chat-detail__message-attachment-icon" aria-hidden="true">
                  {resource.kind === 'skill' ? (
                    <Package />
                  ) : resource.kind === 'app' ? (
                    <Blocks />
                  ) : (
                    <Globe2 />
                  )}
                </span>
                <span className="chat-detail__message-attachment-label">
                  {resource.kind === 'browserContext'
                    ? 'Browser context'
                    : resource.kind === 'app'
                      ? `$${resource.name}`
                      : resource.name}
                </span>
              </span>
            </div>
          ))}
          {otherAttachments.map((attachment, index) =>
            attachment.kind === 'review' ? (
              <div
                className="chat-detail__message-attachment"
                key={`${attachment.kind}:${attachment.id}:${index}`}
                role="listitem"
              >
                <ReviewCommentsButton
                  className="chat-detail__message-attachment-link chat-detail__message-attachment-review"
                  comments={attachment.comments}
                  onOpenFileLink={onOpenFileLink}
                  projectCwd={projectCwd}
                />
              </div>
            ) : (
              <div
                className="chat-detail__message-attachment"
                key={`${attachment.kind}:${attachment.path ?? attachment.name}:${index}`}
                role="listitem"
              >
                <button
                  className="chat-detail__message-attachment-link chat-detail__message-attachment-file"
                  type="button"
                  disabled={!attachment.path || !onOpenFileLink}
                  title={attachment.path ?? attachment.name}
                  onClick={() => {
                    if (attachment.path) onOpenFileLink?.(attachment.path, attachment.name)
                  }}
                >
                  <span className="chat-detail__message-attachment-icon" aria-hidden="true">
                    <SymbolsFileIcon fileName={attachment.name} autoAssign />
                  </span>
                  <span className="chat-detail__message-attachment-label">{attachment.name}</span>
                </button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

const GeneratedImageTool: React.FC<{
  active: boolean
  label: string
  tools: ProviderWorkingTool[]
}> = ({ active, label, tools }) => {
  const images = Array.from(
    new Map(
      tools
        .flatMap((tool) => tool.images)
        .flatMap((image) => {
          const key = image.path || image.dataUrl
          return key ? [[key, image] as const] : []
        })
    ).values()
  )

  return (
    <div
      className={`chat-detail__generated-image-tool${
        active ? ' chat-detail__generated-image-tool--active' : ''
      }`}
    >
      <div className="chat-detail__generated-image-heading">
        <span className="chat-detail__tool-icon">
          {active ? (
            <ToolStatusIcon activity="other" active icon={tools[0]?.icon} />
          ) : (
            <ImageIcon aria-hidden="true" />
          )}
        </span>
        <span className="chat-detail__tool-label">{label}</span>
      </div>
      <div className="chat-detail__generated-image-gallery">
        {images.map((image) => (
          <GeneratedImageThumbnail
            path={image.path}
            initialDataUrl={image.dataUrl}
            name={image.name ?? undefined}
            key={image.path || image.dataUrl}
          />
        ))}
      </div>
    </div>
  )
}

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

const getNaturalStreamBoundary = (content: string, afterIndex: number): number | null => {
  let fence: MarkdownFence | null = null
  let offset = 0
  let boundary: number | null = null

  for (const part of content.match(/[^\n]*(?:\n|$)/g) ?? []) {
    if (!part) continue

    const line = part.endsWith('\n') ? part.slice(0, -1) : part
    const partEnd = offset + part.length

    if (fence) {
      if (isMarkdownFenceClose(line, fence)) {
        fence = null
        if (partEnd > afterIndex) boundary = partEnd
      }
      offset = partEnd
      continue
    }

    const nextFence = getMarkdownFence(line)
    if (nextFence) {
      fence = nextFence
      offset = partEnd
      continue
    }

    const sentenceBoundaryPattern = /[.!?](?:["')\]]*)(?=\s|$)/g
    for (const match of line.matchAll(sentenceBoundaryPattern)) {
      const matchEnd = offset + (match.index ?? 0) + match[0].length
      if (matchEnd > afterIndex) boundary = matchEnd
    }

    if (part.endsWith('\n') && partEnd > afterIndex) boundary = partEnd
    offset = partEnd
  }

  return boundary
}

type StreamRenderState = {
  animate: boolean
  content: string
  revision: number
}

const useStreamRenderedContent = (
  content: string,
  streaming: boolean
): StreamRenderState & { visibleContent: string } => {
  const [renderState, setRenderState] = useState<StreamRenderState>(() => ({
    animate: false,
    content,
    revision: 0
  }))
  const latestContentRef = useRef(content)
  const renderedContentRef = useRef(content)
  const flushTimerRef = useRef<number | null>(null)
  const scheduleFlushRef = useRef<() => void>(() => {})

  const clearFlushTimer = useCallback((): void => {
    if (flushTimerRef.current === null) return
    window.clearTimeout(flushTimerRef.current)
    flushTimerRef.current = null
  }, [])

  const flushContent = useCallback((nextContent: string, animate: boolean): void => {
    renderedContentRef.current = nextContent
    startTransition(() => {
      setRenderState((currentState) =>
        currentState.content === nextContent
          ? currentState
          : {
              animate,
              content: nextContent,
              revision: currentState.revision + 1
            }
      )
    })
  }, [])

  const scheduleFlush = useCallback((): void => {
    if (flushTimerRef.current !== null) return

    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null
      const latestContent = latestContentRef.current
      const renderedLength = renderedContentRef.current.length
      if (latestContent.length <= renderedLength) return

      const boundary = getNaturalStreamBoundary(latestContent, renderedLength)
      const nextLength = boundary ?? latestContent.length
      flushContent(latestContent.slice(0, nextLength), boundary !== null)

      if (nextLength < latestContent.length) scheduleFlushRef.current()
    }, streamRenderMaxDelayMs)
  }, [flushContent])

  useEffect(() => {
    scheduleFlushRef.current = scheduleFlush
  }, [scheduleFlush])

  useEffect(() => {
    latestContentRef.current = content

    if (!streaming) {
      clearFlushTimer()
      const previousContent = renderedContentRef.current
      flushContent(
        content,
        content.startsWith(previousContent) && content.length > previousContent.length
      )
      return
    }

    const renderedContent = renderedContentRef.current
    if (!content.startsWith(renderedContent)) {
      clearFlushTimer()
      flushContent(content, false)
      return
    }
    if (content.length === renderedContent.length) return

    const boundary = getNaturalStreamBoundary(content, renderedContent.length)
    if (boundary !== null) {
      clearFlushTimer()
      flushContent(content.slice(0, boundary), true)
    }

    if (renderedContentRef.current.length < content.length) scheduleFlush()
  }, [clearFlushTimer, content, flushContent, scheduleFlush, streaming])

  useEffect(
    () => () => {
      clearFlushTimer()
    },
    [clearFlushTimer]
  )

  return {
    ...renderState,
    visibleContent: streaming ? renderState.content : content
  }
}

const ToolItem: React.FC<{
  item: ProviderToolItem
  activeToolIds: Set<string>
  expanded?: boolean
  onLoad?: () => Promise<void> | void
  onDisclosureToggle?: () => void
  projectCwd?: string | null
}> = ({ item, activeToolIds, expanded = false, onLoad, onDisclosureToggle, projectCwd }) => {
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('idle')
  const tools = getToolsFromToolItem(item)
  const activity = tools[0]?.activity ?? 'other'
  const active = tools.some((tool) => activeToolIds.has(tool.id))
  const baseLabel = item.label || tools[0]?.toolId || 'Tool use'
  const rawLabel =
    item.type === 'toolGroup' && (item.toolCount ?? item.tools.length) > item.tools.length
      ? `${baseLabel} · showing ${item.tools.length} of ${item.toolCount}`
      : baseLabel
  const label = getToolDisplayLabel(rawLabel, activity, active)

  if (!isWorkingItemPayloadLoaded(item)) {
    const handleLoad = async (): Promise<void> => {
      if (!onLoad || loadState === 'loading') return
      setLoadState('loading')
      try {
        await onLoad()
        setLoadState('idle')
      } catch {
        setLoadState('error')
      }
    }

    return (
      <div className="chat-detail__tool-read">
        <button
          className="chat-detail__working-load"
          type="button"
          disabled={!onLoad || loadState === 'loading'}
          onClick={handleLoad}
        >
          <span className="chat-detail__tool-icon">
            <ToolStatusIcon activity={activity} active={active} icon={tools[0]?.icon} />
          </span>
          <span className="chat-detail__tool-label">
            {loadState === 'error' ? `Retry loading ${label}` : label}
          </span>
          {loadState === 'loading' ? (
            <LoaderCircle
              className="app-loading-spinner chat-detail__working-spinner"
              aria-hidden="true"
            />
          ) : (
            <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
          )}
        </button>
      </div>
    )
  }

  if (tools.some((tool) => tool.images.length > 0)) {
    return <GeneratedImageTool active={active} label={label} tools={tools} />
  }

  if (tools.every((tool) => tool.compact) || activity === 'read' || !tools.some(hasToolDetails)) {
    return (
      <div className={`chat-detail__tool-read${active ? ' chat-detail__tool-read--active' : ''}`}>
        <span className="chat-detail__tool-icon">
          <ToolStatusIcon activity={activity} active={active} icon={tools[0]?.icon} />
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
      onDisclosureToggle={onDisclosureToggle}
      projectCwd={projectCwd}
    />
  )
}

const MarkdownMessageComponent: React.FC<{
  className: string
  content: string
  localImageContainer?: AppContainerTarget | null
  localImageCwd?: string | null
  onOpenFileLink?: (path: string, displayPath: string, line?: number, endLine?: number) => void
  preserveLineBreaks?: boolean
  selectionQuoteHost?: boolean
  streaming?: boolean
}> = ({
  className,
  content,
  localImageContainer,
  localImageCwd,
  onOpenFileLink,
  preserveLineBreaks = false,
  selectionQuoteHost = false,
  streaming = false
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [localImagePreview, setLocalImagePreview] = useState<{
    imageUrl: string
    name: string
    path: string
  } | null>(null)
  const [expandedTableHtml, setExpandedTableHtml] = useState<string | null>(null)
  const { visibleContent } = useStreamRenderedContent(content, streaming)
  const markdownRenderer = useMemo(
    () => createChatMarkdownRenderer(Boolean(onOpenFileLink)),
    [onOpenFileLink]
  )
  const renderedMarkdown = useMemo(
    () =>
      DOMPurify.sanitize(
        marked.parse(
          preserveLineBreaks ? withPromptMarkdownLineBreaks(visibleContent) : visibleContent,
          {
            async: false,
            gfm: true,
            renderer: markdownRenderer
          }
        ),
        { ADD_ATTR: ['target'] }
      ),
    [markdownRenderer, preserveLineBreaks, visibleContent]
  )
  useEffect(() => {
    const markdownContainer = containerRef.current
    if (!markdownContainer) return undefined

    let current = true
    const objectUrls: string[] = []
    const imageButtons = markdownContainer.querySelectorAll<HTMLButtonElement>(
      '.chat-detail__markdown-image[data-local-image-path]'
    )
    const faviconImages = markdownContainer.querySelectorAll<HTMLImageElement>(
      '.chat-detail__link-favicon'
    )

    const handleFaviconError = (event: Event): void => {
      if (event.currentTarget instanceof HTMLImageElement) event.currentTarget.hidden = true
    }
    faviconImages.forEach((image) => image.addEventListener('error', handleFaviconError))

    imageButtons.forEach((button) => {
      const path = button.dataset.localImagePath
      const name = button.dataset.localImageName ?? 'Image'
      if (!path) return

      void appApi
        .getLocalImage({
          container: localImageContainer,
          cwd: localImageCwd,
          path,
          relativeTo: 'cwd'
        })
        .then((image) => {
          if (!current || !markdownContainer.contains(button)) return

          const objectUrl = createLocalImageUrl(image)
          objectUrls.push(objectUrl)
          const imageElement = document.createElement('img')
          imageElement.src = objectUrl
          imageElement.alt = name
          button.replaceChildren(imageElement)
        })
        .catch(() => {
          if (!current || !markdownContainer.contains(button)) return

          const error = document.createElement('span')
          error.className = 'chat-detail__markdown-image-error'
          error.innerHTML = brokenImageIconMarkup
          button.replaceChildren(error)
          button.setAttribute('aria-disabled', 'true')
          button.setAttribute('aria-label', `${name} unavailable`)
          button.title = `${path} unavailable`
        })
    })

    return () => {
      current = false
      faviconImages.forEach((image) => image.removeEventListener('error', handleFaviconError))
      objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl))
    }
  }, [localImageContainer, localImageCwd, renderedMarkdown])
  useEffect(() => {
    if (streaming) return undefined

    const markdownContainer = containerRef.current
    if (!markdownContainer) return undefined
    hydrateMermaidDiagrams(markdownContainer)
    return undefined
  })
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      if (!(event.target instanceof Element)) return

      const tableExpandButton = event.target.closest<HTMLButtonElement>(
        '.chat-detail__table-expand'
      )
      if (tableExpandButton && containerRef.current?.contains(tableExpandButton)) {
        const table = tableExpandButton
          .closest('.chat-detail__table-frame')
          ?.querySelector<HTMLTableElement>('.chat-detail__table')
        if (table) {
          event.preventDefault()
          setExpandedTableHtml(table.outerHTML)
        }
        return
      }

      const imageButton = event.target.closest<HTMLButtonElement>(
        '.chat-detail__markdown-image[data-local-image-path]'
      )
      if (imageButton && containerRef.current?.contains(imageButton)) {
        const path = imageButton.dataset.localImagePath
        const name = imageButton.dataset.localImageName ?? 'Image'
        const imageUrl = imageButton.querySelector('img')?.src
        if (path && imageUrl) {
          event.preventDefault()
          setLocalImagePreview({ imageUrl, name, path })
        }
        return
      }

      if (!onOpenFileLink) return

      const fileLink = event.target.closest<HTMLButtonElement>(
        '.chat-detail__file-link[data-file-link-path]'
      )
      if (!fileLink || !containerRef.current?.contains(fileLink)) return

      const path = fileLink.dataset.fileLinkPath
      const displayPath = fileLink.dataset.fileLinkDisplayPath
      if (!path || !displayPath) return

      const parsedLine = fileLink.dataset.fileLinkLine
        ? Number.parseInt(fileLink.dataset.fileLinkLine, 10)
        : undefined
      const line =
        parsedLine && Number.isSafeInteger(parsedLine) && parsedLine > 0 ? parsedLine : undefined

      event.preventDefault()
      onOpenFileLink(path, displayPath, line)
    },
    [onOpenFileLink]
  )

  const localImageOptions: Omit<AppLocalImageOptions, 'path'> = {
    container: localImageContainer,
    cwd: localImageCwd,
    relativeTo: 'cwd'
  }

  return (
    <>
      <div className={className} ref={containerRef} onClick={handleClick}>
        <div
          className="chat-detail__message-markdown"
          dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
        />
        {selectionQuoteHost && <div className="chat-detail__message-quote-host" />}
      </div>
      {localImagePreview && (
        <ImageLightbox
          imageUrl={localImagePreview.imageUrl}
          localImageOptions={localImageOptions}
          name={localImagePreview.name}
          path={localImagePreview.path}
          onClose={() => setLocalImagePreview(null)}
        />
      )}
      {expandedTableHtml && (
        <TableLightbox tableHtml={expandedTableHtml} onClose={() => setExpandedTableHtml(null)} />
      )}
    </>
  )
}

export const MarkdownMessage = memo(MarkdownMessageComponent)

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
  timestamp: number | null | undefined
  markerSide: 'left' | 'right'
  modelLabel?: string | null
}> = ({ timestamp, markerSide, modelLabel }) => {
  const now = useSemanticDateNow()
  const timestampLabel = formatSemanticLexicalDateDifference(timestamp, { now })

  if (!timestampLabel) {
    return <span className="chat-detail__message-date chat-detail__message-date--empty" />
  }

  const title = modelLabel ? `${timestampLabel.title} · ${modelLabel}` : timestampLabel.title

  return (
    <time className="chat-detail__message-date" dateTime={timestampLabel.dateTime} title={title}>
      {markerSide === 'left' && (
        <span className="chat-detail__message-date-marker" aria-hidden="true">
          ·
        </span>
      )}
      <span>{timestampLabel.label}</span>
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

const getSequenceLabel = (activities: ProviderToolActivity[]): string => {
  const labels = [...new Set(activities.map((activity) => activityLabels[activity]))]
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
  onLoadItem?: (itemId: string) => Promise<void> | void
  onLoadPage?: (workingItemId: string, startIndex: number) => Promise<void> | void
  onDisclosureToggle?: () => void
  projectCwd?: string | null
}> = ({ items, activeToolIds, onLoadItem, onLoadPage, onDisclosureToggle, projectCwd }) => {
  const [open, setOpen] = useState(false)
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('idle')
  const sequenceItem = items.length === 1 && items[0]?.type === 'toolGroup' ? items[0] : null
  const tools = items.flatMap(getToolsFromToolItem)
  const activeTools = tools.filter((tool) => activeToolIds.has(tool.id))
  const active = activeTools.length > 0
  const dominantActivity = active
    ? getDominantActivity(activeTools)
    : (sequenceItem?.dominantActivity ?? getDominantActivity(tools))
  const sequenceActivities = sequenceItem?.toolActivities?.length
    ? sequenceItem.toolActivities
    : tools.map((tool) => tool.activity)
  const baseLabel = active
    ? activeActivityLabels[dominantActivity]
    : getSequenceLabel(sequenceActivities)
  const totalCount = Math.max(sequenceItem?.toolCount ?? 0, tools.length)
  const startIndex = sequenceItem?.toolsStartIndex ?? Math.max(0, totalCount - tools.length)
  const endIndex = Math.min(totalCount, startIndex + tools.length)
  const hiddenBefore = Math.max(0, startIndex)
  const hiddenAfter = Math.max(0, totalCount - endIndex)
  const label =
    totalCount > tools.length ? `${baseLabel} · ${tools.length}/${totalCount}` : baseLabel
  const loadPage = async (nextStartIndex: number): Promise<void> => {
    if (!sequenceItem || !onLoadPage || loadState === 'loading') return
    setLoadState('loading')
    try {
      await onLoadPage(sequenceItem.id, nextStartIndex)
      setLoadState('idle')
    } catch {
      setLoadState('error')
    }
  }

  return (
    <details
      className={`chat-detail__tool-sequence${active ? ' chat-detail__tool-sequence--active' : ''}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary onClick={onDisclosureToggle}>
        <span className="chat-detail__tool-icon">
          <ToolStatusIcon activity={dominantActivity} active={active} />
        </span>
        <span className="chat-detail__tool-label">{label}</span>
        <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
      </summary>
      {open && (
        <div className="chat-detail__tool-sequence-content">
          {hiddenBefore > 0 && (
            <button
              className="chat-detail__working-load chat-detail__working-gap"
              type="button"
              disabled={!onLoadPage || loadState === 'loading'}
              onClick={() => void loadPage(Math.max(0, startIndex - workingToolPageSize))}
            >
              Load {Math.min(workingToolPageSize, hiddenBefore)} previous · {hiddenBefore} hidden
            </button>
          )}
          {tools.map((item) => (
            <ToolItem
              item={item}
              activeToolIds={activeToolIds}
              key={item.id}
              onLoad={onLoadItem ? () => onLoadItem(item.id) : undefined}
              onDisclosureToggle={onDisclosureToggle}
              projectCwd={projectCwd}
            />
          ))}
          {hiddenAfter > 0 && (
            <button
              className="chat-detail__working-load chat-detail__working-gap"
              type="button"
              disabled={!onLoadPage || loadState === 'loading'}
              onClick={() => void loadPage(endIndex)}
            >
              Load {Math.min(workingToolPageSize, hiddenAfter)} newer · {hiddenAfter} hidden
            </button>
          )}
          {loadState === 'error' && (
            <span className="chat-detail__working-load-error">
              Unable to load this activity page. Select it to retry.
            </span>
          )}
        </div>
      )}
    </details>
  )
}

const RandomWorkingPlaceholder: React.FC = () => {
  const [placeholder] = useState(getRandomPlaceholderOption)

  return (
    <div className="chat-detail__tool-read chat-detail__tool-read--active chat-detail__tool-placeholder">
      <span className="chat-detail__tool-icon">
        <ActiveAnimatedIcon Icon={AnimatedAudioLinesIcon} active />
      </span>
      <span className="chat-detail__tool-label">{placeholder}</span>
    </div>
  )
}

const WorkingPlaceholder: React.FC<{ id: string }> = ({ id }) => (
  <RandomWorkingPlaceholder key={id} />
)

type PlaceholderState = {
  signature: string
  visible: boolean
}

const getToolSignature = (tool: ProviderWorkingTool): string =>
  [
    tool.id,
    tool.icon,
    tool.label,
    tool.status,
    tool.command?.length ?? 0,
    tool.stdout?.length ?? 0,
    tool.diffs.map((diff) => `${diff.path}:${diff.diff.length}`).join(','),
    tool.backgroundSessionId,
    tool.finishedBackgroundSessionId,
    tool.images
      .map((image) => `${image.path ?? ''}:${image.dataUrl?.length ?? 0}:${image.name ?? ''}`)
      .join(',')
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
      if (
        tool.status === 'running' &&
        (longRunningActivities.has(tool.activity) || tool.icon === 'subagent')
      ) {
        activeToolIds.add(tool.id)
      }
    }
  }

  const lastItem = item.items.at(-1)
  if (lastItem && lastItem.type !== 'message') {
    for (const tool of getToolsFromToolItem(lastItem)) {
      if (tool.status === 'running') activeToolIds.add(tool.id)
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

export const ChatWorkingPlaceholder: React.FC<{ item: ProviderWorkingStep }> = ({ item }) => {
  const signature = useMemo(
    () => `${item.status}:${item.items.map(getWorkingItemSignature).join('|')}`,
    [item.items, item.status]
  )
  const activeToolIds = useMemo(() => getActiveToolIds(item), [item])
  const showPlaceholder = useSilencePlaceholder(
    signature,
    item.status === 'working' && activeToolIds.size === 0,
    item.items.length === 0
  )

  return showPlaceholder ? <WorkingPlaceholder id={`${item.id}:${item.items.length}`} /> : null
}

const groupWorkingItems = (items: ProviderWorkingItem[]): WorkingBlock[] => {
  const blocks: WorkingBlock[] = []

  for (const item of items) {
    if (item.type === 'message') {
      blocks.push({ type: 'message', item })
      continue
    }

    if (item.type === 'tool' && item.compact) {
      blocks.push({ type: 'tools', items: [item] })
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

const partitionGeneratedImageItems = (
  items: ProviderWorkingItem[]
): { generatedImages: ProviderToolItem[]; remaining: ProviderWorkingItem[] } => {
  const generatedImages: ProviderToolItem[] = []
  const remaining: ProviderWorkingItem[] = []
  const isGeneratedImageTool = (tool: ProviderWorkingTool): boolean =>
    tool.icon === 'image-generation' && tool.images.length > 0

  for (const item of items) {
    if (item.type === 'message') {
      remaining.push(item)
      continue
    }

    if (item.type === 'tool') {
      if (isGeneratedImageTool(item)) generatedImages.push(item)
      else remaining.push(item)
      continue
    }

    // A grouped sequence owns its child paging. Keep it intact so the loaded child indexes and
    // counts remain stable; generated images inside it are rendered lazily with the other tools.
    remaining.push(item)
  }

  return { generatedImages, remaining }
}

const WorkingStep: React.FC<{
  activityContent?: ReactNode
  availableRateLimitResets?: number
  container?: AppContainerTarget | null
  continueDisabled?: boolean
  continuedStoppedTurn?: boolean
  followingWorkingStepHasNext?: boolean
  followingWorkingStepStatus?: ProviderWorkingStep['status']
  hasNextWorkingStep?: boolean
  item: ProviderWorkingStep
  cwd?: string | null
  onContinue?: () => Promise<void> | void
  onLoad?: (startIndex?: number) => Promise<void> | void
  onLoadItem?: (itemId: string) => Promise<void> | void
  onLoadToolPage?: (workingItemId: string, startIndex: number) => Promise<void> | void
  onDisclosureToggle?: () => void
  onOpenFileLink?: (path: string, displayPath: string, line?: number, endLine?: number) => void
  onRetry?: () => Promise<void> | void
  onUsageRefresh?: () => Promise<void> | void
  onUsageReset?: () => Promise<ProviderAccountRateLimitResetOutcome>
  projectCwd?: string | null
  progressPolicy?: WorkingStepProgressPolicy
  progressSettings: AppChatProgressSettings
  rateLimitResetDisabled?: boolean
  retryDisabled?: boolean
}> = ({
  activityContent,
  availableRateLimitResets = 0,
  container,
  continueDisabled = false,
  continuedStoppedTurn = false,
  followingWorkingStepHasNext = false,
  followingWorkingStepStatus,
  hasNextWorkingStep = false,
  item,
  cwd,
  onContinue,
  onLoad,
  onLoadItem,
  onLoadToolPage,
  onDisclosureToggle,
  onOpenFileLink,
  onRetry,
  onUsageRefresh,
  onUsageReset,
  projectCwd,
  progressPolicy = 'regular',
  progressSettings,
  rateLimitResetDisabled = false,
  retryDisabled = false
}) => {
  const [continueClicked, setContinueClicked] = useState(false)
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [openAfterLoad, setOpenAfterLoad] = useState(false)
  const [rateLimitResetMessage, setRateLimitResetMessage] = useState<string | null>(null)
  const unloaded = item.itemsLoaded === false
  const linkedToFollowingStep = continuedStoppedTurn || continueClicked
  const itemSegments = getWorkingStepItemSegments(item, workingItemPageSize)
  const renderedSegments = itemSegments.map((segment) => {
    const { generatedImages, remaining } = partitionGeneratedImageItems(segment.items)
    return {
      ...segment,
      blocks: groupWorkingItems(remaining),
      generatedImages
    }
  })
  const generatedImages = renderedSegments.flatMap((segment) => segment.generatedImages)
  const blockCount = renderedSegments.reduce((count, segment) => count + segment.blocks.length, 0)
  const lastWorkingItem = item.items.at(-1)
  const activeToolIds = useMemo(() => getActiveToolIds(item), [item])
  const active = item.status === 'working'
  const itemCount = Math.max(item.itemCount ?? item.items.length, item.items.length)
  const hasHiddenItems =
    renderedSegments.some((segment, segmentIndex) => {
      const previousSegment = renderedSegments[segmentIndex - 1]
      const previousEndIndex = previousSegment
        ? previousSegment.startIndex + previousSegment.items.length
        : 0
      return segment.startIndex > previousEndIndex
    }) ||
    (renderedSegments.at(-1)?.startIndex ?? 0) + (renderedSegments.at(-1)?.items.length ?? 0) <
      itemCount
  const preserveOpenDuringContinuedWork =
    continueClicked && followingWorkingStepStatus === 'working' && !followingWorkingStepHasNext
  const collapseWithFollowingStep =
    linkedToFollowingStep && followingWorkingStepStatus != null && !preserveOpenDuringContinuedWork
  const autoCollapseStatus = collapseWithFollowingStep ? followingWorkingStepStatus : item.status
  const autoCollapseHasNextWorkingStep = collapseWithFollowingStep
    ? followingWorkingStepHasNext
    : linkedToFollowingStep
      ? false
      : hasNextWorkingStep
  const defaultOpen = getWorkingStepDefaultOpen(
    autoCollapseStatus,
    progressPolicy,
    progressSettings,
    autoCollapseHasNextWorkingStep
  )
  const disclosureKey = getWorkingStepDisclosureKey(
    autoCollapseStatus,
    progressPolicy,
    progressSettings,
    autoCollapseHasNextWorkingStep
  )
  const [openState, setOpenState] = useState({ key: disclosureKey, open: defaultOpen })
  const preferredOpen = resolveWorkingStepOpen(openState, disclosureKey, defaultOpen)
  const open = openAfterLoad ? true : preferredOpen
  const label =
    item.status === 'queued'
      ? 'Queued'
      : item.status === 'stopped'
        ? 'Stopped'
        : item.status === 'failed'
          ? 'Failed'
          : item.status === 'worked'
            ? 'Worked'
            : 'Working'
  const heading = (
    <span className="chat-detail__working-label">
      {active && (
        <LoaderCircle
          className="app-loading-spinner chat-detail__working-spinner"
          aria-hidden="true"
        />
      )}
      <span>{label}</span>
    </span>
  )
  const renderedGeneratedImages = generatedImages.map((imageItem) => (
    <ToolItem
      item={imageItem}
      activeToolIds={activeToolIds}
      key={imageItem.id}
      projectCwd={projectCwd}
    />
  ))
  const rateLimitResetActions =
    item.status === 'failed' &&
    item.failureReason === 'rateLimit' &&
    availableRateLimitResets > 0 &&
    onUsageReset &&
    onRetry
      ? { onReset: onUsageReset, onRetry }
      : null
  const hasStoppedOrFailed = item.status === 'stopped' || item.status === 'failed'
  const turnActions =
    !linkedToFollowingStep &&
    ((hasStoppedOrFailed && (onRetry || onContinue)) || rateLimitResetActions) ? (
      <div className="chat-detail__working-actions">
        {hasStoppedOrFailed && onRetry && (
          <Button
            theme="secondary"
            size="small"
            aria-label={`Retry ${item.status} turn`}
            title="Retry"
            disabled={retryDisabled}
            callback={onRetry}
            icon={<RefreshCw aria-hidden="true" />}
            label={<span>Retry</span>}
          />
        )}
        {hasStoppedOrFailed && onContinue && (
          <Button
            theme="secondary"
            size="small"
            aria-label={`Continue ${item.status} turn`}
            title="Continue"
            disabled={continueDisabled}
            callback={() => {
              setContinueClicked(true)
              return onContinue()
            }}
            icon={<Play aria-hidden="true" />}
            label={<span>Continue</span>}
          />
        )}
        {rateLimitResetActions && (
          <RateLimitResetButton
            availableCount={availableRateLimitResets}
            disabled={retryDisabled || rateLimitResetDisabled}
            onReset={rateLimitResetActions.onReset}
            onResetError={setRateLimitResetMessage}
            onResetResult={async (outcome) => {
              setRateLimitResetMessage(getRateLimitResetMessage(outcome))
              await onUsageRefresh?.()
              if (outcome === 'reset') await rateLimitResetActions.onRetry()
            }}
            onResetStart={() => setRateLimitResetMessage(null)}
          />
        )}
        {rateLimitResetMessage && (
          <span className="chat-detail__working-action-status" role="status">
            {rateLimitResetMessage}
          </span>
        )}
      </div>
    ) : null

  const loadPage = async (startIndex: number): Promise<void> => {
    if (!onLoad || loadState === 'loading') return
    setLoadState('loading')
    try {
      await onLoad(startIndex)
      setLoadState('idle')
    } catch {
      setLoadState('error')
    }
  }

  const staticWorkingStep = (
    <>
      <div
        className={`chat-detail__step chat-detail__working chat-detail__working--${item.status}`}
      >
        <div className="chat-detail__working-heading">{heading}</div>
      </div>
      {turnActions}
      {renderedGeneratedImages}
    </>
  )

  if (unloaded && itemCount === 0) return staticWorkingStep

  if (unloaded) {
    const handleLoad = async (): Promise<void> => {
      if (loadState === 'loading') return

      onDisclosureToggle?.()
      setOpenAfterLoad(true)
      await loadPage(Math.max(0, itemCount - workingItemPageSize))
    }

    return (
      <>
        <div
          className={`chat-detail__step chat-detail__working chat-detail__working--${item.status}`}
        >
          <button
            className="chat-detail__working-load"
            type="button"
            aria-label={
              loadState === 'error' ? `Retry loading ${label} section` : `Load ${label} section`
            }
            disabled={!onLoad || loadState === 'loading'}
            onClick={handleLoad}
          >
            {heading}
            {loadState === 'loading' ? (
              <LoaderCircle
                className="app-loading-spinner chat-detail__working-spinner"
                aria-hidden="true"
              />
            ) : (
              <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
            )}
          </button>
          {loadState === 'error' && (
            <span className="chat-detail__working-load-error" role="status">
              Unable to load. Select the section to retry.
            </span>
          )}
        </div>
        {turnActions}
      </>
    )
  }

  if (blockCount === 0 && !hasHiddenItems && activityContent == null) {
    if (active || (item.status !== 'stopped' && renderedGeneratedImages.length > 0)) {
      return (
        <>
          {turnActions}
          {renderedGeneratedImages}
        </>
      )
    }

    return staticWorkingStep
  }

  return (
    <>
      <details
        className={`chat-detail__step chat-detail__working chat-detail__working--${item.status}`}
        open={open}
        onToggle={(event) => {
          const nextOpen = event.currentTarget.open
          if (openAfterLoad) {
            setOpenAfterLoad(false)
            setOpenState({ key: disclosureKey, open: nextOpen })
            return
          }
          if (nextOpen !== open) setOpenState({ key: disclosureKey, open: nextOpen })
        }}
      >
        <summary onClick={onDisclosureToggle}>
          {heading}
          <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
        </summary>
        {open && (
          <div className="chat-detail__step-content">
            {renderedSegments.map((segment, segmentIndex) => {
              const previousSegment = renderedSegments[segmentIndex - 1]
              const previousEndIndex = previousSegment
                ? previousSegment.startIndex + previousSegment.items.length
                : 0
              const hiddenItemCount = Math.max(0, segment.startIndex - previousEndIndex)
              const loadStartIndex = previousSegment
                ? previousEndIndex
                : Math.max(0, segment.startIndex - workingItemPageSize)
              const pageItemCount = Math.min(workingItemPageSize, hiddenItemCount)

              return (
                <Fragment key={`${segment.kind}:${segment.startIndex}`}>
                  {hiddenItemCount > 0 && (
                    <button
                      className="chat-detail__working-load chat-detail__working-gap"
                      type="button"
                      disabled={!onLoad || loadState === 'loading'}
                      onClick={() => void loadPage(loadStartIndex)}
                    >
                      Load {pageItemCount} more · {hiddenItemCount} hidden
                    </button>
                  )}
                  {segment.blocks.map((block) => {
                    return block.type === 'tools' ? (
                      block.items.length > 1 ||
                      block.items.some(
                        (toolItem) =>
                          toolItem.type === 'toolGroup' &&
                          Math.max(toolItem.toolCount ?? 0, toolItem.tools.length) > 1
                      ) ? (
                        <ToolSequence
                          items={block.items}
                          activeToolIds={activeToolIds}
                          key={block.items[0]?.id}
                          onLoadItem={onLoadItem}
                          onLoadPage={onLoadToolPage}
                          onDisclosureToggle={onDisclosureToggle}
                          projectCwd={projectCwd}
                        />
                      ) : (
                        block.items.map((toolItem) => (
                          <ToolItem
                            item={toolItem}
                            activeToolIds={activeToolIds}
                            expanded={active && toolItem === lastWorkingItem}
                            key={toolItem.id}
                            onLoad={onLoadItem ? () => onLoadItem(toolItem.id) : undefined}
                            onDisclosureToggle={onDisclosureToggle}
                            projectCwd={projectCwd}
                          />
                        ))
                      )
                    ) : !isWorkingItemPayloadLoaded(block.item) ? (
                      <button
                        className="chat-detail__working-load"
                        type="button"
                        key={block.item.id}
                        disabled={!onLoadItem}
                        onClick={() =>
                          void Promise.resolve(onLoadItem?.(block.item.id)).catch(() => {})
                        }
                      >
                        Load reasoning
                      </button>
                    ) : (
                      <MarkdownMessage
                        className="chat-detail__working-message"
                        content={block.item.content}
                        key={block.item.id}
                        localImageContainer={container}
                        localImageCwd={cwd}
                        onOpenFileLink={onOpenFileLink}
                        streaming={active && block.item === lastWorkingItem}
                      />
                    )
                  })}
                </Fragment>
              )
            })}
            {(() => {
              const finalSegment = renderedSegments.at(-1)
              const finalEndIndex = finalSegment
                ? finalSegment.startIndex + finalSegment.items.length
                : 0
              const hiddenItemCount = Math.max(0, itemCount - finalEndIndex)
              if (hiddenItemCount === 0) return null

              return (
                <button
                  className="chat-detail__working-load chat-detail__working-gap"
                  type="button"
                  disabled={!onLoad || loadState === 'loading'}
                  onClick={() => void loadPage(finalEndIndex)}
                >
                  Load {Math.min(workingItemPageSize, hiddenItemCount)} more · {hiddenItemCount}{' '}
                  hidden
                </button>
              )
            })()}
            {loadState === 'error' && (
              <span className="chat-detail__working-load-error">
                Unable to load this activity page. Select it to retry.
              </span>
            )}
            {activityContent}
          </div>
        )}
      </details>
      {turnActions}
      {renderedGeneratedImages}
    </>
  )
}

const getPendingMessageLabel = (message: ProviderPendingMessage): string =>
  message.kind === 'steering' ? 'Steering with' : 'Queue'

const getPendingMessageActionLabel = (message: ProviderPendingMessage): string =>
  message.kind === 'steering' ? 'steering' : 'queued'

const ChatDetailItemComponent: React.FC<ChatDetailItemProps> = ({
  availableRateLimitResets = 0,
  canEditOwnMessages = false,
  container,
  continuePrompt = '',
  continueStoppedTurnDisabled = false,
  continuedStoppedTurn = false,
  followingWorkingStepHasNext = false,
  followingWorkingStepStatus,
  hasNextWorkingStep = false,
  item,
  messagePinned = false,
  modelLabelsById,
  onDeletePendingMessage,
  onEditPendingMessage,
  onSteerPendingMessage,
  onInterruptPendingMessage,
  onEditMessage,
  onForkMessage,
  onLoadWorkingStep,
  onLoadWorkingItem,
  onLoadWorkingToolPage,
  onDisclosureToggle,
  onOpenFileLink,
  onToggleMessagePinned,
  onContinueStoppedTurn,
  onRetryStoppedTurn,
  onUsageRefresh,
  onUsageReset,
  previousItem,
  cwd,
  projectCwd,
  progressPolicy = 'regular',
  progressSettings,
  rateLimitResetDisabled = false,
  retryMessage,
  retryStoppedTurnDisabled = false,
  selectedModelId,
  streaming = false,
  turnIndex = -1,
  workingStepContent
}) => {
  const [copied, setCopied] = useState(false)
  const resolvedProgressSettings = getProgressSettings(progressSettings)

  useEffect(() => {
    if (!copied) return undefined

    const timeout = window.setTimeout(() => setCopied(false), 1_200)
    return () => window.clearTimeout(timeout)
  }, [copied])

  if (item.type === 'timelineAnchor') return null

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
    const messageLabel =
      pending && item.kind === 'queued' && isQueuedPendingMessage(previousItem)
        ? null
        : pending
          ? getPendingMessageLabel(item)
          : (item.label ?? null)
    const pendingActionLabel = pending ? getPendingMessageActionLabel(item) : 'pending'
    const canEdit =
      !pending &&
      role === 'user' &&
      item.editTargetId !== null &&
      canEditOwnMessages &&
      Boolean(onEditMessage)
    const canEditPending = pending && Boolean(onEditPendingMessage)
    const canDelete = pending && Boolean(onDeletePendingMessage)
    const canSteer = pending && item.kind === 'queued' && Boolean(onSteerPendingMessage)
    const canInterrupt = pending && Boolean(onInterruptPendingMessage)
    const canPinMessage =
      !pending &&
      Boolean(item.content.trim()) &&
      Boolean(onToggleMessagePinned) &&
      turnIndex >= 0 &&
      (role === 'user' || !streaming)
    const canForkMessage = !pending && role === 'assistant' && !streaming && Boolean(onForkMessage)
    const timestamp = item.createdAt
    const modelLabel = pending ? null : getMessageModelLabel(item, selectedModelId, modelLabelsById)
    const attachments = item.attachments ?? []
    const messagePresentation =
      role === 'user'
        ? getChatMessagePresentation(item.content)
        : { content: item.content, resources: [] }
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
        {canSteer && pending && (
          <Button
            theme="secondary"
            size="small"
            aria-label="Steer with queued message"
            title="Steer with queued message"
            callback={() => onSteerPendingMessage?.(item)}
            icon={<CornerDownRight aria-hidden="true" />}
          />
        )}
        {canInterrupt && pending && (
          <Button
            theme="secondary"
            size="small"
            aria-label={`Send ${pendingActionLabel} message now`}
            title={`Send ${pendingActionLabel} message now`}
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
        {!canEdit &&
        !canEditPending &&
        !canSteer &&
        !canInterrupt &&
        !canDelete &&
        role === 'user' ? (
          <span className="chat-detail__message-action-placeholder" aria-hidden="true" />
        ) : null}
        {canForkMessage && !pending && (
          <Button
            theme="secondary"
            size="small"
            aria-label="Fork chat from message"
            title="Fork"
            callback={() => onForkMessage?.(item)}
            icon={<GitFork aria-hidden="true" />}
          />
        )}
        {canPinMessage && !pending && (
          <Button
            theme="secondary"
            size="small"
            aria-label={messagePinned ? 'Unpin message' : 'Pin message'}
            aria-pressed={messagePinned}
            title={messagePinned ? 'Unpin message' : 'Pin message'}
            callback={() => onToggleMessagePinned?.(item, turnIndex, messagePinned)}
            icon={messagePinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
          />
        )}
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
      <div className={messageBlockClassName} data-chat-message-id={!pending ? item.id : undefined}>
        {messageLabel && <span className="chat-detail__pending-message-label">{messageLabel}</span>}
        {(attachments.length > 0 || messagePresentation.resources.length > 0) && (
          <MessageAttachments
            attachments={attachments}
            onOpenFileLink={onOpenFileLink}
            projectCwd={projectCwd}
            resources={messagePresentation.resources}
          />
        )}
        {messagePresentation.content.trim() && (
          <MarkdownMessage
            className={`chat-detail__message chat-detail__message--${role}`}
            content={messagePresentation.content}
            localImageContainer={container}
            localImageCwd={cwd}
            onOpenFileLink={onOpenFileLink}
            preserveLineBreaks={role === 'user'}
            selectionQuoteHost={!pending && role === 'assistant'}
            streaming={!pending && role === 'assistant' && streaming}
          />
        )}
        {item.payloadTruncated && (
          <span className="chat-detail__payload-preview-note">
            Showing a bounded preview of this large message.
          </span>
        )}
        <div className="chat-detail__message-footer">
          {role === 'user' && messageDate}
          {messageActions}
          {role === 'assistant' && messageDate}
        </div>
      </div>
    )
  }

  return (
    <WorkingStep
      activityContent={workingStepContent}
      availableRateLimitResets={availableRateLimitResets}
      container={container}
      continueDisabled={continueStoppedTurnDisabled || !continuePrompt.trim()}
      continuedStoppedTurn={continuedStoppedTurn}
      followingWorkingStepHasNext={followingWorkingStepHasNext}
      followingWorkingStepStatus={followingWorkingStepStatus}
      hasNextWorkingStep={hasNextWorkingStep}
      item={item}
      cwd={cwd}
      onLoad={
        onLoadWorkingStep ? (startIndex) => onLoadWorkingStep(item.id, startIndex) : undefined
      }
      onLoadItem={
        onLoadWorkingItem ? (workingItemId) => onLoadWorkingItem(item.id, workingItemId) : undefined
      }
      onLoadToolPage={
        onLoadWorkingToolPage
          ? (workingItemId, startIndex) => onLoadWorkingToolPage(item.id, workingItemId, startIndex)
          : undefined
      }
      onDisclosureToggle={onDisclosureToggle}
      onContinue={
        onContinueStoppedTurn
          ? () => onContinueStoppedTurn(item.id, continuePrompt.trim())
          : undefined
      }
      onOpenFileLink={onOpenFileLink}
      onRetry={
        retryMessage && onRetryStoppedTurn ? () => onRetryStoppedTurn(retryMessage) : undefined
      }
      onUsageRefresh={onUsageRefresh}
      onUsageReset={onUsageReset}
      projectCwd={projectCwd}
      progressPolicy={progressPolicy}
      progressSettings={resolvedProgressSettings}
      rateLimitResetDisabled={rateLimitResetDisabled}
      retryDisabled={retryStoppedTurnDisabled}
    />
  )
}

export const ChatDetailItem = memo(ChatDetailItemComponent, areChatDetailItemPropsEqual)
