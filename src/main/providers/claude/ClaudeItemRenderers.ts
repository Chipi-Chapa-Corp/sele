import { basename } from 'node:path'
import type {
  ProviderChatItem,
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

type RenderOptions = {
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
  } catch {
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

const createTool = (messageId: string, block: ClaudeContentBlock): ProviderWorkingTool => {
  const toolId = getString(block.id) ?? `${messageId}:tool`
  const name = getString(block.name) ?? 'Tool'
  return {
    type: 'tool',
    id: `${messageId}:${toolId}`,
    toolId,
    status: 'running',
    activity: classifyTool(name, block.input),
    icon: name === 'AskUserQuestion' ? 'question' : name === 'TodoWrite' ? 'plan' : null,
    label: getToolLabel(name, block.input),
    command: getToolCommand(block.input),
    cwd: getToolCwd(block.input),
    stdout: null,
    diffs: [],
    backgroundSessionId: null,
    finishedBackgroundSessionId: null,
    rawInput: name === 'AskUserQuestion' ? null : getBoundedRawValue(block.input ?? null),
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

const hasToolResults = (blocks: ClaudeContentBlock[]): boolean =>
  blocks.some((block) => block.type === 'tool_result')

const interruptedRequestMarker = '[Request interrupted by user]'
const localCommandOutputPattern =
  /^<local-command-(?:stdout|stderr)>[\s\S]*<\/local-command-(?:stdout|stderr)>$/

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

export const isClaudeInternalUserMessage = (message: ClaudeTranscriptMessage): boolean => {
  const text = getStandaloneUserText(message)
  return text === interruptedRequestMarker || (text != null && localCommandOutputPattern.test(text))
}

const getModel = (message: unknown): string | null => getString(getMessageRecord(message)?.model)

export const renderClaudeChatItems = (
  messages: ClaudeTranscriptMessage[],
  options: RenderOptions
): ProviderChatItem[] => {
  const items: ProviderChatItem[] = []
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
    // Claude persists interrupt markers and local command output as user-role
    // transcript records. They are control metadata, not text entered by the person.
    if (isClaudeInternalUserMessage(message)) continue

    const blocks = getContentBlocks(message.message)
    const isSubagentMessage = Boolean(message.parent_tool_use_id)

    if (isSubagentMessage && message.type === 'user' && !hasToolResults(blocks)) continue

    if (message.type === 'user' && !hasToolResults(blocks)) {
      const content = getHumanText(blocks)
      if (!content && !message.attachments?.length) continue
      flushSegment(false)
      items.push({
        type: 'message',
        id: message.uuid,
        role: 'user',
        content,
        attachments: message.attachments?.length ? message.attachments : undefined,
        createdAt: toTimestamp(message.timestamp),
        kind: message.kind,
        label: message.label ?? null
      })
      segment = { id: `${message.uuid}:working`, entries: [], failed: false }
      continue
    }

    if (message.type === 'assistant') {
      const current = ensureSegment(message.uuid)
      blocks.forEach((block, blockIndex) => {
        if (
          block.type === 'thinking' &&
          typeof block.thinking === 'string' &&
          block.thinking.trim()
        ) {
          current.entries.push({
            kind: 'working',
            item: {
              type: 'message',
              id: `${message.uuid}:thinking:${blockIndex}`,
              content: block.thinking.trim()
            }
          })
        } else if (block.type === 'tool_use') {
          const inputReady =
            !message.uuid.endsWith(':partial') ||
            (isRecord(block.input) && Object.keys(block.input).length > 0)
          if (inputReady) {
            current.entries.push({ kind: 'working', item: createTool(message.uuid, block) })
          }
        } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          if (isSubagentMessage) {
            current.entries.push({
              kind: 'working',
              item: {
                type: 'message',
                id: `${message.uuid}:subagent:${blockIndex}`,
                content: block.text.trim()
              }
            })
          } else {
            current.entries.push({
              kind: 'assistant',
              message: {
                type: 'message',
                id: blocks.length === 1 ? message.uuid : `${message.uuid}:text:${blockIndex}`,
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
        updateTool(current.entries, toolId, (tool) => ({
          ...tool,
          status: 'finished',
          label: tool.icon === 'question' ? 'Asked a question' : tool.label,
          icon: images.length > 0 ? 'image-generation' : tool.icon,
          stdout: tool.icon === 'question' ? null : output,
          diffs: tool.icon === 'question' ? [] : getToolDiffs(tool, output),
          rawOutput:
            tool.icon === 'question'
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
