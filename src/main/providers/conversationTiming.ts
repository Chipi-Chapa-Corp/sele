/** Milliseconds since epoch; track wall time, never sum overlapping tool durations. */
export type ConversationTiming = { startedAt?: number; completedAt?: number }

export const includeConversationTime = (
  timing: ConversationTiming | undefined,
  start: number | null | undefined,
  end: number | null | undefined = start
): ConversationTiming => {
  const result = { ...timing }
  if (start != null && Number.isFinite(start))
    result.startedAt = Math.min(result.startedAt ?? start, start)
  if (end != null && Number.isFinite(end))
    result.completedAt = Math.max(result.completedAt ?? end, end)
  return result
}
