import { basename } from 'node:path'
import type { SessionEvent } from '@github/copilot-sdk'
import type {
  ProviderChatItem,
  ProviderFileDiff,
  ProviderMessageAttachment,
  ProviderToolActivity,
  ProviderWorkingItem,
  ProviderWorkingTool
} from '../../../shared/provider'

type ToolStartEvent = Extract<SessionEvent, { type: 'tool.execution_start' }>
type ToolCompleteEvent = Extract<SessionEvent, { type: 'tool.execution_complete' }>

type RenderOptions = {
  active: boolean
  stopped: boolean
  pendingItems?: ProviderChatItem[]
}

type Segment = {
  id: string
  workingItems: ProviderWorkingItem[]
  assistantMessages: Array<Extract<SessionEvent, { type: 'assistant.message' }>>
}

const toTimestamp = (value: string): number | null => {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

const getString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const getArgument = (
  args: Record<string, unknown | undefined> | undefined,
  ...keys: string[]
): string | null => {
  for (const key of keys) {
    const value = getString(args?.[key])
    if (value) return value
  }
  return null
}

const getToolCommand = (event: ToolStartEvent): string | null =>
  getArgument(event.data.arguments, 'command', 'cmd', 'script', 'query', 'pattern')

const getToolCwd = (event: ToolStartEvent): string | null =>
  getArgument(event.data.arguments, 'cwd', 'workingDirectory', 'directory')

const classifyTool = (event: ToolStartEvent): ProviderToolActivity => {
  const name = event.data.toolName.toLocaleLowerCase()
  const command = getToolCommand(event)?.toLocaleLowerCase() ?? ''

  if (name.includes('delete') || /\brm\b/.test(command)) return 'delete'
  if (name.includes('create')) return 'create'
  if (
    name.includes('edit') ||
    name.includes('write') ||
    name.includes('patch') ||
    name.includes('replace')
  ) {
    return 'edit'
  }
  if (name.includes('search') || name.includes('grep') || name.includes('glob')) return 'search'
  if (name.includes('read') || name.includes('view') || name.includes('list')) return 'read'
  if (name.includes('git') || /^git(?:\s|$)/.test(command)) return 'git'
  if (name.includes('npm') || /^npm(?:\s|$)/.test(command)) return 'npm'
  if (name.includes('npx') || /^npx(?:\s|$)/.test(command)) return 'npx'
  if (name.includes('shell') || name.includes('bash') || name.includes('command') || command) {
    return 'command'
  }

  return 'other'
}

const getToolPath = (event: ToolStartEvent): string | null =>
  getArgument(event.data.arguments, 'path', 'filePath', 'file', 'fileName', 'target', 'directory')

const getToolLabel = (event: ToolStartEvent): string => {
  const activity = classifyTool(event)
  const path = getToolPath(event)
  const command = getToolCommand(event)

  if (path) {
    const displayPath = basename(path) || path
    if (activity === 'read') return `Read ${displayPath}`
    if (activity === 'search') return `Search ${displayPath}`
    if (activity === 'create') return `Create ${displayPath}`
    if (activity === 'delete') return `Delete ${displayPath}`
    if (activity === 'edit') return `Edit ${displayPath}`
  }
  if (command) return command

  return (
    event.data.toolDescription?.name?.trim() ||
    event.data.mcpToolName?.trim() ||
    event.data.toolName.replace(/[_-]+/g, ' ')
  )
}

const createTool = (event: ToolStartEvent): ProviderWorkingTool => ({
  type: 'tool',
  id: event.id,
  toolId: event.data.toolCallId,
  status: 'running',
  activity: classifyTool(event),
  icon: null,
  label: getToolLabel(event),
  command: getToolCommand(event),
  agentTerminal: null,
  agentTerminalDisabledReason: 'Copilot CLI does not expose an attachable agent terminal.',
  cwd: getToolCwd(event),
  stdout: null,
  diffs: [],
  backgroundSessionId: null,
  finishedBackgroundSessionId: null,
  rawInput: event.data.arguments ?? null,
  rawOutput: null,
  images: []
})

const getToolOutput = (event: ToolCompleteEvent): string | null => {
  if (event.data.error?.message) return event.data.error.message

  const result = event.data.result
  if (!result) return null
  return getString(result.detailedContent) ?? getString(result.content)
}

const getToolDiffs = (tool: ProviderWorkingTool, event: ToolCompleteEvent): ProviderFileDiff[] => {
  const output = getToolOutput(event)
  const path =
    getString((tool.rawInput as Record<string, unknown> | null)?.path) ??
    getString((tool.rawInput as Record<string, unknown> | null)?.filePath) ??
    getString((tool.rawInput as Record<string, unknown> | null)?.fileName)
  if (!output || !path || (!output.includes('@@') && !output.includes('diff --git'))) return []

  const kind: ProviderFileDiff['kind'] =
    tool.activity === 'create' ? 'create' : tool.activity === 'delete' ? 'delete' : 'edit'
  return [{ path, kind, diff: output }]
}

const updateTool = (
  items: ProviderWorkingItem[],
  toolCallId: string,
  update: (tool: ProviderWorkingTool) => ProviderWorkingTool
): void => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.type === 'tool' && item.toolId === toolCallId) {
      items[index] = update(item)
      return
    }
    if (item?.type === 'toolGroup') {
      const toolIndex = item.tools.findIndex((tool) => tool.toolId === toolCallId)
      if (toolIndex >= 0 && item.tools[toolIndex]) {
        item.tools[toolIndex] = update(item.tools[toolIndex])
        return
      }
    }
  }
}

const getAttachments = (
  event: Extract<SessionEvent, { type: 'user.message' }>
): ProviderMessageAttachment[] => {
  return (event.data.attachments ?? []).flatMap((attachment): ProviderMessageAttachment[] => {
    if (attachment.type === 'file') {
      const image = attachment.mimeType?.startsWith('image/')
      return [
        image
          ? {
              kind: 'image',
              name: attachment.displayName || basename(attachment.path),
              path: attachment.path
            }
          : {
              kind: 'file',
              name: attachment.displayName || basename(attachment.path),
              path: attachment.path
            }
      ]
    }
    if (attachment.type === 'selection') {
      return [
        {
          kind: 'file',
          name: attachment.displayName || basename(attachment.filePath),
          path: attachment.filePath
        }
      ]
    }
    if (attachment.type === 'blob' && attachment.mimeType.startsWith('image/')) {
      return [
        {
          kind: 'image',
          name: attachment.displayName || 'Image',
          dataUrl: `data:${attachment.mimeType};base64,${attachment.data}`
        }
      ]
    }
    return []
  })
}

const isRootEvent = (event: SessionEvent): boolean => !event.agentId

export const renderCopilotChatItems = (
  events: SessionEvent[],
  options: RenderOptions
): ProviderChatItem[] => {
  const items: ProviderChatItem[] = []
  let segment: Segment | null = null

  const ensureSegment = (eventId: string): Segment => {
    if (!segment) {
      segment = {
        id: `${eventId}:working`,
        workingItems: [],
        assistantMessages: []
      }
    }
    return segment
  }

  const flushSegment = (isLast: boolean): void => {
    if (!segment) return

    const currentSegment = segment
    segment = null
    const assistantMessages = currentSegment.assistantMessages.filter((event) =>
      Boolean(event.data.content.trim())
    )
    const finalMessage = assistantMessages.at(-1)

    assistantMessages.slice(0, -1).forEach((event) => {
      currentSegment.workingItems.push({
        type: 'message',
        id: event.id,
        content: event.data.content.trim()
      })
    })

    if (currentSegment.workingItems.length > 0 || (isLast && options.active)) {
      items.push({
        type: 'working',
        id: currentSegment.id,
        status:
          isLast && options.active ? 'working' : options.stopped && isLast ? 'stopped' : 'worked',
        items: currentSegment.workingItems
      })
    }

    if (finalMessage) {
      items.push({
        type: 'message',
        id: finalMessage.data.messageId || finalMessage.id,
        role: 'assistant',
        content: finalMessage.data.content.trim(),
        createdAt: toTimestamp(finalMessage.timestamp),
        model: finalMessage.data.model ?? null
      })
    }
  }

  for (const event of events) {
    if (event.type === 'user.message' && isRootEvent(event)) {
      flushSegment(false)
      const attachments = getAttachments(event)
      items.push({
        type: 'message',
        id: event.id,
        role: 'user',
        content: event.data.content,
        attachments: attachments.length > 0 ? attachments : undefined,
        createdAt: toTimestamp(event.timestamp),
        label: event.data.delivery === 'steering' ? 'Steering with' : null
      })
      segment = {
        id: `${event.id}:working`,
        workingItems: [],
        assistantMessages: []
      }
      continue
    }

    if (event.type === 'assistant.reasoning' && isRootEvent(event)) {
      const content = event.data.content.trim()
      if (content) {
        ensureSegment(event.id).workingItems.push({
          type: 'message',
          id: event.id,
          content
        })
      }
      continue
    }

    if (event.type === 'assistant.intent' && isRootEvent(event)) {
      const content = event.data.intent.trim()
      if (content) {
        const workingItems = ensureSegment(event.id).workingItems
        const previousIntentIndex = workingItems.findIndex((item) => item.id === 'copilot:intent')
        const intent = { type: 'message' as const, id: 'copilot:intent', content }
        if (previousIntentIndex >= 0) workingItems[previousIntentIndex] = intent
        else workingItems.push(intent)
      }
      continue
    }

    if (event.type === 'assistant.message' && isRootEvent(event)) {
      const currentSegment = ensureSegment(event.id)
      if (event.data.reasoningText?.trim()) {
        currentSegment.workingItems.push({
          type: 'message',
          id: `${event.id}:reasoning`,
          content: event.data.reasoningText.trim()
        })
      }
      currentSegment.assistantMessages.push(event)
      continue
    }

    if (event.type === 'tool.execution_start') {
      ensureSegment(event.id).workingItems.push(createTool(event))
      continue
    }

    if (event.type === 'tool.execution_partial_result') {
      updateTool(ensureSegment(event.id).workingItems, event.data.toolCallId, (tool) => ({
        ...tool,
        stdout: `${tool.stdout ?? ''}${event.data.partialOutput}`
      }))
      continue
    }

    if (event.type === 'tool.execution_progress') {
      updateTool(ensureSegment(event.id).workingItems, event.data.toolCallId, (tool) => ({
        ...tool,
        label: event.data.progressMessage.trim() || tool.label
      }))
      continue
    }

    if (event.type === 'tool.execution_complete') {
      updateTool(ensureSegment(event.id).workingItems, event.data.toolCallId, (tool) => ({
        ...tool,
        status: 'finished',
        stdout: getToolOutput(event),
        diffs: getToolDiffs(tool, event),
        rawOutput: event.data.result ?? event.data.error ?? null
      }))
      continue
    }

    if (event.type === 'session.error') {
      ensureSegment(event.id).workingItems.push({
        type: 'message',
        id: event.id,
        content: event.data.message
      })
      continue
    }

    if (event.type === 'session.compaction_complete') {
      items.push({ type: 'contextCompaction', id: event.id })
    }
  }

  flushSegment(true)
  items.push(...(options.pendingItems ?? []))
  return items
}
