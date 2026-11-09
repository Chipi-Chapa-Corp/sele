import type { ProviderChatItem } from './provider'

/** Standalone assistant messages are final answers; progress text lives inside working items. */
export const finishWorkingStepsBeforeAnswers = (items: ProviderChatItem[]): ProviderChatItem[] => {
  let result = items
  let workingIndexes: number[] = []
  items.forEach((item, index) => {
    if (item.type === 'message' && item.role === 'user') {
      workingIndexes = []
    } else if (item.type === 'working' && item.status === 'working') {
      workingIndexes.push(index)
    } else if (item.type === 'message' && item.role === 'assistant') {
      // A server answer can have startsTurn=true when its user echo was omitted. Its
      // preceding local submission still owns the visible Working section.
      for (const workingIndex of workingIndexes) {
        const step = items[workingIndex]
        if (step.type !== 'working') continue
        if (result === items) result = items.slice()
        result[workingIndex] = {
          ...step,
          status: 'worked',
          ...(step.startedAt != null
            ? {
                completedAt: Math.max(
                  step.startedAt,
                  step.completedAt ?? item.createdAt ?? step.startedAt
                )
              }
            : {})
        }
      }
      workingIndexes = []
    }
  })
  return result
}
