import type { ProviderChatDetail, ProviderTurnOptions } from '../../shared/provider'
import type { ProviderAdapter } from './ProviderAdapter'

export class LinkedChatContextCancelledError extends Error {
  constructor() {
    super('Linked chat preparation was cancelled.')
    this.name = 'LinkedChatContextCancelledError'
  }
}

export const isLinkedChatContextCancelled = (error: unknown): boolean =>
  error instanceof LinkedChatContextCancelledError

export const throwIfLinkedChatCancelled = (signal: AbortSignal): void => {
  if (signal.aborted) throw new LinkedChatContextCancelledError()
}

/** Reject as soon as the preparation is cancelled, without waiting for provider work to settle. */
export const raceLinkedChatCancellation = <T>(
  signal: AbortSignal,
  work: Promise<T>
): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(new LinkedChatContextCancelledError())
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    // Observe work even if it synchronously triggered cancellation before this call.
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

type ForkStatusUpdate = Pick<ProviderChatDetail, 'id' | 'status'>

/**
 * Follows one hidden fork turn through provider updates. Subscribe before the fork exists:
 * its ID is only known inside `onForkCreated`, and a short turn can finish before the fork
 * call returns.
 */
export const watchLinkedChatForkTurn = (
  onChatUpdated: ProviderAdapter['onChatUpdated'],
  signal: AbortSignal
): {
  track: (chatId: string) => void
  finished: (initial: ForkStatusUpdate) => Promise<void>
  dispose: () => void
} => {
  const earlyUpdates: ForkStatusUpdate[] = []
  let forkId: string | null = null
  let sawActive = false
  let finishedTurn = false
  let failure: Error | null = null
  let wake: (() => void) | null = null

  const observe = (update: ForkStatusUpdate): void => {
    if (finishedTurn || failure) return
    if (update.status === 'active') {
      sawActive = true
    } else if (update.status === 'waitingOnApproval' || update.status === 'waitingOnUserInput') {
      failure = new Error(
        'The linked chat summary is waiting for approval or input. Open the source chat and try again.'
      )
    } else if (update.status === 'error') {
      failure = new Error('The provider failed while summarizing the linked chat.')
    } else if (sawActive) {
      finishedTurn = true
    }
    wake?.()
  }

  const unsubscribe = onChatUpdated((detail) => {
    if (forkId === null) {
      // Bounded: only updates delivered while the fork is being created are kept.
      if (earlyUpdates.length < 1_000) earlyUpdates.push({ id: detail.id, status: detail.status })
      return
    }
    if (detail.id === forkId) observe(detail)
  })

  return {
    track: (chatId) => {
      forkId = chatId
      for (const update of earlyUpdates.splice(0)) if (update.id === chatId) observe(update)
    },
    finished: async (initial) => {
      observe(initial)
      // A turn that never reported activity has nothing to wait for.
      if (!sawActive && !failure) return
      await new Promise<void>((resolve, reject) => {
        const check = (): void => {
          if (signal.aborted) reject(new LinkedChatContextCancelledError())
          else if (failure) reject(failure)
          else if (finishedTurn) resolve()
          else return
          wake = null
          signal.removeEventListener('abort', check)
        }
        wake = check
        signal.addEventListener('abort', check, { once: true })
        check()
      })
    },
    dispose: unsubscribe
  }
}

/** Text blocks of a provider message, without tool calls, results or media. */
export const getMessageContentText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) =>
      block && typeof block === 'object' && (block as { type?: unknown }).type === 'text'
        ? String((block as { text?: unknown }).text ?? '')
        : ''
    )
    .filter(Boolean)
    .join('\n\n')
}

const claudeSummaryPreamble =
  /^This session is being continued from a previous conversation[^\n]*(?:\n+|$)/
const claudeToolsUsedBlock = /^<tools-used-before-summary>[\s\S]*?<\/tools-used-before-summary>\s*/
const claudeSummaryHeading = /^Summary:\s*\n/
const claudeResumeInstruction =
  /\n*Continue the conversation from where it left off without asking[^\n]*(?:\n|$)/
const claudePreservedMessagesNote =
  /\n*The messages after this summary are the most recent messages from before compaction[^\n]*(?:\n|$)/

/**
 * Claude's compact summary is written for the same session to resume work. Linked context is
 * read by another agent, so the resume instructions are removed; the summary body is kept.
 */
export const cleanClaudeCompactSummary = (summary: string): string =>
  summary
    .replace(/\r\n/g, '\n')
    .trim()
    .replace(claudeSummaryPreamble, '')
    .replace(claudeToolsUsedBlock, '')
    .replace(claudeSummaryHeading, '')
    .replace(claudeResumeInstruction, '\n')
    .replace(claudePreservedMessagesNote, '\n')
    .trim()

export type LinkedChatTranscriptMessage = {
  role: 'user' | 'assistant'
  text: string
}

/** Recent messages that a provider kept verbatim beside its summary. */
export const formatLinkedChatRecentMessages = (
  messages: readonly LinkedChatTranscriptMessage[]
): string => {
  const entries = messages
    .map((message) => ({ ...message, text: message.text.trim() }))
    .filter((message) => message.text)
  if (entries.length === 0) return ''
  return [
    '## Most recent messages',
    ...entries.map(
      (message) => `**${message.role === 'user' ? 'User' : 'Assistant'}:**\n\n${message.text}`
    )
  ].join('\n\n')
}

export const joinLinkedChatSummary = (...sections: string[]): string =>
  sections
    .map((section) => section.trim())
    .filter(Boolean)
    .join('\n\n')

export const requireLinkedChatSummary = (summary: string | null | undefined): string => {
  const text = summary?.trim()
  if (!text) throw new Error('The provider did not return a summary for the linked chat.')
  return text
}

/** Retry failed native compression with the configured prompt in a fresh source fork. */
export const summarizeLinkedChatWithFallback = async (
  adapter: Pick<ProviderAdapter, 'continueChatInFork' | 'getChat' | 'stopChat' | 'onChatUpdated'>,
  chatId: string,
  {
    summaryPrompt,
    signal,
    nativeSummary,
    turnOptions
  }: {
    summaryPrompt: string
    signal: AbortSignal
    nativeSummary: () => Promise<string>
    turnOptions?: ProviderTurnOptions
  },
  onForkCreated: (chatId: string) => Promise<void>
): Promise<string> => {
  throwIfLinkedChatCancelled(signal)
  try {
    return requireLinkedChatSummary(await nativeSummary())
  } catch (error) {
    if (isLinkedChatContextCancelled(error)) throw error
    throwIfLinkedChatCancelled(signal)
  }

  const watcher = watchLinkedChatForkTurn(adapter.onChatUpdated, signal)
  let forkId: string | null = null
  try {
    const initial = await raceLinkedChatCancellation(
      signal,
      adapter.continueChatInFork(chatId, summaryPrompt, turnOptions, async (id) => {
        forkId = id
        watcher.track(id)
        await onForkCreated(id)
        throwIfLinkedChatCancelled(signal)
      })
    )
    await watcher.finished(initial)
    const detail = await raceLinkedChatCancellation(signal, adapter.getChat(initial.id))
    if (detail.status || detail.lastTurnOutcome) {
      throw new Error('The provider failed while summarizing the linked chat.')
    }
    // Only the new summary turn counts; an earlier answer must never become the summary.
    const promptIndex = detail.items.findLastIndex(
      (item) => item.type === 'message' && item.role === 'user'
    )
    return requireLinkedChatSummary(
      promptIndex < 0
        ? null
        : detail.items
            .slice(promptIndex + 1)
            .flatMap((item) =>
              item.type === 'message' && item.role === 'assistant' ? [item.content] : []
            )
            .join('\n\n')
    )
  } catch (error) {
    if (signal.aborted && forkId) {
      void adapter.stopChat(forkId).catch((stopError: unknown) => {
        console.error('[caught:summarizeLinkedChatWithFallback:stop]', stopError)
      })
    }
    throw error
  } finally {
    watcher.dispose()
  }
}
