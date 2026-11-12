import { isProviderUsageLimitError } from '../../../shared/providerErrors.ts'
import { includeConversationTime, type ConversationTiming } from '../conversationTiming.ts'
import { getTranscriptRecordChange } from '../transcriptProjection/recordChanges.ts'
import {
  createPresentedTool,
  createSubagentTool,
  getProviderToolPresentation
} from '../ToolPresentation.ts'
import {
  findNativeItemTurnWindow,
  renderNativeTurnWindow,
  type TranscriptRenderWindow
} from '../transcriptProjection/turnWindow.ts'
import type { ProviderChatTurnWindow } from '../ProviderAdapter'
import { basename } from 'node:path'
import type { SessionEvent } from '@github/copilot-sdk'
import type {
  ProviderChatItem,
  ProviderChatTurnOutcome,
  ProviderFileDiff,
  ProviderMessage,
  ProviderMessageAttachment,
  ProviderToolImage,
  ProviderWorkingItem,
  ProviderWorkingTool
} from '../../../shared/provider'
import {
  appendProviderConversationSegment,
  updateConversationTool,
  type ProviderConversationEntry
} from '../ProviderConversationEngine.ts'
import {
  getString,
  getBoundedRawToolValue,
  getToolArgument,
  truncateEarlierToolOutput,
  truncatedToolValueMarker
} from '../providerValues.ts'

type ToolStartEvent = Extract<SessionEvent, { type: 'tool.execution_start' }>
type ToolCompleteEvent = Extract<SessionEvent, { type: 'tool.execution_complete' }>
type UserMessageEvent = Extract<SessionEvent, { type: 'user.message' }>
type AssistantMessageEvent = Extract<SessionEvent, { type: 'assistant.message' }>
type TaskCompleteEvent = Extract<SessionEvent, { type: 'session.task_complete' }>
type FinalMessageEvent = AssistantMessageEvent | TaskCompleteEvent

export type CopilotRenderedPlan = {
  explanation: string | null
  items: Array<{
    step: string
    status: 'pending' | 'in_progress' | 'completed'
  }>
}

type RenderOptions = TranscriptRenderWindow & {
  binaryAssets?: ReadonlyMap<string, CopilotBinaryAsset>
  agentId?: string | null
  active: boolean
  stopped: boolean
  failed?: boolean
  pendingItems?: ProviderChatItem[]
  plan?: CopilotRenderedPlan | null
}

type Segment = {
  timing?: ConversationTiming
  id: string
  entries: ProviderConversationEntry[]
  failed: boolean
  failureMessage?: string
  failureReason?: 'rateLimit'
  stopped?: boolean
}

const truncatedEarlierToolOutputMarker = `${truncatedToolValueMarker}\n`
const skillContextMessagePattern = /^<skill-context(?:\s[^>]*)?>[\s\S]*<\/skill-context>$/
const imageFileExtensionPattern = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i

export const isCopilotSystemContextMessage = (event: UserMessageEvent): boolean => {
  const source = event.data.source?.trim().toLocaleLowerCase()
  return (
    source === 'skill' ||
    source?.startsWith('skill-') === true ||
    skillContextMessagePattern.test(event.data.content.trim())
  )
}

export const appendCopilotToolOutput = (
  currentValue: string | null,
  appendedValue: string
): string => {
  const current = currentValue?.startsWith(truncatedEarlierToolOutputMarker)
    ? currentValue.slice(truncatedEarlierToolOutputMarker.length)
    : (currentValue ?? '')
  return truncateEarlierToolOutput(`${current}${appendedValue}`) ?? ''
}

const toTimestamp = (value: string): number | null => {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

// The delegation call is a compact row in the parent. The subagent's prompt and report belong to
// its own chat, listed under the parent in the sidebar.
const createTool = (event: ToolStartEvent, subagent: boolean): ProviderWorkingTool => {
  const { toolCallId, toolName, mcpServerName, mcpToolName } = event.data
  if (subagent)
    return createSubagentTool(
      event.id,
      toolCallId,
      getToolArgument(event.data.arguments, 'description', 'agent_type', 'agentType') ?? 'Subagent'
    )
  return createPresentedTool(
    getProviderToolPresentation('copilot', toolName, event.data.arguments, {
      serverName: mcpServerName,
      mcpToolName
    }),
    {
      id: event.id,
      mcpApp: mcpServerName
        ? {
            callId: toolCallId,
            serverName: mcpServerName,
            resourceUri: event.data.toolDescription?._meta?.ui?.resourceUri
          }
        : undefined,
      toolId: toolCallId,
      status: 'running',
      cwd: getToolArgument(event.data.arguments, 'cwd', 'workingDirectory', 'directory'),
      fallbackLabel: `Used ${mcpServerName ? `${mcpServerName}/` : ''}${mcpToolName || toolName}`,
      rawInput: () => getBoundedRawToolValue(event.data.arguments ?? null)
    }
  )
}

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

const getAttachments = (
  event: Extract<SessionEvent, { type: 'user.message' }>
): ProviderMessageAttachment[] => {
  return (event.data.attachments ?? []).flatMap((attachment): ProviderMessageAttachment[] => {
    if (attachment.type === 'file') {
      const image =
        attachment.mimeType?.startsWith('image/') === true ||
        imageFileExtensionPattern.test(attachment.path)
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

const isScopedEvent = (event: SessionEvent, agentId: string | null | undefined): boolean =>
  agentId ? event.agentId === agentId : !event.agentId

/** Undefined asks a backward journal reader for the preceding page of this same turn. */
export const getCopilotTurnOutcome = (
  events: SessionEvent[]
): ProviderChatTurnOutcome | null | undefined => {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (!isScopedEvent(event, null)) continue
    if (event.type === 'session.error') return 'failed'
    if (event.type === 'abort' || (event.type === 'session.idle' && event.data.aborted))
      return 'stopped'
    if (
      event.type === 'assistant.turn_start' ||
      (event.type === 'user.message' && !isCopilotSystemContextMessage(event))
    )
      return null
  }
  return undefined
}

const hasRenderableWorkingEvent = (event: SessionEvent): boolean => {
  if (event.type === 'assistant.reasoning') return Boolean(event.data.content.trim())
  if (event.type === 'assistant.intent') return Boolean(event.data.intent.trim())
  if (event.type === 'tool.execution_start' || event.type === 'session.error') return true
  if (event.type !== 'assistant.message') return false

  return Boolean(
    event.data.reasoningText?.trim() ||
      event.data.toolRequests?.length ||
      (event.data.phase === 'commentary' && event.data.content.trim())
  )
}

const getFinalMessageIndex = (events: SessionEvent[], completed: boolean): number => {
  const explicitFinalIndex = events.findLastIndex(
    (event) =>
      (event.type === 'assistant.message' &&
        event.data.phase === 'final_answer' &&
        Boolean(event.data.content.trim())) ||
      (event.type === 'session.task_complete' &&
        event.data.success !== false &&
        Boolean(event.data.summary?.trim()))
  )
  const fallbackFinalIndex = events.findLastIndex(
    (event) =>
      event.type === 'assistant.message' &&
      event.data.phase !== 'commentary' &&
      !event.data.toolRequests?.length &&
      Boolean(event.data.content.trim())
  )
  const terminalFallbackIndex =
    fallbackFinalIndex >= 0 &&
    (completed || !events.slice(fallbackFinalIndex + 1).some(hasRenderableWorkingEvent))
      ? fallbackFinalIndex
      : -1

  return Math.max(explicitFinalIndex, terminalFallbackIndex)
}

const getFinalMessageEvents = (
  events: SessionEvent[],
  agentId: string | null | undefined
): ReadonlySet<SessionEvent> => {
  const finalEvents = new Set<SessionEvent>()
  let segmentEvents: SessionEvent[] = []
  const flushSegment = (): void => {
    const completed = segmentEvents.some(
      (event) => event.type === 'assistant.turn_end' || event.type === 'session.task_complete'
    )
    const finalMessageIndex = getFinalMessageIndex(segmentEvents, completed)
    if (finalMessageIndex >= 0 && segmentEvents[finalMessageIndex]) {
      finalEvents.add(segmentEvents[finalMessageIndex])
    }
    segmentEvents = []
  }

  events.forEach((event) => {
    if (!isScopedEvent(event, agentId)) return
    if (event.type === 'user.message') {
      if (isCopilotSystemContextMessage(event)) return
      flushSegment()
      return
    }
    segmentEvents.push(event)
  })
  flushSegment()
  return finalEvents
}

export const renderCopilotChatItems = (
  events: SessionEvent[],
  options: RenderOptions
): ProviderChatItem[] => {
  if (options.turnWindow) return renderCopilotChatWindow(events, options, options.turnWindow).items
  const items: ProviderChatItem[] = []
  const askUserToolCallIds = new Set<string>()
  const binaryAssets = new Map<string, CopilotBinaryAsset>(options.binaryAssets)
  const finalMessageEvents = getFinalMessageEvents(events, options.agentId)
  let segment: Segment | null = null
  let eventTimestamp: number | null = null

  events.forEach((event) => {
    if (event.type === 'session.binary_asset') binaryAssets.set(event.data.assetId, event.data)
  })

  const ensureSegment = (eventId: string): Segment => {
    if (!segment) {
      segment = {
        id: `${eventId}:working`,
        timing: includeConversationTime(undefined, eventTimestamp),
        entries: [],
        failed: false
      }
    }
    return segment
  }

  const appendWorkingItem = (currentSegment: Segment, item: ProviderWorkingItem): void => {
    currentSegment.entries.push({ kind: 'working', item })
  }

  const createAssistantMessage = (event: FinalMessageEvent): ProviderMessage =>
    event.type === 'assistant.message'
      ? {
          type: 'message',
          id: event.data.messageId || event.id,
          role: 'assistant',
          content: event.data.content.trim(),
          createdAt: toTimestamp(event.timestamp),
          model: event.data.model ?? null
        }
      : {
          type: 'message',
          id: event.id,
          role: 'assistant',
          content: event.data.summary?.trim() ?? '',
          createdAt: toTimestamp(event.timestamp),
          model: null
        }

  const flushSegment = (isLast: boolean): void => {
    if (!segment) return

    const currentSegment = segment
    segment = null
    const failed = currentSegment.failed || (isLast && options.failed === true)
    const stopped = currentSegment.stopped === true || (isLast && options.stopped)
    const finalMessageIndex = currentSegment.entries.findLastIndex(
      (entry) => entry.kind === 'assistant'
    )
    appendProviderConversationSegment(items, {
      preserveRawWorkingItems: true,
      id: currentSegment.id,
      timing: currentSegment.timing,
      entries: currentSegment.entries,
      finalMessageIndex,
      lifecycle: {
        active: isLast && options.active,
        completed: !isLast || (!options.active && !failed && !(isLast && options.stopped)),
        failed,
        stopped
      },
      showWorking:
        currentSegment.entries.some((entry) => entry.kind === 'working') ||
        (isLast && options.active) ||
        failed ||
        stopped,
      ...(failed && currentSegment.failureReason
        ? { failureReason: currentSegment.failureReason }
        : {}),
      ...(failed && currentSegment.failureMessage
        ? { failureMessage: currentSegment.failureMessage }
        : {})
    })
  }

  // Copilot delegates through its task tool; subagent.started links any other spawning call.
  const subagentToolCallIds = new Set(
    events.flatMap((event) => (event.type === 'subagent.started' ? [event.data.toolCallId] : []))
  )
  const isSubagentToolCall = (event: ToolStartEvent): boolean =>
    (!event.data.mcpServerName && event.data.toolName === 'task') ||
    subagentToolCallIds.has(event.data.toolCallId)
  const hiddenOutputToolCallIds = new Set<string>()

  for (const event of events) {
    if (!isScopedEvent(event, options.agentId)) continue
    eventTimestamp = toTimestamp(event.timestamp)

    if (event.type === 'user.message') {
      if (isCopilotSystemContextMessage(event)) continue
      flushSegment(false)
      const attachments = getAttachments(event)
      items.push({
        type: 'message',
        id: event.id,
        role: 'user',
        content: event.data.content,
        attachments: attachments.length > 0 ? attachments : undefined,
        createdAt: toTimestamp(event.timestamp),
        kind: event.data.delivery === 'steering' ? 'steering' : undefined,
        label: event.data.delivery === 'steering' ? 'Steering with' : null
      })
      segment = {
        id: `${event.id}:working`,
        timing: includeConversationTime(undefined, toTimestamp(event.timestamp)),
        entries: [],
        failed: false
      }
      continue
    }

    if (segment) segment.timing = includeConversationTime(segment.timing, eventTimestamp)

    if (event.type === 'assistant.reasoning') {
      const content = event.data.content.trim()
      if (content) {
        appendWorkingItem(ensureSegment(event.id), {
          type: 'message',
          id: event.id,
          content
        })
      }
      continue
    }

    if (event.type === 'assistant.intent') {
      const content = event.data.intent.trim()
      if (content) {
        const currentSegment = ensureSegment(event.id)
        const previousIntentIndex = currentSegment.entries.findIndex(
          (entry) => entry.kind === 'working' && entry.item.id === 'copilot:intent'
        )
        const intent = { type: 'message' as const, id: 'copilot:intent', content }
        if (previousIntentIndex >= 0) {
          currentSegment.entries[previousIntentIndex] = { kind: 'working', item: intent }
        } else {
          appendWorkingItem(currentSegment, intent)
        }
      }
      continue
    }

    if (event.type === 'assistant.message') {
      const currentSegment = ensureSegment(event.id)
      if (event.data.reasoningText?.trim()) {
        appendWorkingItem(currentSegment, {
          type: 'message',
          id: `${event.id}:reasoning`,
          content: event.data.reasoningText.trim()
        })
      }
      const content = event.data.content.trim()
      if (content) {
        if (finalMessageEvents.has(event)) {
          currentSegment.entries.push({ kind: 'assistant', message: createAssistantMessage(event) })
        } else {
          appendWorkingItem(currentSegment, {
            type: 'message',
            id: event.id,
            content
          })
        }
      }
      continue
    }

    if (event.type === 'tool.execution_start') {
      const tool = createTool(event, isSubagentToolCall(event))
      if (tool.icon === 'question') askUserToolCallIds.add(event.data.toolCallId)
      if (tool.icon === 'subagent') subagentToolCallIds.add(event.data.toolCallId)
      if (tool.hidePayload || tool.icon === 'subagent')
        hiddenOutputToolCallIds.add(event.data.toolCallId)
      appendWorkingItem(ensureSegment(event.id), tool)
      continue
    }

    if (event.type === 'tool.execution_partial_result') {
      if (
        askUserToolCallIds.has(event.data.toolCallId) ||
        hiddenOutputToolCallIds.has(event.data.toolCallId)
      )
        continue
      updateConversationTool(ensureSegment(event.id).entries, event.data.toolCallId, (tool) => ({
        ...tool,
        stdout: appendCopilotToolOutput(tool.stdout, event.data.partialOutput)
      }))
      continue
    }

    if (event.type === 'tool.execution_progress') {
      if (
        askUserToolCallIds.has(event.data.toolCallId) ||
        hiddenOutputToolCallIds.has(event.data.toolCallId)
      )
        continue
      updateConversationTool(ensureSegment(event.id).entries, event.data.toolCallId, (tool) => ({
        ...tool,
        label: event.data.progressMessage.trim() || tool.label
      }))
      continue
    }

    if (event.type === 'tool.execution_complete') {
      const askedQuestion = askUserToolCallIds.has(event.data.toolCallId)
      const hide = hiddenOutputToolCallIds.has(event.data.toolCallId) || askedQuestion
      const images =
        askedQuestion || subagentToolCallIds.has(event.data.toolCallId)
          ? []
          : getToolImages(event, binaryAssets)
      updateConversationTool(ensureSegment(event.id).entries, event.data.toolCallId, (tool) => ({
        ...tool,
        status: 'finished',
        label: askedQuestion ? 'Asked a question' : tool.label,
        icon: images.length > 0 ? 'image-generation' : tool.icon,
        stdout: hide ? null : truncateEarlierToolOutput(getToolOutput(event)),
        diffs: hide ? [] : getToolDiffs(tool, event),
        rawOutput: hide
          ? null
          : getBoundedRawToolValue(event.data.result ?? event.data.error ?? null),
        images,
        ...(tool.mcpApp
          ? {
              mcpApp: {
                ...tool.mcpApp,
                resourceUri:
                  event.data.toolDescription?._meta?.ui?.resourceUri ||
                  event.data.result?.uiResource?.uri ||
                  tool.mcpApp.resourceUri
              }
            }
          : {})
      }))
      continue
    }

    if (event.type === 'session.task_complete') {
      if (finalMessageEvents.has(event)) {
        ensureSegment(event.id).entries.push({
          kind: 'assistant',
          message: createAssistantMessage(event)
        })
      }
      continue
    }

    if (event.type === 'abort') {
      // A user abort marks its turn as stopped; the event itself carries nothing to show.
      if (segment) segment.stopped = true
      continue
    }

    if (event.type === 'session.error') {
      const currentSegment = ensureSegment(event.id)
      currentSegment.failed = true
      currentSegment.failureMessage = event.data.message
      currentSegment.failureReason = isProviderUsageLimitError(event.data) ? 'rateLimit' : undefined
      appendWorkingItem(currentSegment, {
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
    appendWorkingItem(ensureSegment('copilot:plan'), {
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

export const classifyCopilotTurnRecord = (
  message: SessionEvent
): 'start' | 'content' | 'ignore' => {
  if (!isScopedEvent(message, null)) return 'ignore'
  if (message.type === 'user.message')
    return isCopilotSystemContextMessage(message) ? 'ignore' : 'start'
  return message.type === 'assistant.message' ||
    message.type === 'assistant.reasoning' ||
    message.type === 'assistant.intent' ||
    message.type.startsWith('tool.execution_') ||
    message.type === 'session.error' ||
    message.type === 'abort' ||
    message.type === 'session.compaction_complete' ||
    message.type === 'session.task_complete'
    ? 'content'
    : 'ignore'
}

const binaryAssetIndexes = new WeakMap<
  SessionEvent[],
  { length: number; assets: Map<string, CopilotBinaryAsset> }
>()
const getBinaryAssetIndex = (records: SessionEvent[]): Map<string, CopilotBinaryAsset> => {
  const cached = binaryAssetIndexes.get(records)
  if (cached?.length === records.length) return cached.assets
  const change = getTranscriptRecordChange(records)
  const previous = change ? binaryAssetIndexes.get(change.previous as SessionEvent[]) : undefined
  // An append can inherit the asset map. Replacements rebuild because an asset may disappear.
  const append = previous && change && change.startIndex === previous.length
  const assets = new Map<string, CopilotBinaryAsset>(append ? previous.assets : undefined)
  for (let index = append ? change.startIndex : 0; index < records.length; index += 1) {
    const event = records[index]
    if (event.type === 'session.binary_asset') assets.set(event.data.assetId, event.data)
  }
  binaryAssetIndexes.set(records, { length: records.length, assets })
  return assets
}

export const renderCopilotChatWindow = (
  records: SessionEvent[],
  options: RenderOptions,
  window: ProviderChatTurnWindow
): { items: ProviderChatItem[]; itemsStartTurnIndex: number; turnCount: number } => {
  const scoped = options.agentId
    ? records.filter((event) => isScopedEvent(event, options.agentId))
    : records
  const classifier = options.agentId
    ? (event: SessionEvent) =>
        classifyCopilotTurnRecord({ ...event, agentId: undefined } as SessionEvent)
    : classifyCopilotTurnRecord
  return renderNativeTurnWindow(scoped, options, window, classifier, (selected, settings) =>
    renderCopilotChatItems(selected, {
      ...settings,
      binaryAssets: getBinaryAssetIndex(records),
      // The current plan belongs only to the current native turn, never a historical/pending-only page.
      plan: selected.length && selected.at(-1) === scoped.at(-1) ? settings.plan : null,
      turnWindow: undefined
    })
  )
}

export const findCopilotItemTurnWindow = (
  records: SessionEvent[],
  itemId: string,
  limit: number
): ProviderChatTurnWindow | null =>
  findNativeItemTurnWindow(
    records,
    itemId,
    limit,
    classifyCopilotTurnRecord,
    (message) => message.id
  )
