import type { AppContainerTarget } from '../../../shared/app'
import type { ProviderPendingUserInput, ProviderUserInputResponse } from '../../../shared/provider'
import type { RpcRequest } from './CodexAppServerClient'
import type { CodexThreadItem, CodexTurn } from './CodexItemRenderers'
import { getUnchangedTranscriptPrefix } from '../transcriptProjection/recordChanges.ts'

type Question = ProviderPendingUserInput & { questionId: string }
type ServerQuestions = {
  requestId: number
  turnId: string
  container: AppContainerTarget | null
  questions: Question[]
  index: number
  answers: Record<string, { answers: string[] }>
}
type AsyncQuestions = {
  turnId: string
  items: CodexThreadItem[]
  lastUserIndex: number
  seen: Set<string>
  pending: Map<string, Question>
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
const requiredString = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid Codex question')
  return value
}

export class CodexUserQuestions {
  private server = new Map<string, ServerQuestions[]>()
  private asynchronous = new Map<string, AsyncQuestions>()
  private expectedReplies = new Map<string, Set<string>>()
  private resolving = new Set<string>()

  addServerRequest(request: RpcRequest, container: AppContainerTarget | null): string {
    const params = record(request.params)
    const threadId = requiredString(params?.threadId)
    const turnId = requiredString(params?.turnId)
    if (!Array.isArray(params?.questions) || !params.questions.length)
      throw new Error('Invalid Codex questions')
    const questions = params.questions.map((value): Question => {
      const question = record(value)
      const questionId = requiredString(question?.id)
      const choices = Array.isArray(question?.options)
        ? question.options.map((value) => {
            const option = record(value)
            return {
              label: requiredString(option?.label),
              description: typeof option?.description === 'string' ? option.description : null
            }
          })
        : []
      return {
        id: `server:${threadId}:${turnId}:${request.id}:${questionId}`,
        questionId,
        question: requiredString(question?.question),
        choices,
        allowFreeform: question?.isOther !== false || choices.length === 0,
        isSecret: question?.isSecret === true,
        isBlocking: params.isBlocking !== false,
        startedAt: Date.now()
      }
    })
    const requests = this.server.get(threadId) ?? []
    if (!requests.some((pending) => pending.requestId === request.id))
      requests.push({ requestId: request.id, turnId, container, questions, index: 0, answers: {} })
    this.server.set(threadId, requests)
    return threadId
  }

  // Seed from the current tail, including when reopening a chat. A later ordinary user message
  // makes older questions historical; known pending questions survive our own answer steering.
  syncAsync(threadId: string, turn: CodexTurn | undefined): void {
    if (!turn) return
    let state = this.asynchronous.get(threadId)
    if (!state || state.turnId !== turn.id) {
      state = {
        turnId: turn.id,
        items: [],
        lastUserIndex: -1,
        seen: new Set(),
        pending:
          (this.resolving.has(threadId) || this.expectedReplies.get(threadId)?.size) && state
            ? state.pending
            : new Map()
      }
      this.asynchronous.set(threadId, state)
    }
    if (state.items === turn.items) return
    const previousUserIndex = state.lastUserIndex
    const startIndex = getUnchangedTranscriptPrefix(state.items, turn.items)
    if (state.lastUserIndex >= startIndex) {
      state.lastUserIndex = -1
      for (let index = startIndex - 1; index >= 0; index -= 1) {
        if (turn.items[index].type !== 'userMessage') continue
        state.lastUserIndex = index
        break
      }
    }
    let ownReply = false
    for (let index = startIndex; index < turn.items.length; index += 1) {
      const item = turn.items[index]
      if (item.type !== 'userMessage') continue
      state.lastUserIndex = index
      const text = item.content
        ?.flatMap((input) => (input.type === 'text' ? [input.text] : []))
        .join('\n')
      if (text && this.expectedReplies.get(threadId)?.delete(text)) ownReply = true
    }
    if (state.lastUserIndex > previousUserIndex && !this.resolving.has(threadId) && !ownReply) {
      state.pending.clear()
      this.expectedReplies.delete(threadId)
    }
    for (let itemIndex = startIndex; itemIndex < turn.items.length; itemIndex += 1) {
      const item = turn.items[itemIndex]
      if (item.type !== 'agentMessage' || !Array.isArray(item.questions)) continue
      item.questions.forEach((value, index) => {
        const id = `async:${turn.id}:${item.id}:${index}`
        if (state.seen.has(id)) return
        state.seen.add(id)
        const question = record(value)
        if (itemIndex < state.lastUserIndex || typeof question?.title !== 'string') return
        state.pending.set(id, {
          id,
          questionId: id,
          question: question.title,
          choices: Array.isArray(question.options)
            ? question.options.flatMap((label) =>
                typeof label === 'string' && label.trim() ? [{ label, description: null }] : []
              )
            : [],
          allowFreeform: true,
          isBlocking: false,
          startedAt: item.startedAtMs ?? Date.now()
        })
      })
    }
    state.items = turn.items
  }

  getPending(threadId: string): ProviderPendingUserInput | null {
    const server = this.server.get(threadId)?.[0]
    return (
      server?.questions[server.index] ??
      this.asynchronous.get(threadId)?.pending.values().next().value ??
      null
    )
  }

  hasBlocking(threadId: string): boolean {
    return this.server.get(threadId)?.some((request) => request.questions[0].isBlocking) ?? false
  }

  async resolve(
    threadId: string,
    id: string,
    response: ProviderUserInputResponse,
    handlers: {
      server: (request: ServerQuestions, result: { answers: ServerQuestions['answers'] }) => void
      asynchronous: (question: ProviderPendingUserInput, answer: string) => Promise<void>
    }
  ): Promise<void> {
    const pending = this.getPending(threadId)
    if (!pending || pending.id !== id) throw new Error('This question is no longer pending.')
    if (this.resolving.has(threadId)) throw new Error('An answer is already being submitted.')
    this.resolving.add(threadId)
    try {
      const request = this.server.get(threadId)?.[0]
      if (request) {
        const question = request.questions[request.index]
        const answers = { ...request.answers }
        if (response.kind === 'answer')
          answers[question.questionId] = { answers: [response.answer] }
        if (response.kind === 'cancel' || request.index === request.questions.length - 1) {
          handlers.server(request, { answers })
          this.removeServerRequest(threadId, request.requestId)
        } else {
          request.answers = answers
          request.index += 1
        }
      } else {
        if (response.kind === 'answer') {
          const text = `${pending.question}\n\nAnswer: ${response.answer}`
          const expected = this.expectedReplies.get(threadId) ?? new Set<string>()
          expected.add(text)
          this.expectedReplies.set(threadId, expected)
          try {
            await handlers.asynchronous(pending, response.answer)
          } catch (error) {
            expected.delete(text)
            throw error
          }
        }
        this.asynchronous.get(threadId)?.pending.delete(id)
      }
    } finally {
      this.resolving.delete(threadId)
    }
  }

  removeServerRequest(threadId: string, requestId: number): void {
    const next = this.server.get(threadId)?.filter((request) => request.requestId !== requestId)
    if (next?.length) this.server.set(threadId, next)
    else this.server.delete(threadId)
  }

  removeResolved(
    requestId: number,
    matchesContainer: (container: AppContainerTarget | null) => boolean
  ): string | null {
    for (const [threadId, requests] of this.server) {
      if (
        !requests.some(
          (request) => request.requestId === requestId && matchesContainer(request.container)
        )
      )
        continue
      this.removeServerRequest(threadId, requestId)
      return threadId
    }
    return null
  }

  clearServerTurn(threadId: string, turnId: string): void {
    for (const request of this.server.get(threadId) ?? []) {
      if (request.turnId === turnId) this.removeServerRequest(threadId, request.requestId)
    }
  }

  removeContainer(matchesContainer: (container: AppContainerTarget | null) => boolean): string[] {
    const affected: string[] = []
    for (const [threadId, requests] of this.server) {
      const next = requests.filter((request) => !matchesContainer(request.container))
      if (next.length === requests.length) continue
      if (next.length) this.server.set(threadId, next)
      else this.server.delete(threadId)
      affected.push(threadId)
    }
    return affected
  }

  cancel(threadId: string, resolve: (request: ServerQuestions) => void): void {
    for (const request of this.server.get(threadId) ?? []) resolve(request)
    this.server.delete(threadId)
    const state = this.asynchronous.get(threadId)
    state?.pending.clear()
    this.expectedReplies.delete(threadId)
  }

  clear(): void {
    this.server.clear()
    this.asynchronous.clear()
    this.expectedReplies.clear()
    this.resolving.clear()
  }
}
