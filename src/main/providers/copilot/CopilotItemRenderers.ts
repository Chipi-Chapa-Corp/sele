import { basename } from 'node:path'
import type { SessionEvent } from '@github/copilot-sdk'
import type {
  ProviderChatItem,
  ProviderFileDiff,
  ProviderMessageAttachment,
  ProviderToolActivity,
  ProviderToolImage,
  ProviderWorkingItem,
  ProviderWorkingTool
} from '../../../shared/provider'

type ToolStartEvent = Extract<SessionEvent, { type: 'tool.execution_start' }>
type ToolCompleteEvent = Extract<SessionEvent, { type: 'tool.execution_complete' }>

export type CopilotRenderedPlan = {
  explanation: string | null
  items: Array<{
    step: string
    status: 'pending' | 'in_progress' | 'completed'
  }>
}

type RenderOptions = {
  active: boolean
  stopped: boolean
  failed?: boolean
  pendingItems?: ProviderChatItem[]
  plan?: CopilotRenderedPlan | null
}

type Segment = {
  id: string
  workingItems: ProviderWorkingItem[]
  assistantMessages: Array<Extract<SessionEvent, { type: 'assistant.message' }>>
  failed: boolean
}

const maxToolOutputLength = 160_000
const maxRawToolValueLength = 80_000
const maxRawToolCollectionEntries = 200
const maxRawToolDepth = 8
const truncatedToolValueMarker = '… [truncated to keep the app responsive]'
const truncatedEarlierToolOutputMarker = `${truncatedToolValueMarker}\n`

export const truncateCopilotToolOutput = (value: string | null): string | null => {
  if (value == null || value.length <= maxToolOutputLength) return value
  return `${truncatedEarlierToolOutputMarker}${value.slice(-maxToolOutputLength)}`
}

export const appendCopilotToolOutput = (
  currentValue: string | null,
  appendedValue: string
): string => {
  const current = currentValue?.startsWith(truncatedEarlierToolOutputMarker)
    ? currentValue.slice(truncatedEarlierToolOutputMarker.length)
    : (currentValue ?? '')
  return truncateCopilotToolOutput(`${current}${appendedValue}`) ?? ''
}

type RawToolValueBudget = {
  remaining: number
  seen: WeakSet<object>
}

export const getBoundedCopilotRawToolValue = (
  value: unknown,
  budget: RawToolValueBudget = {
    remaining: maxRawToolValueLength,
    seen: new WeakSet<object>()
  },
  depth = 0
): unknown => {
  if (typeof value === 'string') {
    if (value.length <= budget.remaining) {
      budget.remaining -= value.length
      return value
    }

    const visibleValue = value.slice(0, Math.max(0, budget.remaining))
    budget.remaining = 0
    return `${visibleValue}\n${truncatedToolValueMarker}`
  }
  if (
    value == null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value
  }
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return String(value)
  }
  if (depth >= maxRawToolDepth || budget.remaining <= 0) return truncatedToolValueMarker
  if (budget.seen.has(value)) return '[Circular]'
  budget.seen.add(value)

  if (Array.isArray(value)) {
    const boundedValue: unknown[] = []
    const entryLimit = Math.min(value.length, maxRawToolCollectionEntries)
    for (let index = 0; index < entryLimit && budget.remaining > 0; index += 1) {
      budget.remaining -= 1
      boundedValue.push(getBoundedCopilotRawToolValue(value[index], budget, depth + 1))
    }
    if (entryLimit < value.length || budget.remaining <= 0) {
      boundedValue.push(truncatedToolValueMarker)
    }
    return boundedValue
  }

  const boundedValue: Record<string, unknown> = {}
  const entries = Object.entries(value as Record<string, unknown>)
  const entryLimit = Math.min(entries.length, maxRawToolCollectionEntries)
  for (let index = 0; index < entryLimit && budget.remaining > 0; index += 1) {
    const [key, entryValue] = entries[index]
    budget.remaining -= key.length + 1
    boundedValue[key] = getBoundedCopilotRawToolValue(entryValue, budget, depth + 1)
  }
  if (entryLimit < entries.length || budget.remaining <= 0) {
    boundedValue.__truncated__ = truncatedToolValueMarker
  }
  return boundedValue
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
  if (event.data.toolName === 'ask_user') return 'Asking question'

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
  icon: event.data.toolName === 'ask_user' ? 'question' : null,
  label: getToolLabel(event),
  command: getToolCommand(event),
  cwd: getToolCwd(event),
  stdout: null,
  diffs: [],
  backgroundSessionId: null,
  finishedBackgroundSessionId: null,
  rawInput:
    event.data.toolName === 'ask_user'
      ? null
      : getBoundedCopilotRawToolValue(event.data.arguments ?? null),
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

type CopilotBinaryAsset = Extract<SessionEvent, { type: 'session.binary_asset' }>['data']

const toToolImage = (
  data: string,
  mimeType: string,
  name?: string | null
): ProviderToolImage | null => {
  if (!data || !mimeType.startsWith('image/')) return null
  return {
    dataUrl: `data:${mimeType};base64,${data}`,
    name: name?.trim() || 'Generated image'
  }
}

const getToolImages = (
  event: ToolCompleteEvent,
  binaryAssets: ReadonlyMap<string, CopilotBinaryAsset>
): ProviderToolImage[] => {
  const result = event.data.result
  if (!result) return []

  const images: ProviderToolImage[] = []
  const addImage = (image: ProviderToolImage | null): void => {
    if (!image?.dataUrl) return
    if (images.some((existing) => existing.dataUrl === image.dataUrl)) return
    images.push(image)
  }

  result.contents?.forEach((content) => {
    if (content.type === 'image') {
      addImage(toToolImage(content.data, content.mimeType))
      return
    }
    if (content.type !== 'resource' || !('blob' in content.resource)) return
    addImage(
      toToolImage(
        content.resource.blob,
        content.resource.mimeType ?? '',
        basename(content.resource.uri) || 'Generated image'
      )
    )
  })

  result.binaryResultsForLlm?.forEach((binary) => {
    if ('data' in binary) {
      addImage(toToolImage(binary.data, binary.mimeType, binary.description))
      return
    }
    if (!('assetId' in binary)) return
    const asset = binaryAssets.get(binary.assetId)
    if (!asset) return
    addImage(
      toToolImage(
        asset.data,
        asset.mimeType,
        binary.description || asset.description || 'Generated image'
      )
    )
  })

  return images
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
  const askUserToolCallIds = new Set<string>()
  const binaryAssets = new Map<string, CopilotBinaryAsset>()
  let segment: Segment | null = null

  events.forEach((event) => {
    if (event.type === 'session.binary_asset') binaryAssets.set(event.data.assetId, event.data)
  })

  const ensureSegment = (eventId: string): Segment => {
    if (!segment) {
      segment = {
        id: `${eventId}:working`,
        workingItems: [],
        assistantMessages: [],
        failed: false
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
    const failed = currentSegment.failed || (isLast && options.failed === true)

    if (currentSegment.workingItems.length > 0 || (isLast && options.active) || failed) {
      items.push({
        type: 'working',
        id: currentSegment.id,
        status:
          isLast && options.active
            ? 'working'
            : failed
              ? 'failed'
              : options.stopped && isLast
                ? 'stopped'
                : 'worked',
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
        assistantMessages: [],
        failed: false
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
      const asksQuestion = event.data.toolRequests?.some(
        (toolRequest) => toolRequest.name === 'ask_user'
      )
      const content = event.data.content.trim()
      if (asksQuestion && content) {
        currentSegment.workingItems.push({
          type: 'message',
          id: event.id,
          content
        })
      } else {
        currentSegment.assistantMessages.push(event)
      }
      continue
    }

    if (event.type === 'tool.execution_start') {
      if (event.data.toolName === 'ask_user') askUserToolCallIds.add(event.data.toolCallId)
      ensureSegment(event.id).workingItems.push(createTool(event))
      continue
    }

    if (event.type === 'tool.execution_partial_result') {
      if (askUserToolCallIds.has(event.data.toolCallId)) continue
      updateTool(ensureSegment(event.id).workingItems, event.data.toolCallId, (tool) => ({
        ...tool,
        stdout: appendCopilotToolOutput(tool.stdout, event.data.partialOutput)
      }))
      continue
    }

    if (event.type === 'tool.execution_progress') {
      if (askUserToolCallIds.has(event.data.toolCallId)) continue
      updateTool(ensureSegment(event.id).workingItems, event.data.toolCallId, (tool) => ({
        ...tool,
        label: event.data.progressMessage.trim() || tool.label
      }))
      continue
    }

    if (event.type === 'tool.execution_complete') {
      const askedQuestion = askUserToolCallIds.has(event.data.toolCallId)
      const images = askedQuestion ? [] : getToolImages(event, binaryAssets)
      updateTool(ensureSegment(event.id).workingItems, event.data.toolCallId, (tool) => ({
        ...tool,
        status: 'finished',
        label: askedQuestion ? 'Asked a question' : tool.label,
        icon: images.length > 0 ? 'image-generation' : tool.icon,
        stdout: askedQuestion ? null : truncateCopilotToolOutput(getToolOutput(event)),
        diffs: askedQuestion ? [] : getToolDiffs(tool, event),
        rawOutput: askedQuestion
          ? null
          : getBoundedCopilotRawToolValue(event.data.result ?? event.data.error ?? null),
        images
      }))
      continue
    }

    if (event.type === 'session.error') {
      const currentSegment = ensureSegment(event.id)
      currentSegment.failed = true
      currentSegment.workingItems.push({
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

  if (options.plan?.items.length) {
    ensureSegment('copilot:plan').workingItems.push({
      type: 'tool',
      id: 'copilot:plan',
      toolId: 'update_plan',
      status: 'finished',
      activity: 'other',
      icon: 'plan',
      label: 'Updated plan',
      command: null,
      cwd: null,
      stdout: null,
      diffs: [],
      backgroundSessionId: null,
      finishedBackgroundSessionId: null,
      rawInput: {
        explanation: options.plan.explanation,
        plan: options.plan.items
      },
      rawOutput: null,
      images: []
    })
  }

  flushSegment(true)
  items.push(...(options.pendingItems ?? []))
  return items
}
