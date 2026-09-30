export type CodexDeliveredMessageTarget = {
  turnId: string
  /** Steering is identified by the client id until authoritative history provides its item id. */
  clientId?: string
}

type Delivery = {
  promise: Promise<void>
  target: CodexDeliveredMessageTarget | null
}

/** Keep message identity across queue/steering submission and its server acknowledgment. */
export class CodexMessageDelivery {
  private threads = new Map<string, Map<string, Delivery>>()

  run = (threadId: string, messageId: string, send: () => Promise<void>): Promise<void> => {
    const messages = this.threads.get(threadId) ?? new Map<string, Delivery>()
    this.threads.set(threadId, messages)
    const existing = messages.get(messageId)
    if (existing) return existing.promise
    const delivery: Delivery = { promise: Promise.resolve(), target: null }
    // Publish the delivery before send can remove the queued message or emit notifications.
    delivery.promise = Promise.resolve()
      .then(send)
      .then(() => {
        if (!delivery.target && messages.get(messageId) === delivery) messages.delete(messageId)
      })
      .catch((error: unknown) => {
        if (messages.get(messageId) === delivery) messages.delete(messageId)
        throw error
      })
    messages.set(messageId, delivery)
    return delivery.promise
  }

  bind = (threadId: string, messageId: string, target: CodexDeliveredMessageTarget): void => {
    const delivery = this.threads.get(threadId)?.get(messageId)
    if (delivery) delivery.target = target
  }

  wait = (
    threadId: string,
    messageId: string
  ): Promise<CodexDeliveredMessageTarget | null> | null => {
    const delivery = this.threads.get(threadId)?.get(messageId)
    if (!delivery) return null
    return delivery.promise.then(() => delivery.target)
  }

  removeTurns = (threadId: string, turnIds: ReadonlySet<string>): void => {
    const messages = this.threads.get(threadId)
    if (!messages) return
    for (const [id, delivery] of messages) {
      if (delivery.target && turnIds.has(delivery.target.turnId)) messages.delete(id)
    }
    if (messages.size === 0) this.threads.delete(threadId)
  }

  clear = (): void => {
    this.threads.clear()
  }
}
