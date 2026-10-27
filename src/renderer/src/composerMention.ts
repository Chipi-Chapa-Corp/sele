export type ComposerMention = {
  start: number
  end: number
  query: string
}

export const getComposerMentionAtCaret = (
  message: string,
  caret: number,
  marker: '@' | '$'
): ComposerMention | null => {
  if (caret <= 0) return null
  // Use the native search even for long unbroken pasted strings, then validate
  // just the candidate instead of running two suffix regexes over the draft.
  const start = message.lastIndexOf(marker, caret - 1)
  if (start < 0 || (start > 0 && !/[\s([{]/.test(message[start - 1]))) return null
  const query = message.slice(start + 1, caret)
  return /\s/.test(query) ? null : { start, end: caret, query }
}

export const composerMentionsEqual = (
  left: ComposerMention | null,
  right: ComposerMention | null
): boolean =>
  left?.start === right?.start && left?.end === right?.end && left?.query === right?.query
