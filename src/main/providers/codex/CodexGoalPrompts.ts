import type { CodexTurn } from './CodexItemRenderers.ts'
import { isExpectedFileAbsenceError } from '../../../shared/expectedAbsence.ts'
import type { CodexTranscriptMetadata } from './CodexTranscriptMetadataIndex.ts'

export type CodexGoalPrompt = { id: string; text: string }

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null

/** Only the goal continuation envelope is presentation data; other internal prompts stay out. */
export const getCodexGoalPrompt = (value: unknown): CodexGoalPrompt | null => {
  const item = record(value)
  if (item?.type !== 'message' || item.role !== 'user' || !Array.isArray(item.content)) return null
  const text = item.content
    .flatMap((part) => {
      const content = record(part)
      return content?.type === 'input_text' && typeof content.text === 'string'
        ? [content.text]
        : []
    })
    .join('\n')
    .trim()
  const match =
    /^<codex_internal_context\s+source=["']goal["']\s*>([\s\S]*)<\/codex_internal_context>$/.exec(
      text
    )
  if (!match || !match[1].trim()) return null
  return { id: typeof item.id === 'string' ? item.id : 'goal-continuation', text: match[1].trim() }
}

export const readCodexGoalPrompts = (contents: string): Map<string, CodexGoalPrompt> => {
  const prompts = new Map<string, CodexGoalPrompt>()
  let currentTurnId: string | null = null
  for (const line of contents.split('\n')) {
    if (!line.trim()) continue
    try {
      const row = record(JSON.parse(line))
      const payload = record(row?.payload)
      if (!payload) continue
      if (row?.type === 'event_msg' && payload.type === 'task_started') {
        currentTurnId = typeof payload.turn_id === 'string' ? payload.turn_id : null
      } else if (row?.type === 'turn_context' && typeof payload.turn_id === 'string') {
        currentTurnId = payload.turn_id
      } else if (
        row?.type === 'event_msg' &&
        ['task_complete', 'turn_aborted'].includes(String(payload.type))
      ) {
        currentTurnId = null
      }
      if (row?.type !== 'response_item') continue
      const prompt = getCodexGoalPrompt(payload)
      const metadata = record(payload.internal_chat_message_metadata_passthrough)
      const turnId = typeof metadata?.turn_id === 'string' ? metadata.turn_id : currentTurnId
      if (prompt && turnId) prompts.set(turnId, prompt)
    } catch (error) {
      // A live rollout may end with a partially written line.
      console.warn('Unable to parse a Codex goal event from the live rollout tail', error)
    }
  }
  return prompts
}

type PromptCache = {
  prompts: Map<string, CodexGoalPrompt>
  checked: Set<string>
  retryAfter: Map<string, number>
  pending?: Promise<boolean>
}

/** Optional display-only enrichment. Paginated API turns remain authoritative for history. */
export class CodexGoalPrompts {
  private threads = new Map<string, PromptCache>()
  private projectedTurns = new WeakMap<CodexTurn, CodexTurn>()

  private cache(threadId: string): PromptCache {
    let cache = this.threads.get(threadId)
    if (!cache) {
      cache = { prompts: new Map(), checked: new Set(), retryAfter: new Map() }
      this.threads.set(threadId, cache)
      while (this.threads.size > 16) this.threads.delete(this.threads.keys().next().value!)
    }
    return cache
  }

  set(threadId: string, turnId: string, prompt: CodexGoalPrompt): boolean {
    const cache = this.cache(threadId)
    const previous = cache.prompts.get(turnId)
    if (previous?.id === prompt.id && previous.text === prompt.text) return false
    cache.prompts.set(turnId, prompt)
    while (cache.prompts.size > 512) cache.prompts.delete(cache.prompts.keys().next().value!)
    return true
  }

  project(threadId: string, turn: CodexTurn): CodexTurn {
    const goalPrompt = this.threads.get(threadId)?.prompts.get(turn.id)
    if (!goalPrompt) return turn
    const cached = this.projectedTurns.get(turn)
    if (cached?.goalPrompt === goalPrompt) return cached
    const projected = { ...turn, goalPrompt }
    this.projectedTurns.set(turn, projected)
    return projected
  }

  /** Keep negative active-goal checks on the same one-second cadence as legacy loading. */
  shouldLoad(thread: { id: string; turns: CodexTurn[] }): boolean {
    const cache = this.cache(thread.id)
    const now = Date.now()
    let needed = false
    for (const turn of thread.turns) {
      if (
        cache.prompts.has(turn.id) ||
        cache.checked.has(turn.id) ||
        now < (cache.retryAfter.get(turn.id) ?? 0) ||
        turn.status === 'queued' ||
        turn.local ||
        turn.items.some((item) => item.type === 'userMessage')
      )
        continue
      cache.retryAfter.set(turn.id, now + 1000)
      needed = true
    }
    while (cache.retryAfter.size > 512)
      cache.retryAfter.delete(cache.retryAfter.keys().next().value!)
    return needed
  }

  /** Apply the shared incremental index without a second transcript read or parse. */
  apply(thread: { id: string; turns: CodexTurn[] }, metadata: CodexTranscriptMetadata): boolean {
    const cache = this.cache(thread.id)
    let changed = false
    for (const turn of thread.turns) {
      if (
        turn.local ||
        turn.status === 'queued' ||
        turn.items.some((item) => item.type === 'userMessage')
      )
        continue
      const prompt = metadata.prompts.get(turn.id)
      if (prompt) {
        if (!cache.prompts.has(turn.id)) changed = this.set(thread.id, turn.id, prompt) || changed
      } else if (turn.status && !['inProgress', 'queued'].includes(turn.status)) {
        cache.checked.add(turn.id)
      }
    }
    while (cache.checked.size > 512) cache.checked.delete(cache.checked.keys().next().value!)
    return changed
  }

  async load(
    thread: { id: string; path?: string | null; turns: CodexTurn[] },
    readFile: (path: string) => Promise<string>
  ): Promise<boolean> {
    if (!thread.path) return false
    const cache = this.cache(thread.id)
    if (cache.pending) {
      const changed = await cache.pending
      return (await this.load(thread, readFile)) || changed
    }
    const candidates = thread.turns.filter(
      (turn) =>
        !cache.prompts.has(turn.id) &&
        !cache.checked.has(turn.id) &&
        Date.now() >= (cache.retryAfter.get(turn.id) ?? 0) &&
        turn.status !== 'queued' &&
        !turn.local &&
        !turn.items.some((item) => item.type === 'userMessage')
    )
    if (!candidates.length) return false
    for (const turn of candidates) cache.retryAfter.set(turn.id, Date.now() + 1000)
    while (cache.retryAfter.size > 512)
      cache.retryAfter.delete(cache.retryAfter.keys().next().value!)
    cache.pending = (async (): Promise<boolean> => {
      try {
        const prompts = readCodexGoalPrompts(await readFile(thread.path!))
        let changed = false
        for (const turn of candidates) {
          const prompt = prompts.get(turn.id)
          if (prompt) changed = this.set(thread.id, turn.id, prompt) || changed
          if (!prompt && turn.status && !['inProgress', 'queued'].includes(turn.status))
            cache.checked.add(turn.id)
        }
        while (cache.checked.size > 512) cache.checked.delete(cache.checked.keys().next().value!)
        return changed
      } catch (error) {
        // Missing/remote rollouts must never prevent the authoritative chat page from loading.
        if (!isExpectedFileAbsenceError(error)) {
          console.warn(`Unable to read optional Codex goal prompts for thread ${thread.id}`, error)
        }
        return false
      } finally {
        cache.pending = undefined
      }
    })()
    return cache.pending
  }

  clear(): void {
    this.threads.clear()
    this.projectedTurns = new WeakMap()
  }
}
