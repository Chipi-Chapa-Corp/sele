import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ForwardRefExoticComponent, HTMLAttributes, RefAttributes } from 'react'
import {
  AudioLinesIcon as AnimatedAudioLinesIcon,
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
  BookOpenText,
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
  Image as ImageIcon,
  ListChecks,
  LoaderCircle,
  Package,
  Pencil,
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
import { createLocalImageUrl } from '../localImage'
import { getMarkdownFileLinkLabel, getMarkdownFileTarget } from '../markdownFileLink'
import { formatSemanticLexicalDateDifference, useSemanticDateNow } from '../semanticDateDifference'
import { defaultAppChatThoughtSettings, type AppChatThoughtSettings } from '../settings'
import { Button } from './Button'
import { BoundedHighlightedCode } from './BoundedHighlightedCode'
import { HighlightedCode } from './HighlightedCode'
import { ImageLightbox } from './ImageLightbox'
import { ReviewCommentsButton } from './ReviewCommentsButton'
import { ToolDiff } from './ToolDiff'
import './ChatDetailItem.css'

type ChatDetailItemProps = {
  canEditOwnMessages?: boolean
  container?: AppContainerTarget | null
  continuePrompt?: string
  continueStoppedTurnDisabled?: boolean
  continuedStoppedTurn?: boolean
  followingWorkingStepHasNext?: boolean
  followingWorkingStepStatus?: ProviderWorkingStep['status']
  hasNextWorkingStep?: boolean
  item: ProviderChatItem
  modelLabelsById?: ReadonlyMap<ProviderModelId, string>
  onDeletePendingMessage?: (message: ProviderPendingMessage) => void
  onEditPendingMessage?: (message: ProviderPendingMessage) => void
  onSteerPendingMessage?: (message: ProviderPendingMessage) => void
  onInterruptPendingMessage?: (message: ProviderPendingMessage) => void
  onEditMessage?: (message: ProviderMessage) => void
  onLoadWorkingStep?: (workingStepId: string) => Promise<void> | void
  onOpenFileLink?: (path: string, displayPath: string, line?: number, endLine?: number) => void
  onContinueStoppedTurn?: (workingStepId: string, prompt: string) => Promise<void> | void
  onRetryStoppedTurn?: (message: ProviderMessage) => void
  previousItem?: ProviderChatItem | null
  cwd?: string | null
  projectCwd?: string | null
  retryMessage?: ProviderMessage | null
  retryStoppedTurnDisabled?: boolean
  selectedModelId?: ProviderModelId
  streaming?: boolean
  thoughtSettings?: AppChatThoughtSettings
}

const getThoughtSettings = (settings?: AppChatThoughtSettings): AppChatThoughtSettings =>
  settings ?? defaultAppChatThoughtSettings

const areThoughtSettingsEqual = (
  first?: AppChatThoughtSettings,
  second?: AppChatThoughtSettings
): boolean => {
  const normalizedFirst = getThoughtSettings(first)
  const normalizedSecond = getThoughtSettings(second)

  return (
    normalizedFirst.expandThoughtsOnStart === normalizedSecond.expandThoughtsOnStart &&
    normalizedFirst.collapseThoughtsOnFinish === normalizedSecond.collapseThoughtsOnFinish &&
    normalizedFirst.collapseThoughtsOnNextTurn === normalizedSecond.collapseThoughtsOnNextTurn &&
    normalizedFirst.expandStoppedTurns === normalizedSecond.expandStoppedTurns &&
    normalizedFirst.collapseStoppedOnNextTurn === normalizedSecond.collapseStoppedOnNextTurn
  )
}

const isQueuedPendingMessage = (item: ProviderChatItem | null | undefined): boolean =>
  item?.type === 'pendingMessage' && item.kind === 'queued'

const areChatDetailItemPropsEqual = (
  first: ChatDetailItemProps,
  second: ChatDetailItemProps
): boolean =>
  first.canEditOwnMessages === second.canEditOwnMessages &&
  first.container === second.container &&
  first.continuePrompt === second.continuePrompt &&
  first.continueStoppedTurnDisabled === second.continueStoppedTurnDisabled &&
  first.continuedStoppedTurn === second.continuedStoppedTurn &&
  first.followingWorkingStepHasNext === second.followingWorkingStepHasNext &&
  first.followingWorkingStepStatus === second.followingWorkingStepStatus &&
  first.hasNextWorkingStep === second.hasNextWorkingStep &&
  first.modelLabelsById === second.modelLabelsById &&
  first.onDeletePendingMessage === second.onDeletePendingMessage &&
  first.onEditPendingMessage === second.onEditPendingMessage &&
  first.onSteerPendingMessage === second.onSteerPendingMessage &&
  first.onInterruptPendingMessage === second.onInterruptPendingMessage &&
  first.onEditMessage === second.onEditMessage &&
  first.onLoadWorkingStep === second.onLoadWorkingStep &&
  first.onOpenFileLink === second.onOpenFileLink &&
  first.onContinueStoppedTurn === second.onContinueStoppedTurn &&
  first.onRetryStoppedTurn === second.onRetryStoppedTurn &&
  isQueuedPendingMessage(first.previousItem) === isQueuedPendingMessage(second.previousItem) &&
  first.cwd === second.cwd &&
  first.projectCwd === second.projectCwd &&
  first.retryMessage === second.retryMessage &&
  first.retryStoppedTurnDisabled === second.retryStoppedTurnDisabled &&
  first.selectedModelId === second.selectedModelId &&
  first.streaming === second.streaming &&
  areThoughtSettingsEqual(first.thoughtSettings, second.thoughtSettings) &&
  first.item === second.item

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

const animatedToolIcons: Record<ProviderToolIcon, AnimatedIconComponent> = {
  'image-view': AnimatedEyeIcon,
  'image-generation': AnimatedSparklesIcon,
  'openai-docs': AnimatedBookTextIcon,
  plan: AnimatedListIcon,
  question: AnimatedCircleHelpIcon
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
  'Consulting my cat'
]
const longRunningActivities = new Set<ProviderToolActivity>(['npm', 'npx', 'script', 'command'])
const silencePlaceholderDelayMs = 600
const streamRenderMaxDelayMs = 180
const streamPacketAnimationMs = 150

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

const createChatMarkdownRenderer = (interactiveFileLinks: boolean): Renderer => {
  const renderer = new Renderer()

  renderer.html = ({ text }) => escapeHtml(text)
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
    return `<a${renderHtmlAttributes({
      href,
      title,
      rel: 'noreferrer',
      target: '_blank'
    })}>${children}</a>`
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
    })}><span class="chat-detail__markdown-image-loading" aria-label="Loading ${escapeHtml(name)}"></span></button>`
  }
  renderer.table = function (token: Tokens.Table): string {
    const tableMarkup = defaultChatMarkdownRenderer.table.call(this, token)
    return `<div class="chat-detail__table-scroll">${tableMarkup.replace(
      '<table>',
      '<table class="chat-detail__table">'
    )}</div>`
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
          <ToolStatusIcon activity={activity} active={active} icon={tools[0]?.icon} />
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
      <span className="chat-detail__generated-image-error" title={path ?? name}>
        {name} unavailable
      </span>
    )
  }

  if (!imageUrl) {
    return <span className="chat-detail__generated-image-loading" aria-label="Loading image" />
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
}> = ({ attachments, onOpenFileLink, projectCwd }) => {
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
      {otherAttachments.length > 0 && (
        <div
          className="chat-detail__message-attachment-group chat-detail__message-attachment-group--other"
          role="list"
          aria-label="Other message attachments"
        >
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
  projectCwd?: string | null
}> = ({ item, activeToolIds, expanded = false, projectCwd }) => {
  const tools = getToolsFromToolItem(item)
  const activity = tools[0]?.activity ?? 'other'
  const active = tools.some((tool) => activeToolIds.has(tool.id))
  const rawLabel = item.label || tools[0]?.toolId || 'Tool use'
  const label = getToolDisplayLabel(rawLabel, activity, active)

  if (tools.some((tool) => tool.images.length > 0)) {
    return <GeneratedImageTool active={active} label={label} tools={tools} />
  }

  if (activity === 'read' || !tools.some(hasToolDetails)) {
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
  selectionQuoteHost?: boolean
  streaming?: boolean
}> = ({
  className,
  content,
  localImageContainer,
  localImageCwd,
  onOpenFileLink,
  selectionQuoteHost = false,
  streaming = false
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const packetAnimationRef = useRef<Animation | null>(null)
  const [localImagePreview, setLocalImagePreview] = useState<{
    imageUrl: string
    name: string
    path: string
  } | null>(null)
  const { animate, revision, visibleContent } = useStreamRenderedContent(content, streaming)
  const markdownRenderer = useMemo(
    () => createChatMarkdownRenderer(Boolean(onOpenFileLink)),
    [onOpenFileLink]
  )
  const renderedMarkdown = useMemo(
    () =>
      DOMPurify.sanitize(
        marked.parse(visibleContent, {
          async: false,
          gfm: true,
          renderer: markdownRenderer
        }),
        { ADD_ATTR: ['target'] }
      ),
    [markdownRenderer, visibleContent]
  )
  useLayoutEffect(() => {
    const markdownContainer = containerRef.current
    if (!selectionQuoteHost || !markdownContainer) return undefined

    // The quote control portals into this message-owned host. Replacing rendered markdown removes
    // the previous host in the same commit, so a quote can never outlive its source message DOM.
    const quoteHost = document.createElement('div')
    quoteHost.className = 'chat-detail__message-quote-host'
    markdownContainer.append(quoteHost)
    return () => quoteHost.remove()
  }, [renderedMarkdown, selectionQuoteHost])
  useEffect(() => {
    const markdownContainer = containerRef.current
    if (!markdownContainer) return undefined

    let current = true
    const objectUrls: string[] = []
    const imageButtons = markdownContainer.querySelectorAll<HTMLButtonElement>(
      '.chat-detail__markdown-image[data-local-image-path]'
    )

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
          error.textContent = `${name} unavailable`
          button.replaceChildren(error)
          button.setAttribute('aria-disabled', 'true')
        })
    })

    return () => {
      current = false
      objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl))
    }
  }, [localImageContainer, localImageCwd, renderedMarkdown])
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      if (!(event.target instanceof Element)) return

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

  useEffect(() => {
    if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const container = containerRef.current
    const target = container?.lastElementChild ?? container
    if (!target) return

    packetAnimationRef.current?.cancel()
    packetAnimationRef.current = target.animate(
      [
        { opacity: 0.72, transform: 'translateY(3px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ],
      {
        duration: streamPacketAnimationMs,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
      }
    )
  }, [animate, revision])

  useEffect(
    () => () => {
      packetAnimationRef.current?.cancel()
    },
    []
  )

  const localImageOptions: Omit<AppLocalImageOptions, 'path'> = {
    container: localImageContainer,
    cwd: localImageCwd,
    relativeTo: 'cwd'
  }

  return (
    <>
      <div
        className={className}
        data-streaming={streaming || undefined}
        ref={containerRef}
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
      />
      {localImagePreview && (
        <ImageLightbox
          imageUrl={localImagePreview.imageUrl}
          localImageOptions={localImageOptions}
          name={localImagePreview.name}
          path={localImagePreview.path}
          onClose={() => setLocalImagePreview(null)}
        />
      )}
    </>
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
      if (tool.status === 'running' && longRunningActivities.has(tool.activity)) {
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

    const imageTools = item.tools.filter(isGeneratedImageTool)
    const remainingTools = item.tools.filter((tool) => !isGeneratedImageTool(tool))
    generatedImages.push(...imageTools)

    if (remainingTools.length === 1) remaining.push(remainingTools[0])
    else if (remainingTools.length > 1) remaining.push({ ...item, tools: remainingTools })
  }

  return { generatedImages, remaining }
}

const getWorkingStepDefaultOpen = (
  status: ProviderWorkingStep['status'],
  thoughtSettings: AppChatThoughtSettings,
  hasNextWorkingStep: boolean
): boolean => {
  if (status === 'working') {
    return (
      thoughtSettings.expandThoughtsOnStart &&
      !(hasNextWorkingStep && thoughtSettings.collapseThoughtsOnNextTurn)
    )
  }

  if (status === 'stopped') {
    return (
      thoughtSettings.expandStoppedTurns &&
      !(hasNextWorkingStep && thoughtSettings.collapseStoppedOnNextTurn)
    )
  }

  if (status === 'worked') {
    return (
      !thoughtSettings.collapseThoughtsOnFinish &&
      !(hasNextWorkingStep && thoughtSettings.collapseThoughtsOnNextTurn)
    )
  }

  return false
}

const WorkingStep: React.FC<{
  container?: AppContainerTarget | null
  continueDisabled?: boolean
  continuedStoppedTurn?: boolean
  followingWorkingStepHasNext?: boolean
  followingWorkingStepStatus?: ProviderWorkingStep['status']
  hasNextWorkingStep?: boolean
  item: ProviderWorkingStep
  cwd?: string | null
  onContinue?: () => Promise<void> | void
  onLoad?: () => Promise<void> | void
  onOpenFileLink?: (path: string, displayPath: string, line?: number, endLine?: number) => void
  onRetry?: () => void
  projectCwd?: string | null
  retryDisabled?: boolean
  thoughtSettings: AppChatThoughtSettings
}> = ({
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
  onOpenFileLink,
  onRetry,
  projectCwd,
  retryDisabled = false,
  thoughtSettings
}) => {
  const [continueClicked, setContinueClicked] = useState(false)
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [openAfterLoad, setOpenAfterLoad] = useState(false)
  const unloaded = item.itemsLoaded === false
  const linkedToFollowingStep = continuedStoppedTurn || continueClicked
  const { generatedImages, remaining } = partitionGeneratedImageItems(item.items)
  const blocks = groupWorkingItems(remaining)
  const lastWorkingItem = item.items.at(-1)
  const signature = useMemo(
    () => `${item.status}:${item.items.map(getWorkingItemSignature).join('|')}`,
    [item.items, item.status]
  )
  const activeToolIds = useMemo(() => getActiveToolIds(item), [item])
  const active = item.status === 'working'
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
    thoughtSettings,
    autoCollapseHasNextWorkingStep
  )
  const openControlKey = [
    autoCollapseStatus,
    autoCollapseHasNextWorkingStep ? 'next' : 'latest',
    thoughtSettings.expandThoughtsOnStart,
    thoughtSettings.collapseThoughtsOnFinish,
    thoughtSettings.collapseThoughtsOnNextTurn,
    thoughtSettings.expandStoppedTurns,
    thoughtSettings.collapseStoppedOnNextTurn
  ].join(':')
  const [openState, setOpenState] = useState({ key: openControlKey, open: defaultOpen })
  const open = openAfterLoad || (openState.key === openControlKey ? openState.open : defaultOpen)
  const showPlaceholder = useSilencePlaceholder(
    signature,
    active && activeToolIds.size === 0,
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
  const renderedGeneratedImages = generatedImages.map((imageItem) => (
    <ToolItem
      item={imageItem}
      activeToolIds={activeToolIds}
      key={imageItem.id}
      projectCwd={projectCwd}
    />
  ))
  const stoppedTurnActions =
    item.status === 'stopped' && !linkedToFollowingStep && (onRetry || onContinue) ? (
      <div className="chat-detail__working-actions">
        {onRetry && (
          <Button
            theme="secondary"
            size="small"
            aria-label="Retry stopped turn"
            title="Retry"
            disabled={retryDisabled}
            callback={onRetry}
            icon={<RefreshCw aria-hidden="true" />}
            label={<span>Retry</span>}
          />
        )}
        {onContinue && (
          <Button
            theme="secondary"
            size="small"
            aria-label="Continue stopped turn"
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
      </div>
    ) : null

  if (unloaded) {
    const handleLoad = async (): Promise<void> => {
      if (loadState === 'loading') return

      setLoadState('loading')
      setOpenAfterLoad(true)
      try {
        await onLoad?.()
        setLoadState('idle')
      } catch {
        setLoadState('error')
      }
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
            disabled={loadState === 'loading'}
            onClick={handleLoad}
          >
            {heading}
            {loadState === 'loading' ? (
              <LoaderCircle className="chat-detail__working-spinner" aria-hidden="true" />
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
        {stoppedTurnActions}
      </>
    )
  }

  if (blocks.length === 0) {
    if (item.status !== 'stopped' && !showPlaceholder && renderedGeneratedImages.length > 0) {
      return (
        <>
          {stoppedTurnActions}
          {renderedGeneratedImages}
        </>
      )
    }

    if (showPlaceholder) {
      return (
        <>
          <WorkingPlaceholder id={item.id} />
          {stoppedTurnActions}
          {renderedGeneratedImages}
        </>
      )
    }

    return (
      <>
        <div
          className={`chat-detail__step chat-detail__working chat-detail__working--${item.status}`}
        >
          <div className="chat-detail__working-heading">{heading}</div>
        </div>
        {stoppedTurnActions}
        {renderedGeneratedImages}
      </>
    )
  }

  return (
    <>
      <details
        className={`chat-detail__step chat-detail__working chat-detail__working--${item.status}`}
        open={open}
        onToggle={(event) => {
          setOpenAfterLoad(false)
          setOpenState({ key: openControlKey, open: event.currentTarget.open })
        }}
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
                (blockIndex < blocks.length - 1 || item.status !== 'working') ? (
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
                  localImageContainer={container}
                  localImageCwd={cwd}
                  onOpenFileLink={onOpenFileLink}
                  streaming={active && block.item === lastWorkingItem}
                />
              )
            )}
            {showPlaceholder && <WorkingPlaceholder id={`${item.id}:${item.items.length}`} />}
          </div>
        )}
      </details>
      {stoppedTurnActions}
      {renderedGeneratedImages}
    </>
  )
}

const getPendingMessageLabel = (message: ProviderPendingMessage): string =>
  message.kind === 'steering' ? 'Steering with' : 'Queue'

const getPendingMessageActionLabel = (message: ProviderPendingMessage): string =>
  message.kind === 'steering' ? 'steering' : 'queued'

const ChatDetailItemComponent: React.FC<ChatDetailItemProps> = ({
  canEditOwnMessages = false,
  container,
  continuePrompt = '',
  continueStoppedTurnDisabled = false,
  continuedStoppedTurn = false,
  followingWorkingStepHasNext = false,
  followingWorkingStepStatus,
  hasNextWorkingStep = false,
  item,
  modelLabelsById,
  onDeletePendingMessage,
  onEditPendingMessage,
  onSteerPendingMessage,
  onInterruptPendingMessage,
  onEditMessage,
  onLoadWorkingStep,
  onOpenFileLink,
  onContinueStoppedTurn,
  onRetryStoppedTurn,
  previousItem,
  cwd,
  projectCwd,
  retryMessage,
  retryStoppedTurnDisabled = false,
  selectedModelId,
  streaming = false,
  thoughtSettings
}) => {
  const [copied, setCopied] = useState(false)
  const resolvedThoughtSettings = getThoughtSettings(thoughtSettings)

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
    const messageLabel =
      pending && item.kind === 'queued' && isQueuedPendingMessage(previousItem)
        ? null
        : pending
          ? getPendingMessageLabel(item)
          : (item.label ?? null)
    const pendingActionLabel = pending ? getPendingMessageActionLabel(item) : 'pending'
    const canEdit = !pending && role === 'user' && canEditOwnMessages && Boolean(onEditMessage)
    const canEditPending = pending && Boolean(onEditPendingMessage)
    const canDelete = pending && Boolean(onDeletePendingMessage)
    const canSteer = pending && item.kind === 'queued' && Boolean(onSteerPendingMessage)
    const canInterrupt = pending && Boolean(onInterruptPendingMessage)
    const timestamp = item.createdAt
    const modelLabel = pending ? null : getMessageModelLabel(item, selectedModelId, modelLabelsById)
    const attachments = item.attachments ?? []
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
        {!canEdit &&
        !canEditPending &&
        !canSteer &&
        !canInterrupt &&
        !canDelete &&
        role === 'user' ? (
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
        {attachments.length > 0 && (
          <MessageAttachments
            attachments={attachments}
            onOpenFileLink={onOpenFileLink}
            projectCwd={projectCwd}
          />
        )}
        {item.content.trim() && (
          <MarkdownMessage
            className={`chat-detail__message chat-detail__message--${role}`}
            content={role === 'user' ? withPromptMarkdownLineBreaks(item.content) : item.content}
            localImageContainer={container}
            localImageCwd={cwd}
            onOpenFileLink={onOpenFileLink}
            selectionQuoteHost={!pending && role === 'assistant'}
            streaming={!pending && role === 'assistant' && streaming}
          />
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
      container={container}
      continueDisabled={continueStoppedTurnDisabled || !continuePrompt.trim()}
      continuedStoppedTurn={continuedStoppedTurn}
      followingWorkingStepHasNext={followingWorkingStepHasNext}
      followingWorkingStepStatus={followingWorkingStepStatus}
      hasNextWorkingStep={hasNextWorkingStep}
      item={item}
      cwd={cwd}
      onLoad={onLoadWorkingStep ? () => onLoadWorkingStep(item.id) : undefined}
      onContinue={
        onContinueStoppedTurn
          ? () => onContinueStoppedTurn(item.id, continuePrompt.trim())
          : undefined
      }
      onOpenFileLink={onOpenFileLink}
      onRetry={
        retryMessage && onRetryStoppedTurn ? () => onRetryStoppedTurn(retryMessage) : undefined
      }
      projectCwd={projectCwd}
      retryDisabled={retryStoppedTurnDisabled}
      thoughtSettings={resolvedThoughtSettings}
    />
  )
}

export const ChatDetailItem = memo(ChatDetailItemComponent, areChatDetailItemPropsEqual)
