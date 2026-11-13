import { isProviderUsageLimitError } from '../../../shared/providerErrors.ts'
import { includeConversationTime, type ConversationTiming } from '../conversationTiming.ts'
import { isDefaultOpenCodeTitle } from './OpenCodeChatTitle.ts'
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
import { fileURLToPath } from 'node:url'
import type { Message, Part } from '@opencode-ai/sdk/v2'
import type {
  ProviderChatItem,
  ProviderChatTurnOutcome,
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
import {
  getString,
  isRecord,
  boundSerializedToolValue,
  getToolArgument,
  truncateEarlierToolOutput
} from '../providerValues.ts'

export type OpenCodeMessageWithParts = {
  info: Message
  parts: Part[]
}

type RenderOptions = TranscriptRenderWindow & {
  active: boolean
  stopped: boolean
  failed?: boolean
  failureMessage?: string
  pendingItems?: ProviderChatItem[]
}

type Segment = {
  timing?: ConversationTiming
  id: string
  entries: ProviderConversationEntry[]
  failed: boolean
  rateLimited: boolean
  failureMessage?: string
  stopped?: boolean
  unfinishedReply?: boolean
  finalMessageIndex?: number
}

const maxChatTitleLength = 80

export const getOpenCodeErrorMessage = (error: unknown): string => {
  const errorRecord = isRecord(error) ? error : null
  const errorData = isRecord(errorRecord?.data) ? errorRecord.data : null
  const message =
    getString(error) ??
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

export const isOpenCodeAbortError = (error: unknown): boolean =>
  isRecord(error) && error.name === 'MessageAbortedError'

/** Read only the latest reply's outcome, without rendering tool or message payloads. */
export const getOpenCodeTurnOutcome = (
  messages: OpenCodeMessageWithParts[]
): ProviderChatTurnOutcome | null => {
  for (let index = messages.length - 1; index >= 0; index--) {
    const { info } = messages[index]
    if (info.role === 'user') {
      if (classifyOpenCodeTurnRecord(messages[index]) === 'start') return null
      continue
    }
    if (info.summary) continue
    if (isOpenCodeAbortError(info.error)) return 'stopped'
    if (info.error) return 'failed'
    return info.time.completed == null || info.finish === 'tool-calls' ? 'stopped' : null
  }
  return null
}

export const isOpenCodeRateLimitError = isProviderUsageLimitError

const getToolPath = (input: unknown): string | null =>
  getToolArgument(input, 'filePath', 'file_path', 'path', 'file', 'directory')

const getToolCwd = (input: unknown): string | null =>
  getToolArgument(input, 'cwd', 'workingDirectory', 'working_directory', 'directory', 'workdir')

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

// Delegation is a compact row in the parent. The subagent's prompt and report belong to its own
// chat (a child session), listed under the parent in the sidebar.
const renderTool = (part: Extract<Part, { type: 'tool' }>): ProviderWorkingTool => {
  const state = part.state
  const status = state.status === 'completed' || state.status === 'error' ? 'finished' : 'running'
  if (part.tool === 'task') {
    return createSubagentTool(
      part.id,
      part.callID,
      getToolArgument(state.input, 'description', 'subagent_type') ?? 'Subagent',
      status
    )
  }
  const input = state.input
  const output =
    state.status === 'completed' ? state.output : state.status === 'error' ? state.error : null
  const tool = createPresentedTool(
    getProviderToolPresentation('opencode', part.tool, input, { finished: status === 'finished' }),
    {
      id: part.id,
      toolId: part.callID,
      status,
      cwd: getToolCwd(input),
      fallbackLabel: `Used ${part.tool}`,
      rawInput: () => boundSerializedToolValue(input)
    }
  )
  return {
    ...tool,
    ...(tool.hidePayload
      ? {}
      : {
          stdout: truncateEarlierToolOutput(output),
          diffs: getToolDiffs(
            tool.activity,
            input,
            'metadata' in state ? state.metadata : null,
            output
          ),
          rawOutput: boundSerializedToolValue(output)
        }),
    images:
      state.status === 'completed'
        ? getAttachments(state.attachments ?? []).flatMap((attachment) =>
            attachment.kind === 'image' && (attachment.path || attachment.dataUrl)
              ? [{ path: attachment.path, dataUrl: attachment.dataUrl, name: attachment.name }]
              : []
          )
        : []
  }
}

const filePartPath = (part: Extract<Part, { type: 'file' }>): string | null => {
  if (part.source && (part.source.type === 'file' || part.source.type === 'symbol')) {
    return part.source.path
  }
  if (!part.url.startsWith('file:')) return null
  try {
    return fileURLToPath(part.url)
  } catch (error) {
    console.error('[caught:OpenCodeItemRenderers:filePartPath]', error)
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
  if (!isDefaultOpenCodeTitle(title)) return title
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
  if (options.turnWindow)
    return renderOpenCodeChatWindow(messages, options, options.turnWindow).items
  const items: ProviderChatItem[] = []
  let segment: Segment | null = null

  const ensureSegment = (id: string): Segment => {
    if (!segment)
      segment = {
        id: `${id}:working`,
        entries: [],
        failed: false,
        rateLimited: false
      }
    return segment
  }

  const flushSegment = (isLast: boolean, inferInterrupted = true): void => {
    if (!segment) return
    const current = segment
    segment = null
    const failed = current.failed || (isLast && options.failed === true)
    // A killed server cannot persist MessageAbortedError. Its last reply remains
    // unfinished (possibly between tool calls), even though the new server is idle.
    const stopped =
      current.stopped === true ||
      (isLast && options.stopped) ||
      (inferInterrupted &&
        !failed &&
        !(isLast && options.active) &&
        current.unfinishedReply === true)
    if (failed && isLast && options.failureMessage && !current.failureMessage) {
      current.entries.push({
        kind: 'working',
        item: {
          type: 'message',
          id: `${current.id}:error`,
          content: options.failureMessage
        }
      })
    }
    appendProviderConversationSegment(items, {
      id: current.id,
      timing: current.timing,
      entries: current.entries,
      finalMessageIndex:
        current.finalMessageIndex ?? getTrailingAssistantEntryIndex(current.entries),
      lifecycle: {
        active: isLast && options.active,
        completed: !failed && !stopped && (!isLast || !options.active),
        failed,
        stopped
      },
      ...(failed &&
      (current.rateLimited || (isLast && isProviderUsageLimitError(options.failureMessage)))
        ? { failureReason: 'rateLimit' as const }
        : {}),
      ...(failed && (current.failureMessage || (isLast && options.failureMessage))
        ? { failureMessage: current.failureMessage || options.failureMessage }
        : {})
    })
  }

  messages.forEach((message, messageIndex) => {
    // OpenCode stores compaction boundaries on user records, before a hidden summary
    // and synthetic continuation prompt. These records do not start new user turns.
    for (const part of message.parts) {
      if (part.type !== 'compaction') continue
      flushSegment(false, false)
      items.push({ type: 'contextCompaction', id: part.id })
    }
    if (message.info.role === 'user') {
      const content = getUserText(message.parts)
      const attachments = getAttachments(message.parts)
      if (!content && attachments.length === 0) return
      flushSegment(false)
      items.push({
        type: 'message',
        id: message.info.id,
        role: 'user',
        content,
        attachments: attachments.length > 0 ? attachments : undefined,
        createdAt: message.info.time.created
      })
      segment = {
        id: `${message.info.id}:working`,
        timing: includeConversationTime(undefined, message.info.time.created),
        entries: [],
        failed: false,
        rateLimited: false
      }
      return
    }
    if (message.info.summary === true) return

    const current = ensureSegment(message.info.id)
    current.finalMessageIndex = undefined
    const firstEntryIndex = current.entries.length
    current.unfinishedReply =
      message.info.time.completed == null || message.info.finish === 'tool-calls'
    const messageCompletedAt = message.info.time.completed
    current.timing = includeConversationTime(
      current.timing,
      message.info.time.created,
      message.info.time.completed ?? message.info.time.created
    )
    message.parts.forEach((part) => {
      const time =
        part.type === 'tool'
          ? 'time' in part.state
            ? part.state.time
            : undefined
          : 'time' in part
            ? part.time
            : undefined
      if (time && 'start' in time)
        current.timing = includeConversationTime(
          current.timing,
          time.start,
          'end' in time && typeof time.end === 'number' ? time.end : time.start
        )
      if (part.type === 'reasoning' && part.text.trim()) {
        current.entries.push({
          kind: 'working',
          item: {
            type: 'message',
            id: part.id,
            content: part.text.trim(),
            kind: 'reasoning',
            status:
              part.time?.end != null || messageCompletedAt != null ? 'completed' : 'inProgress'
          }
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
      } else if (part.type === 'subtask') {
        current.entries.push({
          kind: 'working',
          item: createSubagentTool(
            part.id,
            part.id,
            part.description || `Run ${part.agent}`,
            'finished'
          )
        })
      }
    })
    // A completed answer can be followed by reasoning metadata. Its text still belongs
    // outside Worked; only tool-loop text is progress for the next model step.
    if (messageCompletedAt != null && message.info.finish === 'stop' && !message.info.error) {
      for (let index = current.entries.length - 1; index >= firstEntryIndex; index--) {
        if (current.entries[index].kind === 'assistant') {
          current.finalMessageIndex = index
          break
        }
      }
    }
    if (isOpenCodeAbortError(message.info.error)) {
      // A user abort is a stop, not a failure: no error text, just a "Stopped" turn.
      current.stopped = true
    } else if (message.info.error) {
      // session.error reaches Sele before the failed message, so the turn first renders its
      // error from session state (see flushSegment). Reuse that ID for the turn's first error:
      // a different key would remount the error block when the message arrives.
      const errorId = current.failed ? `${message.info.id}:error` : `${current.id}:error`
      current.failed = true
      current.failureMessage = getOpenCodeErrorMessage(message.info.error)
      if (isOpenCodeRateLimitError(message.info.error)) current.rateLimited = true
      current.entries.push({
        kind: 'working',
        item: {
          type: 'message',
          id: errorId,
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

export const classifyOpenCodeTurnRecord = (
  message: OpenCodeMessageWithParts
): 'start' | 'content' | 'ignore' => {
  if (message.info.role === 'user') {
    if (getUserText(message.parts) || getAttachments(message.parts).length) return 'start'
    return message.parts.some((part) => part.type === 'compaction') ? 'content' : 'ignore'
  }
  return message.info.summary === true ? 'ignore' : 'content'
}

export const renderOpenCodeChatWindow = (
  records: OpenCodeMessageWithParts[],
  options: RenderOptions,
  window: ProviderChatTurnWindow
): { items: ProviderChatItem[]; itemsStartTurnIndex: number; turnCount: number } =>
  renderNativeTurnWindow(
    records,
    options,
    window,
    classifyOpenCodeTurnRecord,
    (selected, settings) =>
      renderOpenCodeChatItems(selected, { ...settings, turnWindow: undefined })
  )

export const findOpenCodeItemTurnWindow = (
  records: OpenCodeMessageWithParts[],
  itemId: string,
  limit: number
): ProviderChatTurnWindow | null =>
  findNativeItemTurnWindow(
    records,
    itemId,
    limit,
    classifyOpenCodeTurnRecord,
    (message) => message.info.id
  )
