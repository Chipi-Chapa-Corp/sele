import {
  findNativeItemTurnWindow,
  renderNativeTurnWindow,
  type TranscriptRenderWindow
} from '../transcriptProjection/turnWindow.ts'
import type { ProviderChatTurnWindow } from '../ProviderAdapter'
import { isImageSizingMetadata } from '../imageSizingMetadata.ts'
import { ProjectionJournal } from '../transcriptProjection/ProjectionJournal.ts'
import {
  getWorkingItemPayloadCharacterCount,
  setWorkingItemSourcePayloadCharacterCount,
  groupWorkingItemsForRenderer,
  rendererWorkingItemPageSize,
  rendererWorkingToolGroupLimit
} from '../workingStepLazy.ts'
import { basename, extname, posix, win32 } from 'node:path'
import type {
  ProviderChatItem,
  ProviderMessage,
  ProviderWorkingItem,
  ProviderFileDiff,
  ProviderMessageAttachment,
  ProviderToolActivity,
  ProviderToolImage,
  ProviderWorkingTool
} from '../../../shared/provider'
import {
  appendProviderConversationSegment,
  getTrailingAssistantEntryIndex,
  type ProviderConversationEntry
} from '../ProviderConversationEngine.ts'

export type ClaudeTranscriptMessage = {
  type: 'user' | 'assistant' | 'system'
  uuid: string
  session_id: string
  message: unknown
  parent_tool_use_id: string | null
  isSynthetic?: boolean
  isMeta?: boolean
  isCompactSummary?: boolean
  timestamp?: string
  tool_use_result?: unknown
  kind?: 'steering'
  label?: string | null
  attachments?: ProviderMessageAttachment[]
  failed?: boolean
}

type ClaudeContentBlock = {
  type?: unknown
  id?: unknown
  name?: unknown
  input?: unknown
  text?: unknown
  thinking?: unknown
  tool_use_id?: unknown
  content?: unknown
  is_error?: unknown
  source?: unknown
}

type RenderOptions = TranscriptRenderWindow & {
  active: boolean
  stopped: boolean
  failed?: boolean
  pendingItems?: ProviderChatItem[]
}

type Segment = {
  id: string
  entries: ProviderConversationEntry[]
  failed: boolean
}

const maxToolOutputLength = 160_000
const maxRawToolValueLength = 80_000
const truncatedToolValueMarker = '… [truncated to keep the app responsive]'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const getMessageRecord = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? value : null

const getContentBlocks = (message: unknown): ClaudeContentBlock[] => {
  const content = getMessageRecord(message)?.content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return Array.isArray(content)
    ? content.filter((block): block is ClaudeContentBlock => isRecord(block))
    : []
}

const toTimestamp = (value: string | undefined): number | null => {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

const truncateToolOutput = (value: string | null): string | null => {
  if (value == null || value.length <= maxToolOutputLength) return value
  return `${truncatedToolValueMarker}\n${value.slice(-maxToolOutputLength)}`
}

const getBoundedRawValue = (value: unknown): unknown => {
  try {
    const serialized = JSON.stringify(value)
    if (!serialized || serialized.length <= maxRawToolValueLength) return value
    return `${serialized.slice(0, maxRawToolValueLength)}\n${truncatedToolValueMarker}`
  } catch (error) {
    console.error('Unable to serialize a Claude tool value.', error)
    return String(value)
  }
}

const getArgument = (input: unknown, ...keys: string[]): string | null => {
  if (!isRecord(input)) return null
  for (const key of keys) {
    const value = getString(input[key])
    if (value) return value
  }
  return null
}

const getToolCommand = (input: unknown): string | null =>
  getArgument(input, 'command', 'cmd', 'query', 'pattern', 'prompt')

const getToolCwd = (input: unknown): string | null =>
  getArgument(input, 'cwd', 'working_directory', 'workingDirectory', 'directory')

const getToolPath = (input: unknown): string | null =>
  getArgument(input, 'file_path', 'path', 'filePath', 'file', 'notebook_path', 'directory')

const classifyTool = (nameValue: unknown, input: unknown): ProviderToolActivity => {
  const name = getString(nameValue)?.toLocaleLowerCase() ?? ''
  const command = getToolCommand(input)?.toLocaleLowerCase() ?? ''

  if (name.includes('delete') || /\brm\b/.test(command)) return 'delete'
  if (name === 'write' || name.includes('create')) return 'create'
  if (name.includes('edit') || name.includes('patch') || name.includes('replace')) return 'edit'
  if (name.includes('grep') || name.includes('glob') || name.includes('search')) return 'search'
  if (name.includes('read') || name.includes('view') || name.includes('list')) return 'read'
  if (/^git(?:\s|$)/.test(command)) return 'git'
  if (/^npm(?:\s|$)/.test(command)) return 'npm'
  if (/^npx(?:\s|$)/.test(command)) return 'npx'
  if (name === 'bash' || name.includes('shell') || command) return 'command'
  return 'other'
}

const getToolLabel = (nameValue: unknown, input: unknown): string => {
  const name = getString(nameValue) ?? 'Tool'
  if (name === 'AskUserQuestion') return 'Asking question'
  if (name === 'TodoWrite') return 'Updated plan'

  const activity = classifyTool(name, input)
  const path = getToolPath(input)
  const command = getToolCommand(input)
  if (path) {
    const displayPath = basename(path) || path
    if (activity === 'read') return `Read ${displayPath}`
    if (activity === 'search') return `Search ${displayPath}`
    if (activity === 'create') return `Create ${displayPath}`
    if (activity === 'delete') return `Delete ${displayPath}`
    if (activity === 'edit') return `Edit ${displayPath}`
  }
  if (command) return command
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
}

const skillToolName = 'Skill'

const isSkillToolBlock = (block: ClaudeContentBlock): boolean =>
  getString(block.name) === skillToolName

const getSkillToolLabel = (input: unknown): string => {
  const skillName = getArgument(input, 'skill')
  return skillName ? `Use ${skillName} skill` : 'Use skill'
}

/**
 * Claude streams one API response as a single partial record but persists it as one transcript
 * record per content block, each with a fresh uuid. Item ids therefore derive from the API message
 * id (shared by the partial and every split record) so the renderer keeps the same React keys, and
 * with them disclosure state, when a streamed block is replaced by its transcript record.
 */
const getClaudeBlockBaseId = (message: ClaudeTranscriptMessage): string => {
  const apiMessageId = getString(getMessageRecord(message.message)?.id)
  return apiMessageId?.startsWith('msg_') ? apiMessageId : message.uuid
}

type ClaudeBlockKind = 'text' | 'thinking' | 'subagent'

/**
 * Allocates block ids that are identical whether the blocks arrive in one streamed record or in
 * several transcript records: the nth rendered block of a kind for an API message always gets
 * `${base}:${kind}:${n}`.
 */
const createClaudeBlockIds = (): ((
  message: ClaudeTranscriptMessage,
  kind: ClaudeBlockKind
) => string) => {
  const counters = new Map<string, number>()
  return (message, kind) => {
    const key = `${getClaudeBlockBaseId(message)}:${kind}`
    const index = counters.get(key) ?? 0
    counters.set(key, index + 1)
    return `${key}:${index}`
  }
}

const createTool = (messageId: string, block: ClaudeContentBlock): ProviderWorkingTool => {
  const toolId = getString(block.id) ?? `${messageId}:tool`
  const name = getString(block.name) ?? 'Tool'
  const isSkill = isSkillToolBlock(block)
  // Skill invocations only inject instructions into the conversation. Their payload is
  // the skill body, which is not useful to inspect, so they render without details.
  const hidePayload = name === 'AskUserQuestion' || isSkill
  return {
    type: 'tool',
    id: `${messageId}:${toolId}`,
    toolId,
    status: 'running',
    activity: isSkill ? 'read' : classifyTool(name, block.input),
    icon: name === 'AskUserQuestion' ? 'question' : name === 'TodoWrite' ? 'plan' : null,
    label: isSkill ? getSkillToolLabel(block.input) : getToolLabel(name, block.input),
    command: isSkill ? null : getToolCommand(block.input),
    cwd: getToolCwd(block.input),
    stdout: null,
    diffs: [],
    backgroundSessionId: null,
    finishedBackgroundSessionId: null,
    rawInput: hidePayload ? null : getBoundedRawValue(block.input ?? null),
    rawOutput: null,
    images: []
  }
}

const getTextContent = (value: unknown): string | null => {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return null
  const text = value
    .flatMap((block): string[] => {
      if (!isRecord(block)) return []
      if (block.type === 'text' && typeof block.text === 'string') return [block.text]
      return []
    })
    .join('\n')
  return text || null
}

const getToolImages = (value: unknown): ProviderToolImage[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((block): ProviderToolImage[] => {
    if (!isRecord(block) || block.type !== 'image' || !isRecord(block.source)) return []
    const mediaType = getString(block.source.media_type)
    const data = getString(block.source.data)
    if (!mediaType?.startsWith('image/') || !data) return []
    return [{ dataUrl: `data:${mediaType};base64,${data}`, name: 'Generated image' }]
  })
}

const getToolDiffs = (tool: ProviderWorkingTool, output: string | null): ProviderFileDiff[] => {
  const path = getToolPath(tool.rawInput)
  if (!path || !output || (!output.includes('@@') && !output.includes('diff --git'))) return []
  const kind: ProviderFileDiff['kind'] =
    tool.activity === 'create' ? 'create' : tool.activity === 'delete' ? 'delete' : 'edit'
  return [{ path, kind, diff: output }]
}

const updateTool = (
  entries: ProviderConversationEntry[],
  toolId: string,
  update: (tool: ProviderWorkingTool) => ProviderWorkingTool
): void => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry?.kind !== 'working') continue
    const item = entry.item
    if (item?.type === 'tool' && item.toolId === toolId) {
      entries[index] = { kind: 'working', item: update(item) }
      return
    }
    if (item?.type === 'toolGroup') {
      const toolIndex = item.tools.findIndex((tool) => tool.toolId === toolId)
      const tool = item.tools[toolIndex]
      if (toolIndex >= 0 && tool) {
        item.tools[toolIndex] = update(tool)
        return
      }
    }
  }
}

const getHumanText = (blocks: ClaudeContentBlock[]): string =>
  blocks
    .flatMap((block): string[] =>
      block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
    )
    .join('\n')
    .trim()

const messageImageExtensions = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp'])

// Sele appends attachment paths to the SDK prompt, while its richer attachment metadata
// only lives in memory. Recover that final paragraph when replaying a saved transcript.
const getUserMessagePresentation = (
  message: ClaudeTranscriptMessage,
  blocks: ClaudeContentBlock[]
): Pick<ProviderMessage, 'content' | 'attachments'> => {
  const content = getHumanText(blocks)
  const attachments = message.attachments?.length ? message.attachments : undefined
  const suffix = /(?:^|\r?\n\r?\n)(@[^\r\n]+(?:\r?\n@[^\r\n]+)*)$/.exec(content)
  if (!suffix) return { content, attachments }

  const paths = suffix[1].split(/\r?\n/).map((line) => line.slice(1))
  if (paths.some((path) => !posix.isAbsolute(path) && !win32.isAbsolute(path))) {
    return { content, attachments }
  }
  // Existing metadata is authoritative, including names and inline image payloads.
  if (
    attachments &&
    paths.some((path) => !attachments.some((item) => 'path' in item && item.path === path))
  ) {
    return { content, attachments }
  }
  return {
    content: content.slice(0, suffix.index).trimEnd(),
    attachments:
      attachments ??
      [...new Set(paths)].map((path) => ({
        kind: messageImageExtensions.has(extname(path).toLowerCase()) ? 'image' : 'file',
        name: posix.isAbsolute(path) ? posix.basename(path) : win32.basename(path),
        path
      }))
  }
}

const hasToolResults = (blocks: ClaudeContentBlock[]): boolean =>
  blocks.some((block) => block.type === 'tool_result')

const interruptedRequestMarker = '[Request interrupted by user]'
const localCommandOutputPattern =
  /^<local-command-(?:stdout|stderr)>[\s\S]*<\/local-command-(?:stdout|stderr)>$/
const skillContextPrefix = 'Base directory for this skill:'
const taskNotificationPattern = /^<task-notification>[\s\S]*<\/task-notification>/
const compactionSummaryPrefix =
  'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.'
const compactCommandPattern =
  /^<command-name>\/compact<\/command-name>\s*<command-message>compact<\/command-message>\s*<command-args>[\s\S]*<\/command-args>$/

const getStandaloneUserText = (message: ClaudeTranscriptMessage): string | null => {
  if (message.type !== 'user' || message.attachments?.length) return null
  const blocks = getContentBlocks(message.message)
  if (blocks.length !== 1 || blocks[0]?.type !== 'text' || typeof blocks[0].text !== 'string') {
    return null
  }
  return blocks[0].text.trim()
}

export const isClaudeInterruptedRequestMarker = (message: ClaudeTranscriptMessage): boolean => {
  return getStandaloneUserText(message) === interruptedRequestMarker
}

// After a Skill tool call Claude appends the skill body as a user-role message so the
// model can follow it. The person never typed it, so it must not render as their message.
export const isClaudeSkillContextMessage = (message: ClaudeTranscriptMessage): boolean => {
  if (message.type !== 'user' || message.attachments?.length) return false
  const blocks = getContentBlocks(message.message)
  if (hasToolResults(blocks)) return false
  return message.isMeta === true || getHumanText(blocks).startsWith(skillContextPrefix)
}

export const isClaudeInternalUserMessage = (message: ClaudeTranscriptMessage): boolean => {
  const text = getStandaloneUserText(message)
  return (
    (message.type === 'user' &&
      !message.attachments?.length &&
      !hasToolResults(getContentBlocks(message.message)) &&
      message.isCompactSummary === true) ||
    text === interruptedRequestMarker ||
    (text != null && compactCommandPattern.test(text)) ||
    // Session history returned by the SDK can omit the original isCompactSummary flag.
    (text != null &&
      (text === compactionSummaryPrefix || text.startsWith(`${compactionSummaryPrefix}\n`))) ||
    (text != null && isImageSizingMetadata(text)) ||
    (text != null && localCommandOutputPattern.test(text)) ||
    (text != null && taskNotificationPattern.test(text)) ||
    isClaudeSkillContextMessage(message)
  )
}

const getModel = (message: unknown): string | null => getString(getMessageRecord(message)?.model)

/**
 * Maps a rendered assistant message id back to the transcript record that produced it, replaying
 * the same id allocation as renderClaudeChatItems. Returns null when no rendered block matches.
 */
export const resolveClaudeAssistantMessageUuid = (
  messages: ClaudeTranscriptMessage[],
  itemId: string
): string | null => {
  const nextBlockId = createClaudeBlockIds()
  for (const message of messages) {
    if (message.type !== 'assistant' || message.parent_tool_use_id) continue
    for (const block of getContentBlocks(message.message)) {
      if (
        block.type === 'thinking' &&
        typeof block.thinking === 'string' &&
        block.thinking.trim()
      ) {
        nextBlockId(message, 'thinking')
      } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        if (nextBlockId(message, 'text') === itemId) return message.uuid
      }
    }
  }
  return null
}

export const renderClaudeChatItems = (
  messages: ClaudeTranscriptMessage[],
  options: RenderOptions
): ProviderChatItem[] => {
  if (options.turnWindow) return renderClaudeChatWindow(messages, options, options.turnWindow).items
  const items: ProviderChatItem[] = []
  const skillToolIds = new Set<string>()
  const nextBlockId = createClaudeBlockIds()
  let segment: Segment | null = null

  const ensureSegment = (messageId: string): Segment => {
    if (!segment) {
      segment = { id: `${messageId}:working`, entries: [], failed: false }
    }
    return segment
  }

  const flushSegment = (isLast: boolean): void => {
    if (!segment) return
    const current = segment
    segment = null
    const failed = current.failed || (isLast && options.failed === true)
    appendProviderConversationSegment(items, {
      preserveRawWorkingItems: true,
      id: current.id,
      entries: current.entries,
      finalMessageIndex: getTrailingAssistantEntryIndex(current.entries),
      lifecycle: {
        active: isLast && options.active,
        completed: !isLast || (!options.active && !failed && !(isLast && options.stopped)),
        failed,
        stopped: isLast && options.stopped
      }
    })
  }

  for (const message of messages) {
    // Claude persists interrupt markers, task notifications and local command output as user-role
    // transcript records. They are control metadata, not text entered by the person.
    if (isClaudeInternalUserMessage(message)) continue

    const blocks = getContentBlocks(message.message)
    const isSubagentMessage = Boolean(message.parent_tool_use_id)

    if (isSubagentMessage && message.type === 'user' && !hasToolResults(blocks)) continue

    if (message.type === 'user' && !hasToolResults(blocks)) {
      const { content, attachments } = getUserMessagePresentation(message, blocks)
      if (!content && !attachments?.length) continue
      flushSegment(false)
      items.push({
        type: 'message',
        id: message.uuid,
        role: 'user',
        content,
        attachments,
        createdAt: toTimestamp(message.timestamp),
        kind: message.kind,
        label: message.label ?? null
      })
      segment = { id: `${message.uuid}:working`, entries: [], failed: false }
      continue
    }

    if (message.type === 'assistant') {
      const current = ensureSegment(message.uuid)
      const blockBaseId = getClaudeBlockBaseId(message)
      blocks.forEach((block) => {
        if (
          block.type === 'thinking' &&
          typeof block.thinking === 'string' &&
          block.thinking.trim()
        ) {
          current.entries.push({
            kind: 'working',
            item: {
              type: 'message',
              id: nextBlockId(message, 'thinking'),
              content: block.thinking.trim()
            }
          })
        } else if (block.type === 'tool_use') {
          // Streamed tool blocks render from their first event, before any input has arrived,
          // so narration preceding them is not mistaken for the turn's final message.
          const tool = createTool(blockBaseId, block)
          if (isSkillToolBlock(block)) skillToolIds.add(tool.toolId)
          current.entries.push({ kind: 'working', item: tool })
        } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          if (isSubagentMessage) {
            current.entries.push({
              kind: 'working',
              item: {
                type: 'message',
                id: nextBlockId(message, 'subagent'),
                content: block.text.trim()
              }
            })
          } else {
            current.entries.push({
              kind: 'assistant',
              message: {
                type: 'message',
                id: nextBlockId(message, 'text'),
                role: 'assistant',
                content: block.text.trim(),
                createdAt: toTimestamp(message.timestamp),
                model: getModel(message.message)
              }
            })
          }
        }
      })
      continue
    }

    if (message.type === 'user' && hasToolResults(blocks)) {
      const current = ensureSegment(message.uuid)
      blocks.forEach((block) => {
        if (block.type !== 'tool_result') return
        const toolId = getString(block.tool_use_id)
        if (!toolId) return
        const output = truncateToolOutput(getTextContent(block.content))
        const images = getToolImages(block.content)
        const hidePayload = skillToolIds.has(toolId)
        updateTool(current.entries, toolId, (tool) => ({
          ...tool,
          status: 'finished',
          label: tool.icon === 'question' ? 'Asked a question' : tool.label,
          icon: images.length > 0 ? 'image-generation' : tool.icon,
          stdout: tool.icon === 'question' || hidePayload ? null : output,
          diffs: tool.icon === 'question' || hidePayload ? [] : getToolDiffs(tool, output),
          rawOutput:
            tool.icon === 'question' || hidePayload
              ? null
              : getBoundedRawValue(message.tool_use_result ?? block.content),
          images
        }))
      })
      continue
    }

    if (message.type === 'system') {
      const record = getMessageRecord(message.message)
      if (record?.subtype === 'compact_boundary') {
        flushSegment(false)
        items.push({ type: 'contextCompaction', id: message.uuid })
      } else {
        const content = getString(record?.content) ?? getString(message.message)
        if (message.failed) ensureSegment(message.uuid).failed = true
        if (content) {
          ensureSegment(message.uuid).entries.push({
            kind: 'working',
            item: {
              type: 'message',
              id: message.uuid,
              content
            }
          })
        }
      }
    }
  }

  flushSegment(true)
  items.push(...(options.pendingItems ?? []))
  return items
}

// This cache owns derived state only. Replacing/reverting committed history resets it; partial
// SDK records are replayed in a rollback journal because the SDK mutates them in place.
type ProjectedClaudeSegment = {
  id: string
  failed: boolean
  groups: ProviderWorkingItem[]
  groupCount: number
  payloadCounts: Map<number, number>
  activities: Map<ProviderToolActivity, number>
  finalMessage: ProviderMessage | null
}
type ClaudeProjectionNode = ProviderChatItem | ProjectedClaudeSegment

export class ClaudeTranscriptProjection {
  private source: ClaudeTranscriptMessage[] | null = null
  private processed = 0
  private nodes: ClaudeProjectionNode[] = []
  private turnStarts: number[] = []
  private state: {
    current: ProjectedClaudeSegment | null
    tools: Map<
      string,
      {
        segment: ProjectedClaudeSegment
        tool: ProviderWorkingTool
        skill: boolean
        groupIndex: number
        payloadCount: number
      }
    >
  } = { current: null, tools: new Map() }
  private counters = new Map<string, number>()
  private journal = new ProjectionJournal()
  /** Deterministic work counter for scaling tests; counts native records, including overlays. */
  processedRecordCount = 0

  acceptSource(
    previous: ClaudeTranscriptMessage[],
    next: ClaudeTranscriptMessage[],
    changedIndex: number
  ): void {
    if (this.source !== previous) return
    if (changedIndex < this.processed) this.source = null
    else this.source = next
  }

  private reset(messages: ClaudeTranscriptMessage[]): void {
    this.source = messages
    this.processed = 0
    this.nodes = []
    this.turnStarts = []
    this.state.current = null
    this.counters.clear()
    this.state.tools.clear()
  }

  private ensureSegment(id: string): ProjectedClaudeSegment {
    if (this.state.current) return this.state.current
    const segment: ProjectedClaudeSegment = {
      id: `${id}:working`,
      failed: false,
      groups: [],
      groupCount: 0,
      payloadCounts: new Map(),
      activities: new Map(),
      finalMessage: null
    }
    this.journal.set(this.state, 'current', segment)
    this.journal.set(this.state, 'tools', new Map())
    this.journal.push(this.nodes, segment)
    return segment
  }

  private blockId(message: ClaudeTranscriptMessage, kind: ClaudeBlockKind): string {
    const key = `${getClaudeBlockBaseId(message)}:${kind}`
    const index = this.counters.get(key) ?? 0
    this.journal.mapSet(this.counters, key, index + 1)
    return `${key}:${index}`
  }

  private appendWorking(segment: ProjectedClaudeSegment, item: ProviderWorkingItem): void {
    const groups = segment.groups.slice()
    const previous = groups.at(-1)
    const canGroup =
      item.type !== 'message' &&
      !(item.type === 'tool' && item.compact) &&
      previous &&
      previous.type !== 'message' &&
      !(previous.type === 'tool' && previous.compact)
    const groupIndex = canGroup ? segment.groupCount - 1 : segment.groupCount
    this.journal.mapSet(
      segment.payloadCounts,
      groupIndex,
      (segment.payloadCounts.get(groupIndex) ?? 0) + getWorkingItemPayloadCharacterCount(item)
    )
    const activities = canGroup
      ? new Map(segment.activities)
      : new Map<ProviderToolActivity, number>()
    if (item.type === 'tool')
      activities.set(item.activity, (activities.get(item.activity) ?? 0) + 1)
    if (canGroup) {
      const grouped = groupWorkingItemsForRenderer([previous, item])[0]
      if (grouped.type !== 'toolGroup') throw new Error('Invalid projected tool group')
      let dominantActivity: ProviderToolActivity = 'other'
      let highest = 0
      for (const [activity, count] of activities) {
        if (count > highest) {
          dominantActivity = activity
          highest = count
        }
      }
      const tools = grouped.tools.slice(-rendererWorkingToolGroupLimit)
      groups[groups.length - 1] = {
        ...grouped,
        tools,
        toolsStartIndex: (grouped.toolCount ?? tools.length) - tools.length,
        dominantActivity
      }
    } else {
      groups.push(item)
      this.journal.set(segment, 'groupCount', segment.groupCount + 1)
    }
    this.journal.set(segment, 'activities', activities)
    this.journal.set(segment, 'groups', groups.slice(-rendererWorkingItemPageSize))
  }

  private demoteFinal(segment: ProjectedClaudeSegment): void {
    if (!segment.finalMessage) return
    const message = segment.finalMessage
    this.appendWorking(segment, { type: 'message', id: message.id, content: message.content })
    this.journal.set(segment, 'finalMessage', null)
  }

  private consume(message: ClaudeTranscriptMessage): void {
    this.processedRecordCount += 1
    if (isClaudeInternalUserMessage(message)) return
    const blocks = getContentBlocks(message.message)
    const subagent = Boolean(message.parent_tool_use_id)
    if (subagent && message.type === 'user' && !hasToolResults(blocks)) return
    if (message.type === 'user' && !hasToolResults(blocks)) {
      const { content, attachments } = getUserMessagePresentation(message, blocks)
      if (!content && !attachments?.length) return
      this.journal.set(this.state, 'current', null)
      this.journal.push(this.turnStarts, this.nodes.length)
      this.journal.push(this.nodes, {
        type: 'message',
        id: message.uuid,
        role: 'user',
        content,
        attachments,
        createdAt: toTimestamp(message.timestamp),
        kind: message.kind,
        label: message.label ?? null
      })
      this.ensureSegment(message.uuid)
      return
    }
    if (message.type === 'assistant') {
      const segment = this.ensureSegment(message.uuid)
      for (const block of blocks) {
        if (
          block.type === 'thinking' &&
          typeof block.thinking === 'string' &&
          block.thinking.trim()
        ) {
          this.demoteFinal(segment)
          this.appendWorking(segment, {
            type: 'message',
            id: this.blockId(message, 'thinking'),
            content: block.thinking.trim()
          })
        } else if (block.type === 'tool_use') {
          this.demoteFinal(segment)
          const tool = createTool(getClaudeBlockBaseId(message), block)
          this.appendWorking(segment, tool)
          this.journal.mapSet(this.state.tools, tool.toolId, {
            segment,
            tool,
            skill: isSkillToolBlock(block),
            groupIndex: segment.groupCount - 1,
            payloadCount: getWorkingItemPayloadCharacterCount(tool)
          })
        } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          this.demoteFinal(segment)
          if (subagent)
            this.appendWorking(segment, {
              type: 'message',
              id: this.blockId(message, 'subagent'),
              content: block.text.trim()
            })
          else
            this.journal.set(segment, 'finalMessage', {
              type: 'message',
              id: this.blockId(message, 'text'),
              role: 'assistant',
              content: block.text.trim(),
              createdAt: toTimestamp(message.timestamp),
              model: getModel(message.message)
            })
        }
      }
      return
    }
    if (message.type === 'user' && hasToolResults(blocks)) {
      const segment = this.ensureSegment(message.uuid)
      for (const block of blocks) {
        if (block.type !== 'tool_result') continue
        const toolId = getString(block.tool_use_id)
        const location = toolId ? this.state.tools.get(toolId) : undefined
        // The full converter matches results only within the current segment.
        if (!location || location.segment !== segment) continue
        const output = truncateToolOutput(getTextContent(block.content))
        const images = getToolImages(block.content)
        const old = location.tool
        const hide = old.icon === 'question' || location.skill
        const tool: ProviderWorkingTool = {
          ...old,
          status: 'finished',
          label: old.icon === 'question' ? 'Asked a question' : old.label,
          icon: images.length > 0 ? 'image-generation' : old.icon,
          stdout: hide ? null : output,
          diffs: hide ? [] : getToolDiffs(old, output),
          rawOutput: hide ? null : getBoundedRawValue(message.tool_use_result ?? block.content),
          images
        }
        const payloadCount = getWorkingItemPayloadCharacterCount(tool)
        this.journal.mapSet(
          segment.payloadCounts,
          location.groupIndex,
          (segment.payloadCounts.get(location.groupIndex) ?? 0) +
            payloadCount -
            location.payloadCount
        )
        this.journal.mapSet(this.state.tools, toolId!, {
          ...location,
          payloadCount,
          tool: { ...tool, stdout: null, rawOutput: null, diffs: [], images: [] }
        })
        this.journal.set(
          segment,
          'groups',
          segment.groups.map((group) => {
            if (group.type === 'tool') return group.id === old.id ? tool : group
            if (group.type === 'toolGroup')
              return {
                ...group,
                tools: group.tools.map((child) => (child.id === old.id ? tool : child))
              }
            return group
          })
        )
      }
      return
    }
    if (message.type === 'system') {
      const record = getMessageRecord(message.message)
      if (record?.subtype === 'compact_boundary') {
        this.journal.set(this.state, 'current', null)
        this.journal.push(this.nodes, { type: 'contextCompaction', id: message.uuid })
      } else {
        const content = getString(record?.content) ?? getString(message.message)
        if (message.failed) this.journal.set(this.ensureSegment(message.uuid), 'failed', true)
        if (content) {
          const segment = this.ensureSegment(message.uuid)
          this.demoteFinal(segment)
          this.appendWorking(segment, { type: 'message', id: message.uuid, content })
        }
      }
    }
  }

  read(
    messages: ClaudeTranscriptMessage[],
    overlays: ClaudeTranscriptMessage[],
    options: RenderOptions,
    turnLimit = 10
  ): { items: ProviderChatItem[]; itemsStartTurnIndex: number; turnCount: number } {
    if (this.source !== messages) this.reset(messages)
    for (; this.processed < messages.length; this.processed += 1)
      this.consume(messages[this.processed])
    return this.journal.overlay(() => {
      overlays.forEach((message) => this.consume(message))
      const leadingOrphanTurn = this.turnStarts[0] === 0 ? 0 : 1
      const sourceTurnCount = this.nodes.length ? this.turnStarts.length + leadingOrphanTurn : 0
      const pending = options.pendingItems ?? []
      const turnCount = sourceTurnCount + pending.length
      const itemsStartTurnIndex = Math.max(0, turnCount - Math.max(1, turnLimit))
      const items: ProviderChatItem[] = []
      if (itemsStartTurnIndex < sourceTurnCount) {
        const nodeStart =
          leadingOrphanTurn && itemsStartTurnIndex === 0
            ? 0
            : this.turnStarts[itemsStartTurnIndex - leadingOrphanTurn]
        for (let index = nodeStart; index < this.nodes.length; index += 1) {
          const node = this.nodes[index]
          if ('type' in node) {
            items.push(node)
            continue
          }
          const last = node === this.state.current
          const failed = node.failed || (last && options.failed === true)
          appendProviderConversationSegment(items, {
            id: node.id,
            entries: [
              ...node.groups.map((item, groupOffset) => {
                const projectedItem = { ...item }
                setWorkingItemSourcePayloadCharacterCount(
                  projectedItem,
                  node.payloadCounts.get(node.groupCount - node.groups.length + groupOffset) ?? 0
                )
                return { kind: 'working' as const, item: projectedItem }
              }),
              ...(node.finalMessage
                ? [{ kind: 'assistant' as const, message: node.finalMessage }]
                : [])
            ],
            lifecycle: {
              active: last && options.active,
              completed: !last || (!options.active && !failed && !(last && options.stopped)),
              failed,
              stopped: last && options.stopped
            },
            workingItemWindow: {
              itemCount: node.groupCount,
              itemsStartIndex: node.groupCount - node.groups.length
            }
          })
        }
      }
      items.push(...pending.slice(Math.max(0, itemsStartTurnIndex - sourceTurnCount)))
      return { items, itemsStartTurnIndex, turnCount }
    })
  }
}

const classifyClaudeTurnRecord = (
  message: ClaudeTranscriptMessage
): 'start' | 'content' | 'ignore' => {
  if (message.type === 'user') {
    if (isClaudeInternalUserMessage(message)) return 'ignore'
    const blocks = getContentBlocks(message.message)
    if (hasToolResults(blocks)) return 'content'
    if (message.parent_tool_use_id) return 'ignore'
    return getHumanText(blocks) || message.attachments?.length ? 'start' : 'ignore'
  }
  if (message.type === 'system') {
    const record = getMessageRecord(message.message)
    return record?.subtype === 'compact_boundary' ||
      message.failed ||
      getString(record?.content) ||
      getString(message.message)
      ? 'content'
      : 'ignore'
  }
  return 'content'
}

export const renderClaudeChatWindow = (
  records: ClaudeTranscriptMessage[],
  options: RenderOptions,
  window: ProviderChatTurnWindow
): { items: ProviderChatItem[]; itemsStartTurnIndex: number; turnCount: number } =>
  renderNativeTurnWindow(records, options, window, classifyClaudeTurnRecord, (selected, settings) =>
    renderClaudeChatItems(selected, { ...settings, turnWindow: undefined })
  )

export const findClaudeItemTurnWindow = (
  records: ClaudeTranscriptMessage[],
  itemId: string,
  limit: number
): ProviderChatTurnWindow | null =>
  findNativeItemTurnWindow(
    records,
    itemId,
    limit,
    classifyClaudeTurnRecord,
    (message) => message.uuid
  )
