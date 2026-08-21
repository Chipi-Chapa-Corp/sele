import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Message, Part } from '@opencode-ai/sdk/v2'
import type {
  ProviderChatItem,
  ProviderFileDiff,
  ProviderMessageAttachment,
  ProviderToolActivity,
  ProviderWorkingItem,
  ProviderWorkingTool
} from '../../../shared/provider'

export type OpenCodeMessageWithParts = {
  info: Message
  parts: Part[]
}

type RenderOptions = {
  active: boolean
  stopped: boolean
  pendingItems?: ProviderChatItem[]
}

type AssistantText = {
  id: string
  content: string
  createdAt: number | null
  model: string | null
}

type SegmentEntry =
  { kind: 'working'; item: ProviderWorkingItem } | { kind: 'assistant'; message: AssistantText }

type Segment = {
  id: string
  entries: SegmentEntry[]
  completed: boolean
}

const maxToolOutputLength = 160_000
const maxRawToolValueLength = 80_000
const truncatedMarker = '… [truncated to keep the app responsive]'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

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

const getAssistantModel = (info: Message): string | null =>
  info.role === 'assistant' ? `${info.providerID}/${info.modelID}` : null

export const renderOpenCodeChatItems = (
  messages: OpenCodeMessageWithParts[],
  options: RenderOptions
): ProviderChatItem[] => {
  const items: ProviderChatItem[] = []
  let segment: Segment | null = null

  const ensureSegment = (id: string): Segment => {
    if (!segment) segment = { id: `${id}:working`, entries: [], completed: false }
    return segment
  }

  const flushSegment = (isLast: boolean): void => {
    if (!segment) return
    const current = segment
    segment = null
    const finalEntry = current.entries.at(-1)
    const finalMessage = finalEntry?.kind === 'assistant' ? finalEntry.message : null
    const workingEntries = finalMessage ? current.entries.slice(0, -1) : current.entries
    const workingItems = workingEntries.map((entry): ProviderWorkingItem =>
      entry.kind === 'working'
        ? entry.item
        : { type: 'message', id: entry.message.id, content: entry.message.content }
    )
    const isWorking = isLast && options.active && !current.completed

    if (workingItems.length > 0 || isWorking) {
      items.push({
        type: 'working',
        id: current.id,
        status: isWorking ? 'working' : options.stopped && isLast ? 'stopped' : 'worked',
        items: workingItems
      })
    }
    if (finalMessage) {
      items.push({
        type: 'message',
        id: finalMessage.id,
        role: 'assistant',
        content: finalMessage.content,
        createdAt: finalMessage.createdAt,
        model: finalMessage.model
      })
    }
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
      segment = { id: `${message.info.id}:working`, entries: [], completed: false }
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
            id: part.id,
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
            content: `Retry ${part.attempt}: ${part.error.data.message}`
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
      const errorData = 'data' in message.info.error ? message.info.error.data : null
      current.entries.push({
        kind: 'working',
        item: {
          type: 'message',
          id: `${message.info.id}:error`,
          content:
            getString(isRecord(errorData) ? errorData.message : null) ?? message.info.error.name
        }
      })
    }
    if (messageIndex === messages.length - 1) flushSegment(true)
  })

  flushSegment(true)
  if (options.pendingItems?.length) items.push(...options.pendingItems)
  return items
}
