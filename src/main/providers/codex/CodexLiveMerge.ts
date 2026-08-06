export const mergeCodexStreamedText = (
  previous: string | undefined,
  next: string | undefined
): string | undefined => {
  if (next == null || previous == null) return next ?? previous

  // Agent message deltas are append-only. A queued turn can finish while an older turn or item
  // snapshot is still in flight, so do not let that shorter prefix crop the streamed response.
  if (previous.length > next.length && previous.startsWith(next)) return previous

  return next
}
