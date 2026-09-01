import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { basename, dirname, join, resolve } from 'node:path'
import type {
  ProviderChatContextUsage,
  ProviderTokenUsageBreakdown
} from '../../../shared/provider'
import type { CodexThreadItem, CodexTurn, CodexUserInput } from './CodexItemRenderers'
import { getNestedToolCalls, isPatchToolCall } from './CodexToolCalls.ts'

type RolloutPatchChange = {
  type?: 'add' | 'delete' | 'update'
  unified_diff?: string
  content?: string
  move_path?: string | null
}

type RolloutPayload = {
  type: string
  turn_id?: string
  client_id?: string
  call_id?: string
  id?: string
  name?: string
  model?: string
  input?: string
  arguments?: unknown
  output?: unknown
  message?: string
  images?: unknown
  local_images?: unknown
  last_agent_message?: string
  phase?: 'commentary' | 'final_answer' | null
  role?: string
  content?: unknown
  changes?: Record<string, RolloutPatchChange>
  [key: string]: unknown
}

type RolloutRecord = {
  type?: string
  payload?: RolloutPayload
  timestamp?: unknown
  time?: unknown
  created_at?: unknown
  createdAt?: unknown
  [key: string]: unknown
}

type RolloutHistoryBase = {
  threadId: string
  endOrdinalExclusive: number
  endByteOffset: number
}

type RolloutEntry = {
  record: RolloutRecord
  payload: RolloutPayload
  index: number
}

type ParsedRollout = {
  entries: RolloutEntry[]
  turnModels: Map<string, string>
}

type TurnEntryLookup = {
  entryPositions: Map<RolloutEntry, number>
  outputsByKey: Map<string, RolloutEntry>
}

const isToolCallPayload = (payload: RolloutPayload): boolean =>
  payload.type === 'custom_tool_call' ||
  payload.type === 'function_call' ||
  payload.type === 'tool_search_call' ||
  payload.type === 'web_search_call'

const getToolCallOutputType = (payload: RolloutPayload): string | null => {
  if (payload.type === 'function_call') return 'function_call_output'
  if (payload.type === 'custom_tool_call') return 'custom_tool_call_output'
  if (payload.type === 'tool_search_call') return 'tool_search_output'
  if (payload.type === 'web_search_call') return 'web_search_end'
  return null
}

const getOutputKey = (type: string, callId: string): string => `${type}\0${callId}`

const getToolCallName = (payload: RolloutPayload): string =>
  payload.name ??
  (payload.type === 'tool_search_call'
    ? 'tool_search'
    : payload.type === 'web_search_call'
      ? 'web_search'
      : 'tool')

const getRecordValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const getStringValue = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const getStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []

const getPayloadModel = (payload: RolloutPayload): string | null => {
  const directModel = getStringValue(payload.model)
  if (directModel) return directModel

  const collaborationMode = getRecordValue(payload.collaboration_mode)
  const collaborationModeSettings = getRecordValue(collaborationMode?.settings)

  return getStringValue(collaborationModeSettings?.model)
}

const getRequiredUsageNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

const parseRolloutLine = (
  line: string,
  index: number,
  parsed: ParsedRollout
): RolloutEntry | null => {
  if (!line.trim()) return null

  try {
    const record = JSON.parse(line) as RolloutRecord
    const payload = record.payload
    if (!payload) return null

    if (record.type === 'turn_context') {
      const turnId = getStringValue(payload.turn_id)
      const model = getPayloadModel(payload)
      if (turnId && model && !parsed.turnModels.has(turnId)) {
        parsed.turnModels.set(turnId, model)
      }
    }

    if (!payload.type) return null
    const entry = { record, payload, index }
    parsed.entries.push(entry)
    return entry
  } catch {
    // A malformed rollout row should not prevent the rest of the history from loading.
    return null
  }
}

const groupEntriesByTurn = (entries: RolloutEntry[]): Map<string, RolloutEntry[]> => {
  const entriesByTurn = new Map<string, RolloutEntry[]>()
  let currentTurnId: string | null = null

  for (const entry of entries) {
    if (entry.payload.type === 'task_started') currentTurnId = entry.payload.turn_id ?? null

    const turnId = entry.payload.turn_id ?? currentTurnId
    if (!turnId) continue

    const turnEntries = entriesByTurn.get(turnId) ?? []
    turnEntries.push(entry)
    entriesByTurn.set(turnId, turnEntries)
  }

  return entriesByTurn
}

const getTimestampSeconds = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? Math.floor(value / 1_000) : value
  }

  if (typeof value !== 'string' || !value.trim()) return null

  const numericValue = Number(value)
  if (Number.isFinite(numericValue)) {
    return numericValue > 1_000_000_000_000 ? Math.floor(numericValue / 1_000) : numericValue
  }

  const parsedTime = Date.parse(value)
  return Number.isFinite(parsedTime) ? Math.floor(parsedTime / 1_000) : null
}

const getEntryTimestampSeconds = (entry: RolloutEntry): number | null => {
  const { record, payload } = entry

  return (
    getTimestampSeconds(record.timestamp) ??
    getTimestampSeconds(record.time) ??
    getTimestampSeconds(record.created_at) ??
    getTimestampSeconds(record.createdAt) ??
    getTimestampSeconds(payload.timestamp) ??
    getTimestampSeconds(payload.time) ??
    getTimestampSeconds(payload.created_at) ??
    getTimestampSeconds(payload.createdAt)
  )
}

const getFirstEntryTimestampSeconds = (entries: RolloutEntry[]): number | null => {
  for (const entry of entries) {
    const timestamp = getEntryTimestampSeconds(entry)
    if (timestamp != null) return timestamp
  }

  return null
}

const getEntryModel = (entry: RolloutEntry): string | null => {
  return getPayloadModel(entry.payload)
}

const getTurnModel = (entries: RolloutEntry[]): string | null => {
  for (const entry of entries) {
    const model = getEntryModel(entry)
    if (model) return model
  }

  return null
}

const getLastEntryTimestampSeconds = (entries: RolloutEntry[]): number | null => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const timestamp = getEntryTimestampSeconds(entries[index])
    if (timestamp != null) return timestamp
  }

  return null
}

const getUsageField = (
  usage: Record<string, unknown>,
  snakeCaseKey: string,
  camelCaseKey: string
): number | null => getRequiredUsageNumber(usage[snakeCaseKey] ?? usage[camelCaseKey])

const normalizeRolloutTokenUsageBreakdown = (
  value: unknown
): ProviderTokenUsageBreakdown | null => {
  const breakdown = getRecordValue(value)
  if (!breakdown) return null

  const totalTokens = getUsageField(breakdown, 'total_tokens', 'totalTokens')
  const inputTokens = getUsageField(breakdown, 'input_tokens', 'inputTokens')
  const cachedInputTokens = getUsageField(breakdown, 'cached_input_tokens', 'cachedInputTokens')
  const outputTokens = getUsageField(breakdown, 'output_tokens', 'outputTokens')
  const reasoningOutputTokens = getUsageField(
    breakdown,
    'reasoning_output_tokens',
    'reasoningOutputTokens'
  )

  if (
    totalTokens == null ||
    inputTokens == null ||
    cachedInputTokens == null ||
    outputTokens == null ||
    reasoningOutputTokens == null
  ) {
    return null
  }

  return {
    totalTokens,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens
  }
}

const hasDetailedTokenUsage = (usage: ProviderTokenUsageBreakdown): boolean =>
  usage.inputTokens > 0 ||
  usage.cachedInputTokens > 0 ||
  usage.outputTokens > 0 ||
  usage.reasoningOutputTokens > 0

const getTokenCountContextTokens = (last: ProviderTokenUsageBreakdown): number =>
  last.inputTokens > 0 ? last.inputTokens : last.totalTokens

const normalizeRolloutContextUsage = (entry: RolloutEntry): ProviderChatContextUsage | null => {
  if (entry.payload.type !== 'token_count') return null

  const info = getRecordValue(entry.payload.info)
  if (!info) return null

  const total = normalizeRolloutTokenUsageBreakdown(info.total_token_usage ?? info.totalTokenUsage)
  const last = normalizeRolloutTokenUsageBreakdown(info.last_token_usage ?? info.lastTokenUsage)
  if (!total || !last) return null
  if (last.totalTokens > 0 && !hasDetailedTokenUsage(last)) return null

  const modelContextWindow = info.model_context_window ?? info.modelContextWindow
  const reportedContextWindow =
    modelContextWindow == null ? null : getRequiredUsageNumber(modelContextWindow)
  if (modelContextWindow != null && reportedContextWindow == null) return null

  const usedTokens = getTokenCountContextTokens(last)
  const maxTokens =
    reportedContextWindow != null && reportedContextWindow > usedTokens
      ? reportedContextWindow
      : null
  const updatedAt = getEntryTimestampSeconds(entry)

  return {
    usedTokens,
    maxTokens,
    total,
    last,
    updatedAt: updatedAt == null ? Date.now() : updatedAt * 1_000
  }
}

const getToolCallInput = (payload: RolloutPayload): string | null => {
  if (typeof payload.input === 'string') return payload.input
  if (typeof payload.arguments === 'string') {
    return `tools.${getToolCallName(payload)}(${payload.arguments})`
  }
  if (payload.arguments !== undefined) {
    return `tools.${getToolCallName(payload)}(${JSON.stringify(payload.arguments)})`
  }
  if (payload.action !== undefined) {
    return `tools.${getToolCallName(payload)}(${JSON.stringify(payload.action)})`
  }
  return null
}

const getOutputEntry = (lookup: TurnEntryLookup, payload: RolloutPayload): RolloutEntry | null => {
  const outputType = getToolCallOutputType(payload)
  if (!outputType || !payload.call_id) return null
  return lookup.outputsByKey.get(getOutputKey(outputType, payload.call_id)) ?? null
}

const getPatchEntryForToolCall = (
  entries: RolloutEntry[],
  entryIndex: number,
  outputEntry: RolloutEntry | null,
  lookup: TurnEntryLookup
): RolloutEntry | null => {
  const searchEnd = outputEntry
    ? (lookup.entryPositions.get(outputEntry) ?? entryIndex)
    : entryIndex + 8

  for (let index = entryIndex + 1; index <= searchEnd && index < entries.length; index += 1) {
    if (entries[index].payload.type === 'patch_apply_end') return entries[index]
  }

  return null
}

const getPatchChanges = (payload: RolloutPayload): CodexThreadItem['changes'] => {
  if (!payload.changes) return []

  return Object.entries(payload.changes).flatMap(([path, change]) => {
    if (!change.type) return []

    return {
      path,
      kind:
        change.type === 'update'
          ? ({ type: 'update', move_path: change.move_path ?? null } as const)
          : ({ type: change.type } as const),
      diff: change.unified_diff ?? change.content ?? ''
    }
  })
}

const getRawEntriesBetween = (
  entries: RolloutEntry[],
  startIndex: number,
  endEntry: RolloutEntry | null,
  lookup: TurnEntryLookup,
  extraEntries: RolloutEntry[] = []
): unknown[] => {
  const endIndex = endEntry ? (lookup.entryPositions.get(endEntry) ?? startIndex) : startIndex
  const rawEntries = entries.slice(startIndex, endIndex + 1).map((entry) => entry.record)

  for (const entry of extraEntries) {
    if (!rawEntries.includes(entry.record)) rawEntries.push(entry.record)
  }

  return rawEntries
}

const createToolItems = (
  entry: RolloutEntry,
  entries: RolloutEntry[],
  entryIndex: number,
  lookup: TurnEntryLookup,
  usedPatchEntryIndexes: Set<number>
): CodexThreadItem[] => {
  const { payload } = entry
  const input = getToolCallInput(payload)
  const outputEntry = getOutputEntry(lookup, payload)
  const output = outputEntry?.payload.output ?? null

  if (!input) {
    return [
      {
        type: 'customToolCall',
        id: payload.id ?? payload.call_id ?? `${payload.type}:${entry.index}`,
        customToolName: getToolCallName(payload),
        customToolInput:
          payload.arguments === undefined
            ? null
            : typeof payload.arguments === 'string'
              ? payload.arguments
              : JSON.stringify(payload.arguments),
        customToolOutput: output,
        rawToolData: getRawEntriesBetween(entries, entryIndex, outputEntry, lookup)
      }
    ]
  }

  const nestedCalls = getNestedToolCalls(input)
  const patchEntry = getPatchEntryForToolCall(entries, entryIndex, outputEntry, lookup)

  if (patchEntry && isPatchToolCall(input, nestedCalls)) {
    usedPatchEntryIndexes.add(patchEntry.index)
    return [
      {
        type: 'fileChange',
        id: payload.id ?? payload.call_id ?? `patch:${entry.index}`,
        changes: getPatchChanges(patchEntry.payload),
        rawToolData: getRawEntriesBetween(entries, entryIndex, outputEntry, lookup, [patchEntry])
      }
    ]
  }

  const calls =
    nestedCalls.length > 0 ? nestedCalls : [{ name: getToolCallName(payload), offset: 0 }]

  return calls.map((call, index) => ({
    type: 'customToolCall',
    id: `${payload.id ?? payload.call_id ?? `${payload.type}:${entry.index}`}:${index}`,
    customToolName: call.name,
    customToolInput: input.slice(call.offset),
    customToolOutput: output,
    rawToolData: getRawEntriesBetween(entries, entryIndex, outputEntry, lookup)
  }))
}

const createStandalonePatchItem = (entry: RolloutEntry): CodexThreadItem => ({
  type: 'fileChange',
  id: entry.payload.call_id ?? entry.payload.id ?? `patch:${entry.index}`,
  changes: getPatchChanges(entry.payload),
  rawToolData: [entry.record]
})

const createUserMessageItem = (entry: RolloutEntry): CodexThreadItem | null => {
  const message = entry.payload.message?.trim() ?? ''
  const images = getStringArray(entry.payload.images)
  const localImages = getStringArray(entry.payload.local_images)
  if (!message && images.length === 0 && localImages.length === 0) return null

  return {
    type: 'userMessage',
    id: entry.payload.client_id ?? entry.payload.id ?? `user:${entry.index}`,
    content: [
      ...(message ? [{ type: 'text' as const, text: message }] : []),
      ...images.map((url) => ({ type: 'image' as const, url })),
      ...localImages.map((path) => ({ type: 'localImage' as const, path }))
    ],
    rawToolData: [entry.record]
  }
}

const createAgentMessageItem = (entry: RolloutEntry): CodexThreadItem | null => {
  const message = entry.payload.message?.trim()
  if (!message) return null

  return {
    type: 'agentMessage',
    id: entry.payload.id ?? `agent:${entry.index}`,
    text: message,
    phase: entry.payload.phase ?? null,
    rawToolData: [entry.record]
  }
}

const getResponseMessageContent = (value: unknown): CodexUserInput[] => {
  if (!Array.isArray(value)) return []

  return value.flatMap((rawContent): CodexUserInput[] => {
    const content = getRecordValue(rawContent)
    if (!content) return []

    if (
      (content.type === 'input_text' || content.type === 'output_text') &&
      typeof content.text === 'string' &&
      content.text.length > 0
    ) {
      return [{ type: 'text', text: content.text }]
    }

    const imageUrl = getStringValue(content.image_url ?? content.url)
    if (content.type === 'input_image' && imageUrl) return [{ type: 'image', url: imageUrl }]

    const localImagePath = getStringValue(content.path)
    if (content.type === 'local_image' && localImagePath) {
      return [{ type: 'localImage', path: localImagePath }]
    }

    return []
  })
}

const createResponseMessageItem = (entry: RolloutEntry): CodexThreadItem | null => {
  if (entry.record.type !== 'response_item' || entry.payload.type !== 'message') return null

  const content = getResponseMessageContent(entry.payload.content)
  if (entry.payload.role === 'user') {
    if (content.length === 0) return null
    return {
      type: 'userMessage',
      id: entry.payload.id ?? `user:${entry.index}`,
      content,
      rawToolData: [entry.record]
    }
  }

  if (entry.payload.role !== 'assistant') return null
  const text = content
    .filter((item): item is Extract<CodexUserInput, { type: 'text' }> => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
    .trim()
  if (!text) return null

  return {
    type: 'agentMessage',
    id: entry.payload.id ?? `agent:${entry.index}`,
    text,
    phase: entry.payload.phase ?? 'final_answer',
    rawToolData: [entry.record]
  }
}

const createTaskCompleteFallbackItem = (
  entry: RolloutEntry,
  hasFinalAgentMessage: boolean
): CodexThreadItem | null => {
  if (hasFinalAgentMessage) return null

  const message = entry.payload.last_agent_message?.trim()
  if (!message) return null

  return {
    type: 'agentMessage',
    id: entry.payload.id ?? `task-complete:${entry.index}`,
    text: message,
    phase: 'final_answer',
    rawToolData: [entry.record]
  }
}

const createContextCompactionItem = (entry: RolloutEntry): CodexThreadItem => ({
  type: 'contextCompaction',
  id: entry.payload.id ?? `context-compaction:${entry.index}`,
  rawToolData: [entry.record]
})

const createTurn = (
  turnId: string,
  entries: RolloutEntry[],
  turnContextModel: string | null
): CodexTurn => {
  const items: CodexThreadItem[] = []
  const usedPatchEntryIndexes = new Set<number>()
  const lookup: TurnEntryLookup = {
    entryPositions: new Map(entries.map((entry, index) => [entry, index])),
    outputsByKey: new Map()
  }
  for (const entry of entries) {
    const callId = entry.payload.call_id
    if (!callId) continue
    const key = getOutputKey(entry.payload.type, callId)
    if (!lookup.outputsByKey.has(key)) lookup.outputsByKey.set(key, entry)
  }
  const hasFinalAgentMessage = entries.some(
    (entry) =>
      (entry.payload.type === 'agent_message' && entry.payload.phase === 'final_answer') ||
      (entry.record.type === 'response_item' &&
        entry.payload.type === 'message' &&
        entry.payload.role === 'assistant')
  )

  entries.forEach((entry, entryIndex) => {
    const { payload } = entry

    if (entry.record.type === 'response_item' && payload.type === 'message') {
      const item = createResponseMessageItem(entry)
      if (item) items.push(item)
      return
    }

    if (payload.type === 'user_message') {
      const item = createUserMessageItem(entry)
      if (item) items.push(item)
      return
    }

    if (payload.type === 'agent_message') {
      const item = createAgentMessageItem(entry)
      if (item) items.push(item)
      return
    }

    if (isToolCallPayload(payload)) {
      items.push(...createToolItems(entry, entries, entryIndex, lookup, usedPatchEntryIndexes))
      return
    }

    if (payload.type === 'patch_apply_end' && !usedPatchEntryIndexes.has(entry.index)) {
      items.push(createStandalonePatchItem(entry))
      return
    }

    if (payload.type === 'task_complete') {
      const item = createTaskCompleteFallbackItem(entry, hasFinalAgentMessage)
      if (item) items.push(item)
      return
    }

    if (payload.type === 'context_compacted') {
      items.push(createContextCompactionItem(entry))
      return
    }

    if (payload.type === 'turn_aborted') {
      items.push({
        type: 'turnAborted',
        id: payload.turn_id ?? payload.id ?? `turn-aborted:${entry.index}`,
        rawToolData: [entry.record]
      })
    }
  })

  return {
    id: turnId,
    model: getTurnModel(entries) ?? turnContextModel,
    startedAt: getFirstEntryTimestampSeconds(entries),
    completedAt: getLastEntryTimestampSeconds(entries),
    items
  }
}

type RolloutSnapshot = {
  contextUsage: ProviderChatContextUsage | null
  cwd: string | null
  turns: CodexTurn[]
}

type RolloutFileSnapshot = {
  historyBase: RolloutHistoryBase | null
  snapshot: RolloutSnapshot
}

type CachedRolloutSnapshot = {
  fingerprint: string
  snapshot: Promise<RolloutSnapshot>
}

const emptyRolloutSnapshot = (): RolloutSnapshot => ({
  contextUsage: null,
  cwd: null,
  turns: []
})

const rolloutSnapshotCache = new Map<string, CachedRolloutSnapshot>()

const getRolloutHistoryBase = (record: RolloutRecord): RolloutHistoryBase | null => {
  if (record.type !== 'session_meta') return null

  const historyBase = getRecordValue(record.payload?.history_base ?? record.payload?.historyBase)
  const threadId = getStringValue(historyBase?.thread_id ?? historyBase?.threadId)
  const endOrdinalExclusive = historyBase?.end_ordinal_exclusive ?? historyBase?.endOrdinalExclusive
  const endByteOffset = historyBase?.end_byte_offset ?? historyBase?.endByteOffset
  if (
    !threadId ||
    typeof endOrdinalExclusive !== 'number' ||
    !Number.isSafeInteger(endOrdinalExclusive) ||
    endOrdinalExclusive < 0 ||
    typeof endByteOffset !== 'number' ||
    !Number.isSafeInteger(endByteOffset) ||
    endByteOffset < 0
  ) {
    return null
  }

  return { threadId, endOrdinalExclusive, endByteOffset }
}

const readRolloutFileSnapshot = async (
  rolloutPath: string,
  options: { endByteOffset?: number; endOrdinalExclusive?: number } = {}
): Promise<RolloutFileSnapshot> => {
  if (options.endByteOffset === 0 || options.endOrdinalExclusive === 0) {
    return { historyBase: null, snapshot: emptyRolloutSnapshot() }
  }

  const parsed: ParsedRollout = { entries: [], turnModels: new Map() }
  let contextUsage: ProviderChatContextUsage | null = null
  let cwd: string | null = null
  let historyBase: RolloutHistoryBase | null = null
  let lineIndex = 0
  const endByteOffset = options.endByteOffset
  const lines = createInterface({
    input: createReadStream(rolloutPath, {
      encoding: 'utf8',
      ...(endByteOffset == null || endByteOffset <= 0 ? {} : { end: endByteOffset - 1 })
    }),
    crlfDelay: Infinity
  })

  for await (const line of lines) {
    if (options.endOrdinalExclusive != null && lineIndex >= options.endOrdinalExclusive) {
      break
    }

    try {
      const record = JSON.parse(line) as RolloutRecord
      historyBase ??= getRolloutHistoryBase(record)
    } catch {
      // The regular parser below already treats malformed rows as non-fatal.
    }

    const entry = parseRolloutLine(line, lineIndex, parsed)
    lineIndex += 1
    if (!entry) continue

    const entryCwd = entry.payload.cwd
    if (!cwd && typeof entryCwd === 'string' && entryCwd.trim()) cwd = entryCwd
    const nextContextUsage = normalizeRolloutContextUsage(entry)
    if (nextContextUsage) contextUsage = nextContextUsage
  }

  const entriesByTurn = groupEntriesByTurn(parsed.entries)
  const turns = [...entriesByTurn.entries()].map(([turnId, turnEntries]) =>
    createTurn(turnId, turnEntries, parsed.turnModels.get(turnId) ?? null)
  )
  return { historyBase, snapshot: { contextUsage, cwd, turns } }
}

const getRolloutDateDirectory = (date: Date): string =>
  [
    date.getUTCFullYear().toString().padStart(4, '0'),
    (date.getUTCMonth() + 1).toString().padStart(2, '0'),
    date.getUTCDate().toString().padStart(2, '0')
  ].join('/')

const getUuidV7Date = (id: string): Date | null => {
  const timestampHex = id.replaceAll('-', '').slice(0, 12)
  if (!/^[0-9a-f]{12}$/i.test(timestampHex)) return null

  const timestamp = Number.parseInt(timestampHex, 16)
  if (!Number.isSafeInteger(timestamp)) return null
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? null : date
}

const getNearbyDateDirectories = (date: Date): string[] =>
  [-2, -1, 0, 1, 2].map((dayOffset) => {
    const nearbyDate = new Date(date)
    nearbyDate.setUTCDate(nearbyDate.getUTCDate() + dayOffset)
    return getRolloutDateDirectory(nearbyDate)
  })

const findHistoryBaseRolloutPath = async (
  rolloutPath: string,
  historyBaseThreadId: string
): Promise<string | null> => {
  const currentDayDirectory = dirname(rolloutPath)
  const sessionsRoot = resolve(currentDayDirectory, '../../..')
  const candidateDirectories = new Set<string>([currentDayDirectory])
  const historyBaseDate = getUuidV7Date(historyBaseThreadId)
  if (historyBaseDate) {
    getNearbyDateDirectories(historyBaseDate).forEach((relativeDirectory) =>
      candidateDirectories.add(join(sessionsRoot, relativeDirectory))
    )
  }

  const currentName = basename(rolloutPath)
  const dashSuffix = `-${historyBaseThreadId}.jsonl`
  const underscoreSuffix = `_${historyBaseThreadId}.jsonl`
  for (const directory of candidateDirectories) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    const match = entries.find(
      (entry) =>
        entry.isFile() &&
        entry.name !== currentName &&
        (entry.name.endsWith(dashSuffix) || entry.name.endsWith(underscoreSuffix))
    )
    if (match) return join(directory, match.name)
  }

  return null
}

const mergeRolloutSnapshots = (
  historyBase: RolloutSnapshot,
  current: RolloutSnapshot
): RolloutSnapshot => {
  const turnsById = new Map(historyBase.turns.map((turn) => [turn.id, turn]))
  current.turns.forEach((turn) => turnsById.set(turn.id, turn))

  return {
    contextUsage: current.contextUsage ?? historyBase.contextUsage,
    cwd: current.cwd ?? historyBase.cwd,
    turns: [...turnsById.values()]
  }
}

const readRolloutSnapshotChain = async (
  rolloutPath: string,
  options: { endByteOffset?: number; endOrdinalExclusive?: number } = {},
  visitedPaths = new Set<string>()
): Promise<RolloutSnapshot> => {
  if (visitedPaths.has(rolloutPath)) return emptyRolloutSnapshot()
  visitedPaths.add(rolloutPath)

  const current = await readRolloutFileSnapshot(rolloutPath, options)
  if (!current.historyBase) return current.snapshot

  const historyBasePath = await findHistoryBaseRolloutPath(
    rolloutPath,
    current.historyBase.threadId
  )
  if (!historyBasePath) return current.snapshot

  const historyBaseSnapshot = await readRolloutSnapshotChain(
    historyBasePath,
    {
      endByteOffset: current.historyBase.endByteOffset,
      endOrdinalExclusive: current.historyBase.endOrdinalExclusive
    },
    visitedPaths
  )
  return mergeRolloutSnapshots(historyBaseSnapshot, current.snapshot)
}

const loadRolloutSnapshot = async (rolloutPath: string | null): Promise<RolloutSnapshot> => {
  if (!rolloutPath) return emptyRolloutSnapshot()

  try {
    const metadata = await stat(rolloutPath)
    const fingerprint = `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}`
    const cached = rolloutSnapshotCache.get(rolloutPath)
    if (cached?.fingerprint === fingerprint) return cached.snapshot

    const snapshot = readRolloutSnapshotChain(rolloutPath).catch(() => emptyRolloutSnapshot())
    rolloutSnapshotCache.set(rolloutPath, { fingerprint, snapshot })
    return snapshot
  } catch {
    return emptyRolloutSnapshot()
  }
}

export const loadRolloutHistory = async (rolloutPath: string | null): Promise<CodexTurn[]> =>
  (await loadRolloutSnapshot(rolloutPath)).turns

export const loadRolloutContextUsage = async (
  rolloutPath: string | null
): Promise<ProviderChatContextUsage | null> => (await loadRolloutSnapshot(rolloutPath)).contextUsage

export const loadRolloutCwd = async (rolloutPath: string | null): Promise<string | null> =>
  (await loadRolloutSnapshot(rolloutPath)).cwd
