type RolloutEntry = Record<string, unknown>

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

export const findCodexBenchmarkTurnStart = (entries: RolloutEntry[], turnId: string): number =>
  entries.findLastIndex((entry) => {
    const payload = record(entry.payload)
    return (
      entry.type === 'event_msg' && payload.type === 'task_started' && payload.turn_id === turnId
    )
  })

export const getCodexBenchmarkTurnRecords = (
  entries: RolloutEntry[],
  turnId: string
): RolloutEntry[] => {
  const start = findCodexBenchmarkTurnStart(entries, turnId)
  const end = entries.findIndex((entry, index) => {
    const payload = record(entry.payload)
    return (
      index > start &&
      entry.type === 'event_msg' &&
      payload.type === 'task_complete' &&
      payload.turn_id === turnId
    )
  })
  if (start < 0 || end < 0) throw new Error('The completed Codex turn is unavailable.')
  return entries.slice(start, end + 1)
}

export const numberCodexBenchmarkReplay = (base: RolloutEntry[], entries: RolloutEntry[]) => {
  const lastOrdinal = base.at(-1)?.ordinal
  if (
    typeof lastOrdinal !== 'number' ||
    lastOrdinal < 0 ||
    !Number.isSafeInteger(lastOrdinal) ||
    !Number.isSafeInteger(lastOrdinal + entries.length)
  )
    throw new Error('The new Codex history segment has no valid rollout ordinal.')
  return entries.map((entry, index) => ({ ...entry, ordinal: lastOrdinal + index + 1 }))
}

export function replaceCodexBenchmarkAnswer(
  entries: RolloutEntry[],
  threadId: string,
  turnId: string,
  userItemId: string,
  answer: string,
  discardLater = false
): RolloutEntry[] {
  if (entries[0]?.type !== 'session_meta' || record(entries[0].payload).id !== threadId)
    throw new Error('Codex returned a different transcript.')
  const turnStarted = entries.findLastIndex((entry) => {
    const payload = record(entry.payload)
    return (
      entry.type === 'event_msg' &&
      payload.type === 'task_started' &&
      (!discardLater || payload.turn_id === turnId)
    )
  })
  const turnFinished = entries.findLastIndex((entry) => {
    const payload = record(entry.payload)
    return (
      entry.type === 'event_msg' &&
      payload.type === 'task_complete' &&
      (!discardLater || payload.turn_id === turnId)
    )
  })
  if (
    turnStarted < 0 ||
    turnFinished <= turnStarted ||
    record(entries[turnStarted]?.payload).turn_id !== turnId ||
    record(entries[turnFinished]?.payload).turn_id !== turnId
  )
    throw new Error('Only the latest completed Codex turn can be replaced.')

  // Find the native user event by item ID, including the last steering prompt if present.
  const user = entries.findLastIndex((entry, index) => {
    const data = record(entry.payload)
    return (
      index < turnFinished &&
      entry.type === 'event_msg' &&
      data.turn_id === turnId &&
      data.type === 'item_completed' &&
      record(data.item).type === 'UserMessage'
    )
  })
  if (user <= turnStarted || record(record(entries[user]?.payload).item).id !== userItemId)
    throw new Error('The latest Codex prompt has changed.')

  const reply = entries.slice(user + 1, turnFinished)
  const display = reply.findLast((entry) => {
    const data = record(entry.payload)
    return (
      entry.type === 'event_msg' &&
      data.type === 'item_completed' &&
      record(data.item).type === 'AgentMessage'
    )
  })
  const displayItem = record(record(display?.payload).item)
  const response = reply.findLast((entry) => {
    const data = record(entry.payload)
    return entry.type === 'response_item' && data.type === 'message' && data.role === 'assistant'
  })
  if (!display || !response || displayItem.id !== record(response.payload).id)
    throw new Error('Codex did not save a replaceable final answer.')
  if (
    !discardLater &&
    entries
      .slice(turnFinished + 1)
      .some(
        (entry) =>
          entry.type === 'response_item' ||
          entry.type === 'compacted' ||
          record(entry.payload).type === 'thread_rolled_back'
      )
  )
    throw new Error('The Codex transcript has changed since this turn completed.')

  // Codex reads model context from response_item and paginates display items from item_completed.
  // Keep the actual usage records and completion marker while dropping the discarded output.
  const nextDisplay = {
    ...display,
    payload: {
      ...record(display.payload),
      item: { ...displayItem, content: [{ type: 'Text', text: answer }] }
    }
  }
  const nextResponse = {
    ...response,
    payload: {
      ...record(response.payload),
      content: [{ type: 'output_text', text: answer, annotations: [] }]
    }
  }
  return [
    ...entries.slice(0, user + 1),
    ...reply.flatMap((entry): RolloutEntry[] => {
      if (entry === display) return [nextDisplay]
      if (entry === response) return [nextResponse]
      if (entry.type === 'token_usage_record' || record(entry.payload).type === 'token_count')
        return [entry]
      return []
    }),
    {
      ...entries[turnFinished],
      payload: {
        ...record(entries[turnFinished]?.payload),
        last_agent_message: answer
      }
    },
    ...(!discardLater ? entries.slice(turnFinished + 1) : [])
  ]
}
