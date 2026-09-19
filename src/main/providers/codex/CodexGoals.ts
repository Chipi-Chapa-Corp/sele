import type { ProviderChatGoal } from '../../../shared/provider.ts'

type GoalRequest = (method: string, params: unknown) => Promise<unknown>

/** Goal state comes from the goal API, independently of the loaded transcript window. */
export class CodexGoals {
  private mutations = new Map<string, symbol>()
  private states = new Map<string, { goal: ProviderChatGoal | null }>()

  get(threadId: string): ProviderChatGoal | null {
    return this.states.get(threadId)?.goal ?? null
  }

  update(threadId: string, goal: ProviderChatGoal | null): void {
    this.states.set(threadId, { goal })
  }

  async read(threadId: string, request: GoalRequest): Promise<void> {
    if (this.mutations.has(threadId)) return
    const previous = this.states.get(threadId)
    try {
      const response = (await request('thread/goal/get', { threadId })) as {
        goal: ProviderChatGoal | null
      }
      // A notification or mutation received during the read is newer than its response.
      if (!this.mutations.has(threadId) && this.states.get(threadId) === previous)
        this.update(threadId, response.goal)
    } catch (error) {
      // Goal support is optional on older app servers; chat loading must still work.
      console.warn(`Unable to read optional Codex goal for thread ${threadId}`, error)
    }
  }

  async save(
    threadId: string,
    objective: string | null,
    request: GoalRequest
  ): Promise<ProviderChatGoal | null> {
    // Invalidate pending reads before sending the mutation; reads during it cannot restore old state.
    this.update(threadId, this.get(threadId))
    const previous = this.states.get(threadId)
    const mutation = Symbol(threadId)
    this.mutations.set(threadId, mutation)
    try {
      const text = objective?.trim()
      const response = text
        ? ((await request('thread/goal/set', { threadId, objective: text })) as {
            goal: ProviderChatGoal
          })
        : await request('thread/goal/clear', { threadId })
      if (this.states.get(threadId) === previous) {
        this.update(threadId, text ? (response as { goal: ProviderChatGoal }).goal : null)
      }
      return this.get(threadId)
    } finally {
      if (this.mutations.get(threadId) === mutation) this.mutations.delete(threadId)
    }
  }

  clear(): void {
    this.states.clear()
    this.mutations.clear()
  }
}
