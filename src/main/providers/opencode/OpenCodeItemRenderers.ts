import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Message, Part } from '@opencode-ai/sdk/v2'
import type {
  ProviderChatItem,
  ProviderFileDiff,
  ProviderMessageAttachment,
  ProviderToolActivity,
  ProviderWorkingTool
} from '../../../shared/provider'
import {
  appendProviderConversationSegment,
  getTrailingAssistantEntryIndex,
  type ProviderConversationEntry
} from '../ProviderConversationEngine.ts'

export type OpenCodeMessageWithParts = {
  info: Message
  parts: Part[]
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
  completed: boolean
  failed: boolean
}

const maxToolOutputLength = 160_000
const maxRawToolValueLength = 80_000
const maxChatTitleLength = 80
const truncatedMarker = '… [truncated to keep the app responsive]'
const defaultChatTitlePattern = /^New session - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

export const getOpenCodeErrorMessage = (error: unknown): string => {
  const errorRecord = isRecord(error) ? error : null
  const errorData = isRecord(errorRecord?.data) ? errorRecord.data : null
  const message =
    getString(errorData?.message) ??
    getString(errorRecord?.message) ??
    getString(errorRecord?.name) ??
    'OpenCode request failed.'
  const normalizedMessage = message.toLocaleLowerCase()
  const finishReason = normalizedMessage.match(/provider\s+finish_reason:\s*([a-z0-9_-]+)/)?.[1]

  if (finishReason === 'network_error' || normalizedMessage === 'network_error') {
    return 'The connection to the model provider was interrupted. Check your network and try again.'
  }

  return message
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

const getToolPath = (input: unknown): string | null =>
  getArgument(input, 'filePath', 'file_path', 'path', 'file', 'directory')

const getToolCwd = (input: unknown): string | null =>
  getArgument(input, 'cwd', 'workingDirectory', 'working_directory', 'directory')

const classifyTool = (nameValue: unknown, input: unknown): ProviderToolActivity => {
  const name = getString(nameValue)?.toLocaleLowerCase() ?? ''
  const command = getToolCommand(input)?.toLocaleLowerCase() ?? ''
  if (name.includes('delete') || /\brm\b/.test(command)) return 'delete'
  if (name === 'write' || name.includes('create')) return 'create'
  if (name.includes('edit') || name.includes('patch') || name.includes('replace')) return 'edit'
  if (name.includes('grep') || name.includes('glob') || name.includes('search')) return 'search'
  if (name.includes('read') || name.includes('view') || name.includes('list')) return 'read'
  if (name.includes('git') || /^git(?:\s|$)/.test(command)) return 'git'
  if (name.includes('npm') || /^npm(?:\s|$)/.test(command)) return 'npm'
  if (name.includes('npx') || /^npx(?:\s|$)/.test(command)) return 'npx'
  if (name === 'bash' || name.includes('shell') || command) return 'command'
  return 'other'
}

const getToolLabel = (nameValue: unknown, input: unknown, title: unknown): string => {
  const name = getString(nameValue) ?? 'Tool'
  if (name === 'question') return 'Asking question'
  if (name === 'todowrite' || name === 'todo') return 'Updated plan'
  const path = getToolPath(input)
  const activity = classifyTool(name, input)
  if (path) {
    const displayPath = basename(path) || path
    if (activity === 'read') return `Read ${displayPath}`
    if (activity === 'search') return `Search ${displayPath}`
    if (activity === 'create') return `Create ${displayPath}`
    if (activity === 'delete') return `Delete ${displayPath}`
    if (activity === 'edit') return `Edit ${displayPath}`
  }
  return getToolCommand(input) ?? getString(title) ?? name.replace(/[_-]+/g, ' ')
}

const truncateOutput = (value: string | null): string | null => {
  if (value == null || value.length <= maxToolOutputLength) return value
  return `${truncatedMarker}\n${value.slice(-maxToolOutputLength)}`
}

const boundRawValue = (value: unknown): unknown => {
  try {
    const serialized = JSON.stringify(value)
    return !serialized || serialized.length <= maxRawToolValueLength
      ? value
      : `${serialized.slice(0, maxRawToolValueLength)}\n${truncatedMarker}`
  } catch {
    return String(value)
  }
}

const getToolDiffs = (
  activity: ProviderToolActivity,
  input: unknown,
  metadata: unknown,
  output: string | null
): ProviderFileDiff[] => {
  const metadataRecord = isRecord(metadata) ? metadata : null
  const diff =
    getString(metadataRecord?.diff) ??
    getString(metadataRecord?.patch) ??
    (output?.includes('diff --git') || output?.includes('@@') ? output : null)
  const path =
    getToolPath(input) ?? getString(metadataRecord?.path) ?? getString(metadataRecord?.file)
  if (!diff || !path) return []
  return [
    {
      path,
      kind: activity === 'create' ? 'create' : activity === 'delete' ? 'delete' : 'edit',
      diff
    }
  ]
}

const renderTool = (part: Extract<Part, { type: 'tool' }>): ProviderWorkingTool => {
  const state = part.state
  const finished = state.status === 'completed' || state.status === 'error'
  const input = state.input
  const output =
    state.status === 'completed' ? state.output : state.status === 'error' ? state.error : null
  const metadata = 'metadata' in state ? state.metadata : null
  const activity = classifyTool(part.tool, input)
  return {
    type: 'tool',
    id: part.id,
    toolId: part.callID,
    status: finished ? 'finished' : 'running',
    activity,
    icon:
      part.tool === 'question'
        ? 'question'
        : part.tool === 'todowrite' || part.tool === 'todo'
          ? 'plan'
          : null,
    label: getToolLabel(part.tool, input, 'title' in state ? state.title : null),
    command: getToolCommand(input),
    cwd: getToolCwd(input),
    stdout: truncateOutput(output),
    diffs: getToolDiffs(activity, input, metadata, output),
    backgroundSessionId: null,
    finishedBackgroundSessionId: null,
    rawInput: part.tool === 'question' ? null : boundRawValue(input),
    rawOutput: boundRawValue(output),
    images: []
  }
}

const filePartPath = (part: Extract<Part, { type: 'file' }>): string | null => {
  if (part.source && (part.source.type === 'file' || part.source.type === 'symbol')) {
    return part.source.path
  }
  if (!part.url.startsWith('file:')) return null
  try {
    return fileURLToPath(part.url)
  } catch {
    return null
  }
}

const getAttachments = (parts: Part[]): ProviderMessageAttachment[] =>
  parts.flatMap((part): ProviderMessageAttachment[] => {
    if (part.type !== 'file') return []
    const path = filePartPath(part)
    const name = part.filename || (path ? basename(path) : 'Attachment')
    if (part.mime.startsWith('image/')) {
      return [
        {
          kind: 'image',
          name,
          path,
          dataUrl: part.url.startsWith('data:') ? part.url : null
        }
      ]
    }
    return [{ kind: 'file', name, path }]
  })

const getUserText = (parts: Part[]): string =>
  parts
    .flatMap((part): string[] =>
      part.type === 'text' && !part.synthetic && !part.ignored ? [part.text] : []
    )
    .join('\n')
    .trim()

export const getOpenCodeDisplayTitle = (
  title: string,
  messages: OpenCodeMessageWithParts[]
): string => {
  if (!defaultChatTitlePattern.test(title)) return title
  const firstUserMessage = messages.find((message) => message.info.role === 'user')
  const firstUserText = getUserText(firstUserMessage?.parts ?? [])
    .replace(/\s+/g, ' ')
    .trim()
  if (!firstUserText) return title
  return firstUserText.length <= maxChatTitleLength
    ? firstUserText
    : `${firstUserText.slice(0, maxChatTitleLength - 1).trimEnd()}…`
}

const getAssistantModel = (info: Message): string | null =>
  info.role === 'assistant' ? `${info.providerID}/${info.modelID}` : null

export const renderOpenCodeChatItems = (
  messages: OpenCodeMessageWithParts[],
  options: RenderOptions
): ProviderChatItem[] => {
  const items: ProviderChatItem[] = []
  let segment: Segment | null = null

  const ensureSegment = (id: string): Segment => {
    if (!segment) segment = { id: `${id}:working`, entries: [], completed: false, failed: false }
    return segment
  }

  const flushSegment = (isLast: boolean): void => {
    if (!segment) return
    const current = segment
    segment = null
    const isWorking = isLast && options.active && !current.completed
    const failed = current.failed || (isLast && options.failed === true)
    appendProviderConversationSegment(items, {
      id: current.id,
      entries: current.entries,
      finalMessageIndex: getTrailingAssistantEntryIndex(current.entries),
      lifecycle: {
        active: isWorking,
        completed: current.completed || (!isLast && !failed),
        failed,
        stopped: isLast && options.stopped
      },
      keepActiveAfterFinal: isWorking
    })
  }

  messages.forEach((message, messageIndex) => {
    if (message.info.role === 'user') {
      flushSegment(false)
      const content = getUserText(message.parts)
      const attachments = getAttachments(message.parts)
      if (content || attachments.length > 0) {
        items.push({
          type: 'message',
          id: message.info.id,
          role: 'user',
          content,
          attachments: attachments.length > 0 ? attachments : undefined,
          createdAt: message.info.time.created
        })
      }
      segment = {
        id: `${message.info.id}:working`,
        entries: [],
        completed: false,
        failed: false
      }
      return
    }

    const current = ensureSegment(message.info.id)
    current.completed = Boolean(message.info.time.completed || message.info.finish)
    message.parts.forEach((part) => {
      if (part.type === 'reasoning' && part.text.trim()) {
        current.entries.push({
          kind: 'working',
          item: { type: 'message', id: part.id, content: part.text.trim() }
        })
      } else if (part.type === 'tool') {
        current.entries.push({ kind: 'working', item: renderTool(part) })
      } else if (part.type === 'text' && !part.synthetic && !part.ignored && part.text.trim()) {
        current.entries.push({
          kind: 'assistant',
          message: {
            type: 'message',
            id: part.id,
            role: 'assistant',
            content: part.text.trim(),
            createdAt: part.time?.start ?? message.info.time.created,
            model: getAssistantModel(message.info)
          }
        })
      } else if (part.type === 'retry') {
        current.entries.push({
          kind: 'working',
          item: {
            type: 'message',
            id: part.id,
            content: `Retry ${part.attempt}: ${getOpenCodeErrorMessage(part.error)}`
          }
        })
      } else if (part.type === 'compaction') {
        flushSegment(false)
        items.push({ type: 'contextCompaction', id: part.id })
      } else if (part.type === 'subtask') {
        current.entries.push({
          kind: 'working',
          item: {
            type: 'tool',
            id: part.id,
            toolId: part.id,
            status: 'finished',
            activity: 'other',
            icon: null,
            label: part.description || `Run ${part.agent}`,
            command: null,
            cwd: null,
            stdout: null,
            diffs: [],
            backgroundSessionId: null,
            finishedBackgroundSessionId: null,
            rawInput: { prompt: part.prompt, agent: part.agent },
            rawOutput: null,
            images: []
          }
        })
      }
    })
    if (message.info.error) {
      current.failed = true
      current.entries.push({
        kind: 'working',
        item: {
          type: 'message',
          id: `${message.info.id}:error`,
          content: getOpenCodeErrorMessage(message.info.error)
        }
      })
    }
    if (messageIndex === messages.length - 1) flushSegment(true)
  })

  flushSegment(true)
  if (options.pendingItems?.length) items.push(...options.pendingItems)
  return items
}
